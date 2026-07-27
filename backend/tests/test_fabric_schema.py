"""Input-schema fetch from OneLake Delta logs.

The Delta-log parsing is pure and tested against the real commit shapes seen on
a live schema-enabled lakehouse (metaData appears in an *earlier* commit than
the latest, so the newest-first scan must fall through). The resolver is tested
against a fake client — no network — with the table-name → directory matching
that lets a notebook's bare `spark.table('raw_customers')` find its schema.
"""

from __future__ import annotations

import json

from app.fabric.schema import (
    delta_type_to_ddl,
    fetch_table_schema,
    parse_delta_schema,
    resolve_read_schemas,
    scan_read_tables,
)
from app.sandbox._refs import make_ref, table_of


def _commit_with_schema(fields: list[tuple[str, str]]) -> str:
    schema_string = json.dumps(
        {"type": "struct", "fields": [{"name": n, "type": t, "nullable": True, "metadata": {}} for n, t in fields]}
    )
    return "\n".join(
        [
            json.dumps({"commitInfo": {"operation": "WRITE"}}),
            json.dumps({"metaData": {"id": "x", "format": {"provider": "parquet"}, "schemaString": schema_string, "partitionColumns": []}}),
            json.dumps({"add": {"path": "part-0000.parquet"}}),
        ]
    )


def test_delta_type_mapping_to_ddl():
    assert delta_type_to_ddl("long") == "bigint"
    assert delta_type_to_ddl("integer") == "int"
    assert delta_type_to_ddl("string") == "string"
    assert delta_type_to_ddl("decimal(10,2)") == "decimal(10,2)"
    assert delta_type_to_ddl({"type": "struct", "fields": []}) == "string"  # nested → string
    assert delta_type_to_ddl("weird") == "string"


def test_parse_delta_schema_reads_the_schema_string():
    text = _commit_with_schema([("customer_id", "string"), ("amount", "long")])
    cols = parse_delta_schema([text])
    assert [(c.name, c.type) for c in cols] == [("customer_id", "string"), ("amount", "bigint")]


def test_parse_falls_through_to_an_earlier_commit_with_metadata():
    """The real case: the latest commit is a data append with no metaData."""
    latest = json.dumps({"add": {"path": "part-0001.parquet"}})  # no metaData
    older = _commit_with_schema([("id", "long")])
    assert parse_delta_schema([latest, older])  # desc order: newest first, falls through
    assert parse_delta_schema([latest, older])[0].name == "id"


class FakeOneLake:
    """Fake FabricClient exposing just the OneLake + items surface used here."""

    def __init__(self, items, tree, commits):
        self._items = items          # list_items result
        self._tree = tree            # {directory: [paths]} for onelake_list
        self._commits = commits      # {path: text} for onelake_read_text

    def list_items(self, workspace_id):
        return self._items

    def list_workspaces(self):
        return [{"id": "ws1", "displayName": "Analytics"}]

    def onelake_list(self, workspace_id, directory, recursive=False):
        return [{"name": n} for n in self._tree.get(directory, [])]

    def onelake_read_text(self, workspace_id, path):
        return self._commits[path]


def test_resolve_read_schemas_matches_a_bare_table_name():
    lh = "lh1"
    tables_dir = f"{lh}/Tables"
    table_dir = f"{lh}/Tables/dbo/raw_customers"
    fake = FakeOneLake(
        items=[{"id": lh, "type": "Lakehouse"}, {"id": "nb", "type": "Notebook"}],
        tree={
            tables_dir: [f"{table_dir}/_delta_log", f"{table_dir}/part-0.parquet"],
            f"{table_dir}/_delta_log": [f"{table_dir}/_delta_log/00000000000000000000.json"],
        },
        commits={
            f"{table_dir}/_delta_log/00000000000000000000.json": _commit_with_schema(
                [("customer_id", "string"), ("region", "string")]
            )
        },
    )
    ref = make_ref("raw_customers", "Bronze", "Analytics")
    schemas = resolve_read_schemas(fake, "ws1", {ref})
    assert set(schemas) == {ref}
    assert [c.name for c in schemas[ref]] == ["customer_id", "region"]


def test_resolve_read_schemas_uses_each_refs_own_workspace():
    """A cross-workspace read is looked up where it lives, not in the notebook's."""
    lh, table_dir = "lh1", "lh1/Tables/dbo/raw_customers"
    fake = FakeOneLake(
        items=[{"id": lh, "type": "Lakehouse"}],
        tree={
            f"{lh}/Tables": [f"{table_dir}/_delta_log"],
            f"{table_dir}/_delta_log": [f"{table_dir}/_delta_log/00000000000000000000.json"],
        },
        commits={
            f"{table_dir}/_delta_log/00000000000000000000.json": _commit_with_schema(
                [("customer_id", "string")]
            )
        },
    )
    fake.seen = []
    inner = fake.onelake_list

    def spy(workspace_id, directory, recursive=False):
        fake.seen.append(workspace_id)
        return inner(workspace_id, directory, recursive)

    fake.onelake_list = spy
    foreign = make_ref("raw_customers", "Gold", "Finance")
    resolve_read_schemas(fake, "ws1", {foreign}, {"finance": "ws-finance"})
    # listed against Finance's id, never the notebook's own workspace
    assert "ws-finance" in fake.seen and "ws1" not in fake.seen


def test_fetch_table_schema_stops_at_first_commit_with_metadata():
    table_dir = "lh/Tables/orders"
    fake = FakeOneLake(
        items=[],
        tree={f"{table_dir}/_delta_log": [
            f"{table_dir}/_delta_log/00000000000000000000.json",
            f"{table_dir}/_delta_log/00000000000000000001.json",
        ]},
        commits={
            f"{table_dir}/_delta_log/00000000000000000001.json": json.dumps({"add": {"path": "p"}}),
            f"{table_dir}/_delta_log/00000000000000000000.json": _commit_with_schema([("id", "long")]),
        },
    )
    cols = fetch_table_schema(fake, "ws1", table_dir)
    assert [(c.name, c.type) for c in cols] == [("id", "bigint")]


def test_scan_read_tables_finds_reads_and_ignores_imports():
    cells = ["from pyspark.sql import Row", "df = spark.table('raw_orders')", "x = spark.sql('SELECT * FROM dim_region')"]
    reads = scan_read_tables(cells)
    names = {table_of(r) for r in reads}
    assert "raw_orders" in names and "dim_region" in names and "sql" not in names


def test_scan_read_tables_qualifies_against_the_notebooks_own_workspace():
    reads = scan_read_tables(["df = spark.table('raw_orders')"], "Analytics", "Bronze")
    assert reads == {make_ref("raw_orders", "Bronze", "Analytics")}


def test_scan_read_tables_keeps_a_cross_workspace_read_distinct():
    reads = scan_read_tables(
        ["a = spark.table('Finance.Gold.customers')", "b = spark.table('customers')"],
        "Analytics",
        "Gold",
    )
    assert reads == {
        make_ref("customers", "Gold", "Finance"),
        make_ref("customers", "Gold", "Analytics"),
    }
