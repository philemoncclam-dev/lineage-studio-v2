"""Fetch input-table schemas from OneLake so the sandbox can register empty
temp views the notebook's reads resolve against.

The chain (verified against a live schema-enabled lakehouse):
  1. static-scan the notebook cells for the tables it reads;
  2. build a name → table-directory index across the workspace's lakehouses
     from a recursive OneLake listing (`_delta_log` marks a Delta table);
  3. for each read table, read its Delta transaction log — newline-JSON commit
     files, highest version first — until a commit carrying `metaData` is found,
     and lift the schema out of `metaData.schemaString` (which is Spark's own
     StructType JSON).

Everything network-touching takes a client; the parsing is pure and unit-tested,
because the live shapes here have historically been the ones that bite
(handoff: verify against the tenant, the swagger has been wrong).
"""

from __future__ import annotations

import json

from ..parser import _READ_PATTERNS, _find, _without_python_imports
from ..sandbox.protocol import ColumnSchema
from .client import FabricError

# Delta type name → a Spark-DDL-parseable type string (for empty-view creation).
_DELTA_TO_DDL = {
    "long": "bigint",
    "integer": "int",
    "short": "smallint",
    "byte": "tinyint",
    "float": "float",
    "double": "double",
    "string": "string",
    "boolean": "boolean",
    "binary": "binary",
    "date": "date",
    "timestamp": "timestamp",
    "timestamp_ntz": "timestamp",
}


def delta_type_to_ddl(t: object) -> str:
    """A Delta field `type` → a DDL type string.

    Nested types (struct/array/map arrive as dicts) are flattened to `string`:
    the empty view only needs a resolvable column of the right name; nested
    fidelity isn't required for lineage shape.
    """
    if isinstance(t, dict):
        return "string"
    ts = str(t)
    if ts.startswith("decimal"):
        return ts
    return _DELTA_TO_DDL.get(ts, "string")


def parse_delta_schema(commit_texts_desc: list[str]) -> list[ColumnSchema]:
    """Columns from the first (highest-version) commit that carries a schema.

    `commit_texts_desc` is the content of `_delta_log/*.json` commits in
    descending version order; the newest `metaData` is the current schema
    because Delta writes the *full* schema into each `metaData`, not a diff.
    """
    for text in commit_texts_desc:
        meta = None
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict) and obj.get("metaData"):
                meta = obj["metaData"]
        if meta and meta.get("schemaString"):
            fields = json.loads(meta["schemaString"]).get("fields", [])
            return [
                ColumnSchema(name=f["name"], type=delta_type_to_ddl(f.get("type")))
                for f in fields
                if f.get("name")
            ]
    return []


def scan_read_tables(cells: list[str]) -> set[str]:
    """Best-effort static pass for the tables a notebook reads.

    Needed because view registration has to happen *before* the run, so the
    accurate reads (from Spark's plans) aren't available yet.
    """
    reads: set[str] = set()
    for cell in cells:
        reads |= _find(_READ_PATTERNS, _without_python_imports(cell))
    return reads


def table_dirs_for_lakehouse(client, workspace_id: str, lakehouse_id: str) -> dict[str, str]:
    """`short table name → OneLake table directory` for one lakehouse."""
    paths = client.onelake_list(workspace_id, f"{lakehouse_id}/Tables", recursive=True)
    out: dict[str, str] = {}
    for p in paths:
        name = p.get("name") or ""
        if not name.endswith("/_delta_log"):
            continue
        table_dir = name[: -len("/_delta_log")]
        short = table_dir.split("/")[-1]
        out.setdefault(short.lower(), table_dir)
    return out


def fetch_table_schema(client, workspace_id: str, table_dir: str) -> list[ColumnSchema]:
    """The Delta schema of one table, or `[]` if it can't be read.

    Reads `_delta_log` commits newest-first and stops at the first with a
    `metaData` — usually one or two small reads.
    """
    try:
        log_paths = client.onelake_list(workspace_id, f"{table_dir}/_delta_log", recursive=False)
    except FabricError:
        return []
    commits = sorted(
        (p.get("name") for p in log_paths if (p.get("name") or "").endswith(".json")),
        reverse=True,
    )
    for commit in commits:
        try:
            text = client.onelake_read_text(workspace_id, commit)
        except FabricError:
            continue
        cols = parse_delta_schema([text])
        if cols:
            return cols
    return []


def resolve_read_schemas(
    client, workspace_id: str, read_names: set[str]
) -> dict[str, list[ColumnSchema]]:
    """Schemas for the named read tables, found across the workspace's lakehouses.

    Table names are matched short (last path segment), first lakehouse wins on a
    collision — good enough to register empty views; the sandbox reports per-cell
    errors honestly for anything that stays unresolved.
    """
    if not read_names:
        return {}
    try:
        items = client.list_items(workspace_id)
    except FabricError:
        return {}

    index: dict[str, str] = {}
    for item in items:
        if (item.get("type") or "").lower() != "lakehouse":
            continue
        try:
            for short, table_dir in table_dirs_for_lakehouse(client, workspace_id, item["id"]).items():
                index.setdefault(short, table_dir)
        except FabricError:
            continue

    schemas: dict[str, list[ColumnSchema]] = {}
    for name in read_names:
        table_dir = index.get(name.lower())
        if not table_dir:
            continue
        cols = fetch_table_schema(client, workspace_id, table_dir)
        if cols:
            schemas[name] = cols
    return schemas
