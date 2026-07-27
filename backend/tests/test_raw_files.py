"""The raw file layer — landing sources, not tables.

A medallion notebook starts at files: `Files/landing/orders/*.csv` read into
bronze. Two things used to lose that layer entirely, so a bronze table appeared
to be written from nowhere:

  * the path character class had no `*`, and a glob is the normal way to name a
    landing folder — so the whole read vanished rather than degrading; and
  * only `.load()` was matched, never `spark.read.parquet(...)`.

And once matched, a file must not be laundered into a table: `Files/orders` and
a Delta table called `orders` are different things, and the file has no schema
to fetch. These pin all three.
"""

from __future__ import annotations

from app.sandbox._refs import is_file_ref, parse_ref, qualify, table_refs
from app.sandbox.protocol import RunRequest
from app.sandbox.runner import run_sandbox

ABFSS = "abfss://Landing@onelake.dfs.fabric.microsoft.com/lh_landing.Lakehouse"


def _run(*cells: str) -> dict:
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=list(cells),
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    assert result.ok, result.error
    return {"reads": result.reads, "writes": result.writes, "tables": result.tables}


# --- the two misses ---------------------------------------------------------


def test_a_glob_in_a_landing_path_is_still_a_read():
    out = _run(f"df = spark.read.format('csv').load('{ABFSS}/Files/orders/*.csv')")
    assert out["reads"] == ["Landing/lh_landing/Files%2Forders"]


def test_spark_read_parquet_is_a_read():
    """`spark.read.parquet(p)` is as ordinary as `.format('parquet').load(p)`."""
    out = _run("df = spark.read.parquet('Files/promos')")
    assert out["reads"] == ["Analytics/Bronze/Files%2Fpromos"]


def test_write_by_format_method_is_a_write():
    out = _run("df.write.mode('overwrite').parquet('Files/exports/daily')")
    assert out["writes"] == ["Analytics/Bronze/Files%2Fexports%2Fdaily"]


def test_the_landing_to_bronze_edge_exists():
    """The point of all of it: bronze is no longer written from nowhere."""
    out = _run(
        f"df = spark.read.csv('{ABFSS}/Files/orders/*.csv')\n"
        "df.write.saveAsTable('bronze_orders')"
    )
    assert out["reads"] == ["Landing/lh_landing/Files%2Forders"]
    assert out["writes"] == ["Analytics/Bronze/bronze_orders"]


def test_a_landing_read_keeps_its_own_workspace():
    """It is read FROM Landing, not from the notebook's own workspace."""
    out = _run(f"spark.read.csv('{ABFSS}/Files/orders/*.csv')")
    assert parse_ref(out["reads"][0])[0] == "Landing"


# --- a file is not a table --------------------------------------------------


def test_a_file_dataset_is_distinct_from_a_table_of_the_same_name():
    """The collision the `Files/` marker exists to prevent."""
    file_ref = qualify(f"{ABFSS}/Files/orders/*.csv")
    table_ref = qualify(f"{ABFSS}/Tables/orders")
    assert file_ref != table_ref
    assert is_file_ref(file_ref) and not is_file_ref(table_ref)


def test_a_file_ref_is_marked_as_a_file():
    refs = table_refs([qualify(f"{ABFSS}/Files/orders/*.csv"), qualify(f"{ABFSS}/Tables/orders")])
    kinds = {r["table"]: r["kind"] for r in refs.values()}
    assert kinds == {"Files/orders": "file", "orders": "table"}


# --- shards collapse to the dataset -----------------------------------------


def test_partitions_and_shards_collapse_to_one_source():
    """Otherwise every partition is its own node and the graph is unreadable."""
    same = {
        qualify(f"{ABFSS}/Files/orders/year=2024/month=01/part-0.parquet"),
        qualify(f"{ABFSS}/Files/orders/year=2025/*.parquet"),
        qualify(f"{ABFSS}/Files/orders"),
    }
    assert same == {"Landing/lh_landing/Files%2Forders"}


def test_an_interior_dot_is_part_of_the_identity():
    """Only TRAILING shard decoration is dropped; `orders.v2/` is a real folder."""
    ref = qualify(f"{ABFSS}/Files/orders.v2/data/*.parquet")
    assert parse_ref(ref)[2] == "Files/orders.v2/data"
