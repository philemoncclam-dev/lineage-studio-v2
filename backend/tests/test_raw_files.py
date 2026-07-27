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
    assert out["reads"] == ["Landing/lh_landing/Files%2Forders%2F*.csv"]


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
    assert out["reads"] == ["Landing/lh_landing/Files%2Forders%2F*.csv"]
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
    assert kinds == {"Files/orders/*.csv": "file", "orders": "table"}


# --- the filename is the point ----------------------------------------------
#
# An earlier rule stripped the leaf back to its containing folder, so
# `customers.xlsx` became `Files/landing`. The name of the file is the whole
# reason for tracking the raw layer, so nothing is normalised away.


def test_a_named_file_keeps_its_name_and_extension():
    ref = qualify(f"{ABFSS}/Files/landing/customers.xlsx")
    assert parse_ref(ref)[2] == "Files/landing/customers.xlsx"


def test_a_glob_keeps_its_glob():
    """`orders/*.csv` says csv files under orders — both halves are information."""
    ref = qualify(f"{ABFSS}/Files/orders/*.csv")
    assert parse_ref(ref)[2] == "Files/orders/*.csv"


def test_a_dated_file_stays_its_own_source():
    ref = qualify(f"{ABFSS}/Files/raw/2024-01-01_orders.csv")
    assert parse_ref(ref)[2] == "Files/raw/2024-01-01_orders.csv"


def test_a_partitioned_path_is_kept_verbatim_too():
    """Collapsing partitions cannot be done without also deciding about the glob
    that follows them, and a rule that only sometimes keeps the filename is
    worse than one that always does."""
    ref = qualify(f"{ABFSS}/Files/orders/year=2024/month=01/*.parquet")
    assert parse_ref(ref)[2] == "Files/orders/year=2024/month=01/*.parquet"


def test_a_folder_and_a_file_under_it_are_different_sources():
    assert qualify(f"{ABFSS}/Files/orders") != qualify(f"{ABFSS}/Files/orders/jan.csv")
