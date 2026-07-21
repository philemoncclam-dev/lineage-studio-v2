"""Derive lineage from notebook code and push it into Purview.

Lineage in Atlas is not a bare relationship you can POST between two datasets:
it only exists as the `inputs`/`outputs` of a *process* entity, and the graph
API materialises the edges from that. The convenient discovery here, checked
against the live catalog rather than assumed, is that a scanned notebook is
already such a process — `fabric_synapse_notebook` has supertypes
`[powerbi_resource, fabric_artifact, openlineage_job, Process]` and inherits
`inputs`/`outputs`, both of which a fresh scan leaves empty. So the push is an
*update of the existing notebook entity*, not the creation of a synthetic
process alongside it. That keeps one node per notebook in the UI and means a
re-scan updates the same entity instead of racing a duplicate.

The crux is name resolution. The parser speaks in bare table names (`raw_orders`)
because that is all notebook code contains; the catalog speaks in Purview GUIDs.
The bridge is the Fabric qualified name, whose last segment is the table name —
doubly URL-encoded, so `dbo%252Fraw_orders` is `dbo%2Fraw_orders` is
`dbo/raw_orders`, and only the part after the schema is what code refers to.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from urllib.parse import unquote

from ..models import LineageGraph, Node, NodeKind, NotebookSource
from ..parser import parse_notebook
from .client import PurviewClient
from .writer import WriteResult, WriteSession

# Kinds whose entities a notebook can read from or write to.
_DATASET_KINDS = {NodeKind.TABLE}


def _asset_name(node: Node) -> str:
    """The bare name notebook code would use for this asset.

    Prefer the qualified name's last segment over `name`: the two agree today,
    but the qualified name is the authoritative identity and survives a display
    name being edited in Fabric.
    """
    qname = node.meta.get("qualified_name") or ""
    tail = qname.rstrip("/").rsplit("/", 1)[-1] if qname else ""
    # Fabric double-encodes the `schema/table` separator in table qualified
    # names, so one unquote leaves `%2F` behind and the schema stays glued on.
    decoded = unquote(unquote(tail)) if tail else ""
    bare = decoded.split("/")[-1]
    return (bare or node.name).lower()


def resolve_asset_names(nodes: Iterable[Node]) -> dict[str, str]:
    """Bare asset name -> Purview GUID, for the datasets a notebook can touch.

    Ambiguity is resolved by dropping the name entirely rather than guessing:
    two tables of the same name in different lakehouses cannot be told apart
    from notebook text alone, and a wrong edge is worse than a missing one.
    """
    seen: dict[str, str | None] = {}
    for node in nodes:
        if node.kind not in _DATASET_KINDS:
            continue
        key = _asset_name(node)
        seen[key] = None if key in seen else node.id
    return {k: v for k, v in seen.items() if v}


def _refs(guids: Iterable[str]) -> list[dict[str, str]]:
    """Atlas object-id references: a GUID alone is enough to bind an entity."""
    return [{"guid": g} for g in sorted(guids)]


def notebook_lineage_entity(
    notebook: Node, source: NotebookSource, by_name: Mapping[str, str]
) -> dict | None:
    """The entity payload that gives one notebook its inputs and outputs.

    Returns None when nothing the notebook touches is in the catalog — queueing
    an update that sets both sides to empty would be a no-op at best and, if the
    entity already had lineage from elsewhere, a silent erasure.
    """
    _, edges = parse_notebook(source)

    inputs: set[str] = set()
    outputs: set[str] = set()
    for edge in edges:
        # `parse_notebook` orients edges through the notebook itself: a read is
        # table -> notebook, a write notebook -> table.
        if edge.kind == "reads":
            name = edge.source.removeprefix("table.")
            target = inputs
        elif edge.kind == "writes":
            name = edge.target.removeprefix("table.")
            target = outputs
        else:
            continue
        guid = by_name.get(name.lower())
        if guid:
            target.add(guid)

    if not inputs and not outputs:
        return None

    return {
        "typeName": notebook.meta.get("entity_type") or "fabric_synapse_notebook",
        "guid": notebook.id,
        "attributes": {
            # Atlas keys an update on qualifiedName; sending it with the GUID
            # keeps the call an update of this entity rather than a create.
            "qualifiedName": notebook.meta.get("qualified_name"),
            "name": notebook.name,
            "inputs": _refs(inputs),
            "outputs": _refs(outputs),
        },
    }


def push_notebook_lineage(
    graph: LineageGraph,
    sources: Mapping[str, NotebookSource],
    client: PurviewClient | None = None,
    apply: bool = False,
) -> WriteResult:
    """Queue an inputs/outputs update for every notebook we have source for.

    `sources` is keyed by notebook node name so the caller is free to have got
    that source from live Fabric or from a manual upload — this layer does not
    care which, which is what keeps the pipeline usable while the service
    principal lacks Fabric workspace access.
    """
    by_name = resolve_asset_names(graph.nodes)
    session = WriteSession(client=client, apply=apply)

    for node in graph.nodes:
        if node.kind is not NodeKind.NOTEBOOK:
            continue
        source = sources.get(node.name)
        if source is None:
            continue
        entity = notebook_lineage_entity(node, source, by_name)
        if entity is None:
            continue
        n_in = len(entity["attributes"]["inputs"])
        n_out = len(entity["attributes"]["outputs"])
        session.add(
            "POST",
            "/atlas/v2/entity",
            {"entity": entity, "referredEntities": {}},
            describes=f"lineage for notebook {node.name}: {n_in} input(s), {n_out} output(s)",
        )

    return session.run()
