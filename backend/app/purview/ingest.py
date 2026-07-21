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
from .client import PurviewClient, PurviewError

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
# The container segment varies, so match the guid that follows any of them
# rather than hard-coding one. `lakewarehouses` is the segment Fabric emits for
# a lakehouse's SQL analytics endpoint, and it is where views live — omitting it
# silently reparented every view to the workspace.
_WORKSPACE_RE = re.compile(r"/groups/([0-9a-f-]{36})", re.I)
_CONTAINER_RE = re.compile(
    r"/(?:lakehouses|lakewarehouses|warehouses)/([0-9a-f-]{36})", re.I
)


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


def _columns_of(detail: dict) -> list[Column]:
    """Columns carried directly on an entity's `columns` relationship.

    Data types are not on the relationship stub, only on the full column
    entities in `referredEntities`, so look them up there when present.
    """
    entity = detail.get("entity", detail)
    referred = detail.get("referredEntities") or {}
    out: list[Column] = []
    for col in (entity.get("relationshipAttributes") or {}).get("columns") or []:
        name = col.get("displayText") or col.get("qualifiedName")
        if not name:
            continue
        attrs = (referred.get(col.get("guid")) or {}).get("attributes") or {}
        # The spelling varies by entity type: lakehouse table columns use
        # `dataType`, tabular_schema columns use `data_type`.
        data_type = attrs.get("dataType") or attrs.get("data_type") or attrs.get("type")
        out.append(Column(name=unquote(name), data_type=data_type))
    return out


def _table_columns(client: PurviewClient, guid: str) -> list[Column]:
    """Columns for a table-like entity, from wherever Fabric hung them.

    Lakehouse tables carry `columns` on the entity itself. Warehouse views do
    not — theirs hang off a separate `tabular_schema` entity, which costs one
    extra fetch. Views looked column-less until we followed that link.
    """
    detail = client.get_entity(guid)
    columns = _columns_of(detail)
    if columns:
        return columns

    entity = detail.get("entity", detail)
    schema = (entity.get("relationshipAttributes") or {}).get("tabular_schema")
    schema_guid = (schema or {}).get("guid")
    if not schema_guid:
        return []
    return _columns_of(client.get_entity(schema_guid))


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

        # Guard against one container scanned twice under the same Fabric GUID.
        # Note LH_Sales appearing as both fabric_lakehouse and
        # fabric_lake_warehouse is *not* that case: those carry different GUIDs
        # (the lakehouse and its SQL endpoint) and are deliberately kept apart —
        # tables hang off the former, views off the latter.
        fabric_id = _own_fabric_id(qname)
        if kind is NodeKind.LAKEHOUSE and fabric_id and fabric_id in by_fabric_id:
            by_qualified_name[qname] = by_fabric_id[fabric_id]
            continue

        columns: list[Column] = []
        if kind in _TABLE_KINDS:
            columns = _table_columns(client, guid)

        # A lakehouse and its SQL endpoint share a display name, so the graph
        # would otherwise show two identical nodes with different children.
        name = hit.get("name") or hit.get("displayText") or guid
        if hit["entityType"] == "fabric_lake_warehouse":
            name = f"{name} (SQL endpoint)"

        nodes[guid] = Node(
            id=guid,
            kind=kind,
            name=name,
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

    Queried per direction from the table side only: `get_next_lineage` rejects
    BOTH, and the notebook side would need a flag that breaks the table side.
    An entity with no lineage 404s instead of returning nothing, so a failure
    here is the ordinary case for an unconnected asset, not an error.
    """
    edges: list[Edge] = []
    seen: set[tuple[str, str]] = set()

    for node in nodes.values():
        if node.kind not in _TABLE_KINDS:
            continue
        for direction in ("INPUT", "OUTPUT"):
            try:
                lineage = client.get_next_lineage(node.id, direction)
            except PurviewError:
                continue
            for rel in lineage.get("relations", []) or []:
                src, tgt = rel.get("fromEntityId"), rel.get("toEntityId")
                # Lineage can traverse process entities we did not keep as nodes.
                if src not in nodes or tgt not in nodes or (src, tgt) in seen:
                    continue
                seen.add((src, tgt))
                edges.append(Edge(source=src, target=tgt, kind="derives"))

    return edges
