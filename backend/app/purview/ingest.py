"""Build a `LineageGraph` from the Purview data map.

Entity types and attribute names here were read off a live Unified Catalog
account rather than taken from docs, so they reflect what Fabric scans actually
emit. Node ids are Purview GUIDs: they are already stable and unique, and
keeping them means the push path can map a node back to its entity without a
second lookup.
"""

from __future__ import annotations

import re
from urllib.parse import unquote

from ..models import Column, Edge, LineageGraph, Node, NodeKind
from .client import PurviewClient

# Fabric scan entity types -> our node kinds. Types absent from this map (paths,
# pipelines) are skipped: they are storage and orchestration artefacts, not
# lineage-bearing objects in our model.
_KIND_BY_TYPE = {
    "fabric_workspace": NodeKind.WORKSPACE,
    "fabric_lakehouse": NodeKind.LAKEHOUSE,
    "fabric_lake_warehouse": NodeKind.LAKEHOUSE,
    "fabric_warehouse": NodeKind.LAKEHOUSE,
    "fabric_lakehouse_table": NodeKind.TABLE,
    "fabric_warehouse_table": NodeKind.TABLE,
    "fabric_warehouse_view": NodeKind.TABLE,
    "fabric_synapse_notebook": NodeKind.NOTEBOOK,
}

_TABLE_KINDS = {NodeKind.TABLE}

# Fabric qualified names look like:
#   https://app.fabric.microsoft.com/groups/<ws-guid>/lakehouses/<lh-guid>/tables/dbo%252Fraw_customers
# The container segment varies (lakehouses/warehouses/notebooks), so match the
# guid that follows any of them rather than hard-coding one.
_WORKSPACE_RE = re.compile(r"/groups/([0-9a-f-]{36})", re.I)
_CONTAINER_RE = re.compile(r"/(?:lakehouses|warehouses)/([0-9a-f-]{36})", re.I)


def parse_fabric_qualified_name(qualified_name: str) -> dict[str, str | None]:
    """Pull the workspace and container GUIDs out of a Fabric qualified name."""
    ws = _WORKSPACE_RE.search(qualified_name or "")
    container = _CONTAINER_RE.search(qualified_name or "")
    return {
        "workspace_id": ws.group(1).lower() if ws else None,
        "container_id": container.group(1).lower() if container else None,
    }


def _own_fabric_id(qualified_name: str) -> str | None:
    """The GUID a workspace/lakehouse entity refers to *itself* by.

    Containment is expressed in qualified names as GUIDs, but the search result
    identifies entities by Purview GUID — these are different numbers, so we
    index Fabric ids to resolve parents.
    """
    parsed = parse_fabric_qualified_name(qualified_name)
    return parsed["container_id"] or parsed["workspace_id"]


def _columns_of(entity: dict) -> list[Column]:
    rels = entity.get("relationshipAttributes", {}) or {}
    out: list[Column] = []
    for col in rels.get("columns") or []:
        name = col.get("displayText") or col.get("qualifiedName")
        if name:
            out.append(Column(name=unquote(name)))
    return out


def build_graph_from_purview(client: PurviewClient | None = None) -> LineageGraph:
    """Read the catalog and return it as a lineage graph.

    Only entities whose type maps to a `NodeKind` are kept. Tables are fetched
    individually because search results carry no column information.
    """
    client = client or PurviewClient()
    hits = [h for h in client.search() if h.get("entityType") in _KIND_BY_TYPE]

    nodes: dict[str, Node] = {}
    # Fabric-id -> our node id, so children can find their container.
    by_fabric_id: dict[str, str] = {}
    # Purview qualifiedName -> node id, for resolving lineage relationships.
    by_qualified_name: dict[str, str] = {}

    for hit in hits:
        kind = _KIND_BY_TYPE[hit["entityType"]]
        guid = hit["id"]
        qname = hit.get("qualifiedName") or ""

        # A lakehouse scanned under two type names (fabric_lakehouse and
        # fabric_lake_warehouse) is one object; keep the first and skip the dup.
        fabric_id = _own_fabric_id(qname)
        if kind is NodeKind.LAKEHOUSE and fabric_id and fabric_id in by_fabric_id:
            by_qualified_name[qname] = by_fabric_id[fabric_id]
            continue

        columns: list[Column] = []
        if kind in _TABLE_KINDS:
            detail = client.get_entity(guid)
            columns = _columns_of(detail.get("entity", detail))

        nodes[guid] = Node(
            id=guid,
            kind=kind,
            name=hit.get("name") or hit.get("displayText") or guid,
            columns=columns,
            meta={
                "purview_guid": guid,
                "qualified_name": qname,
                "entity_type": hit["entityType"],
                "collection_id": hit.get("collectionId"),
            },
        )
        by_qualified_name[qname] = guid
        if fabric_id and kind in (NodeKind.WORKSPACE, NodeKind.LAKEHOUSE):
            by_fabric_id.setdefault(fabric_id, guid)

    # Containment: a table's parent is its lakehouse, a lakehouse's its
    # workspace. Resolved after the first pass so parents exist regardless of
    # the order search returned them in.
    for node in nodes.values():
        parsed = parse_fabric_qualified_name(node.meta.get("qualified_name") or "")
        parent_fabric_id = (
            parsed["workspace_id"]
            if node.kind is NodeKind.LAKEHOUSE
            else parsed["container_id"] or parsed["workspace_id"]
        )
        if not parent_fabric_id:
            continue
        parent_id = by_fabric_id.get(parent_fabric_id)
        if parent_id and parent_id != node.id:
            node.parent_id = parent_id

    edges = _collect_edges(client, nodes)
    return LineageGraph(nodes=list(nodes.values()), edges=edges)


def _collect_edges(client: PurviewClient, nodes: dict[str, Node]) -> list[Edge]:
    """Read lineage relationships for every table node.

    A freshly scanned Fabric catalog usually has none of these — Purview knows
    the assets but not how they connect, which is what the notebook parser and
    the push path exist to fill in.
    """
    edges: list[Edge] = []
    seen: set[tuple[str, str]] = set()

    for node in nodes.values():
        if node.kind not in _TABLE_KINDS:
            continue
        lineage = client.get_lineage(node.id)
        for rel in lineage.get("relations", []) or []:
            src, tgt = rel.get("fromEntityId"), rel.get("toEntityId")
            # Lineage can traverse process entities we did not keep as nodes.
            if src not in nodes or tgt not in nodes or (src, tgt) in seen:
                continue
            seen.add((src, tgt))
            edges.append(Edge(source=src, target=tgt, kind="derives"))

    return edges
