"""Build a fake-but-realistic Fabric data product, for testing lineage end to end.

Why this exists
---------------
The sandbox needs something to chew on that looks like real customer work rather
than a hand-written test cell. This creates two workspaces:

  * **LS_Demo_Retail_Platform** — storage only: `lh_landing`, `lh_bronze`,
    `lh_silver`, `lh_gold`. No code lives here.
  * **LS_Demo_Retail_Engineering** — every notebook and pipeline. Nothing is
    stored here.

Splitting them is the point, not decoration: the notebooks write ACROSS a
workspace boundary, which is the case that breaks naive lineage (an unqualified
table name resolves against the notebook's own workspace, and there is nothing
here for it to resolve to).

Two deliberate constraints
--------------------------
1. **Every notebook is PySpark DataFrame API. No `spark.sql`, anywhere.** The
   SQL path is already well covered by `_sqllineage` (sqlglot parses it
   properly). The DataFrame path is the one where the stub engine reads chains
   symbolically and Catalyst reads them for real, so it is where the two
   engines can disagree — which makes it the path worth having real fixtures
   for.

2. **Every table path is a string LITERAL.** This looks verbose — the same long
   `abfss://` URL over and over, where a helper function would be nicer code —
   but a helper is exactly what defeats the test. Both engines' readers require
   a literal to resolve a path (`.load(...)`/`.save(...)` match on quoted
   strings; the stub abstains on a name bound under control flow). A tidy
   `def tbl(lh, name)` would make every notebook here resolve to nothing, and
   the fixture would silently stop testing anything.

Idempotent: re-running updates the definitions of items that already exist
rather than creating duplicates. Safe to run repeatedly while iterating.

    py backend/scripts/seed_fabric_demo.py            # create/update everything
    py backend/scripts/seed_fabric_demo.py --dry-run  # print the plan only

Auth comes from the Azure CLI (`az login`), so there is no secret here.
"""

from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

API = "https://api.fabric.microsoft.com/v1"

PLATFORM_WS = "LS_Demo_Retail_Platform"
ENGINEERING_WS = "LS_Demo_Retail_Engineering"
LAKEHOUSES = ["lh_landing", "lh_bronze", "lh_silver", "lh_gold"]

#: The trial capacity. Workspaces need one or Fabric refuses to create items in
#: them; without it the failure arrives later and reads like a permissions bug.
CAPACITY_ID = "129cf3c0-976e-48e7-965a-3bd486806928"


def _t(lakehouse: str, table: str) -> str:
    """A OneLake table path. Used to BUILD the source text, never at runtime."""
    return (
        f"abfss://{PLATFORM_WS}@onelake.dfs.fabric.microsoft.com/"
        f"{lakehouse}.Lakehouse/Tables/{table}"
    )


# --------------------------------------------------------------------------
# The notebooks. Read as a data product: landing → bronze → silver → gold.
# --------------------------------------------------------------------------

NOTEBOOKS: dict[str, str] = {}

# --- landing: simulated ingest ------------------------------------------------
# createDataFrame from literals, so the tables physically materialise if anyone
# runs the pipeline. For lineage this is a genuine dead end — there is no source
# table upstream — and both engines should say so rather than invent one.

NOTEBOOKS["nb_10_landing_orders"] = f'''
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DoubleType

schema = StructType([
    StructField("OrderID", StringType()),
    StructField("CustomerID", StringType()),
    StructField("ProductID", StringType()),
    StructField("OrderDate", StringType()),
    StructField("Quantity", IntegerType()),
    StructField("UnitPrice", DoubleType()),
])

rows = [
    ("O-1001", "C-01", "P-01", "2026-01-04", 2, 19.99),
    ("O-1002", "C-02", "P-03", "2026-01-05", 1, 249.00),
    ("O-1003", "C-01", "P-02", "2026-01-07", 5, 4.50),
    ("O-1004", "C-03", "P-01", "2026-02-11", 1, 19.99),
    ("O-1005", "C-02", "P-02", "2026-02-14", 3, 4.50),
]

orders_raw = spark.createDataFrame(rows, schema)
orders_raw.write.format("delta").mode("overwrite").save("{_t("lh_landing", "orders_raw")}")
'''

NOTEBOOKS["nb_11_landing_customers"] = f'''
from pyspark.sql.types import StructType, StructField, StringType

schema = StructType([
    StructField("CustomerID", StringType()),
    StructField("FullName", StringType()),
    StructField("Email", StringType()),
    StructField("Country", StringType()),
    StructField("SignupDate", StringType()),
])

rows = [
    ("C-01", "Ada Lovelace", "ada@example.com", "uk", "2025-03-02"),
    ("C-02", "Grace Hopper", "grace@example.com", "us", "2025-06-19"),
    ("C-03", "Alan Turing", "alan@example.com", "uk", "2025-11-30"),
]

customers_raw = spark.createDataFrame(rows, schema)
customers_raw.write.format("delta").mode("overwrite").save("{_t("lh_landing", "customers_raw")}")
'''

NOTEBOOKS["nb_12_landing_products"] = f'''
from pyspark.sql.types import StructType, StructField, StringType, DoubleType

schema = StructType([
    StructField("ProductID", StringType()),
    StructField("ProductName", StringType()),
    StructField("Category", StringType()),
    StructField("ListPrice", DoubleType()),
])

rows = [
    ("P-01", "Mechanical Keyboard", "peripherals", 19.99),
    ("P-02", "USB-C Cable", "accessories", 4.50),
    ("P-03", "27in Monitor", "displays", 249.00),
]

products_raw = spark.createDataFrame(rows, schema)
products_raw.write.format("delta").mode("overwrite").save("{_t("lh_landing", "products_raw")}")
'''

# --- bronze: rename, cast, typed ---------------------------------------------
# Straight passthroughs and renames. Every output column has exactly one source,
# so this is the layer where column lineage should be complete — if an engine
# drops an edge here, it is wrong, not merely cautious.

NOTEBOOKS["nb_20_bronze_orders"] = f'''
from pyspark.sql.functions import col, to_date

orders_raw = spark.read.format("delta").load("{_t("lh_landing", "orders_raw")}")

orders = (
    orders_raw
    .withColumnRenamed("OrderID", "order_id")
    .withColumnRenamed("CustomerID", "customer_id")
    .withColumnRenamed("ProductID", "product_id")
    .withColumn("order_date", to_date(col("OrderDate")))
    .withColumn("quantity", col("Quantity").cast("int"))
    .withColumn("unit_price", col("UnitPrice").cast("double"))
    .drop("OrderDate", "Quantity", "UnitPrice")
)

orders.write.format("delta").mode("overwrite").save("{_t("lh_bronze", "orders")}")
'''

NOTEBOOKS["nb_21_bronze_customers"] = f'''
from pyspark.sql.functions import col, lower, to_date, upper

customers_raw = spark.read.format("delta").load("{_t("lh_landing", "customers_raw")}")

customers = (
    customers_raw
    .withColumnRenamed("CustomerID", "customer_id")
    .withColumnRenamed("FullName", "customer_name")
    .withColumn("email", lower(col("Email")))
    .withColumn("country_code", upper(col("Country")))
    .withColumn("signup_date", to_date(col("SignupDate")))
    .drop("Email", "Country", "SignupDate")
)

customers.write.format("delta").mode("overwrite").save("{_t("lh_bronze", "customers")}")
'''

NOTEBOOKS["nb_22_bronze_products"] = f'''
from pyspark.sql.functions import col, lower

products_raw = spark.read.format("delta").load("{_t("lh_landing", "products_raw")}")

products = (
    products_raw
    .withColumnRenamed("ProductID", "product_id")
    .withColumnRenamed("ProductName", "product_name")
    .withColumn("category", lower(col("Category")))
    .withColumn("list_price", col("ListPrice").cast("double"))
    .drop("Category", "ListPrice")
)

products.write.format("delta").mode("overwrite").save("{_t("lh_bronze", "products")}")
'''

# --- silver: joins ------------------------------------------------------------
# The interesting case. `customer_id` and `product_id` exist on both sides of a
# join, which is precisely when a name-matching lineage reader invents a wrong
# edge. Catalyst knows which relation each output column came from; the stub
# reader is supposed to ABSTAIN rather than guess. Disagreement here is the
# signal this fixture exists to produce.

NOTEBOOKS["nb_30_silver_orders_enriched"] = f'''
from pyspark.sql.functions import col

orders = spark.read.format("delta").load("{_t("lh_bronze", "orders")}")
customers = spark.read.format("delta").load("{_t("lh_bronze", "customers")}")
products = spark.read.format("delta").load("{_t("lh_bronze", "products")}")

joined = (
    orders
    .join(customers, "customer_id", "left")
    .join(products, "product_id", "left")
)

orders_enriched = (
    joined
    .withColumn("line_total", col("quantity") * col("unit_price"))
    .withColumn("list_margin", col("list_price") - col("unit_price"))
    .select(
        "order_id",
        "customer_id",
        "customer_name",
        "country_code",
        "product_id",
        "product_name",
        "category",
        "order_date",
        "quantity",
        "unit_price",
        "line_total",
        "list_margin",
    )
)

orders_enriched.write.format("delta").mode("overwrite").save("{_t("lh_silver", "orders_enriched")}")
'''

NOTEBOOKS["nb_31_silver_customer_profile"] = f'''
from pyspark.sql.functions import col, countDistinct, max as smax, min as smin

customers = spark.read.format("delta").load("{_t("lh_bronze", "customers")}")
orders = spark.read.format("delta").load("{_t("lh_bronze", "orders")}")

activity = (
    orders
    .groupBy("customer_id")
    .agg(
        smin("order_date").alias("first_order_date"),
        smax("order_date").alias("last_order_date"),
        countDistinct("order_id").alias("order_count"),
    )
)

customer_profile = (
    customers
    .join(activity, "customer_id", "left")
    .select(
        "customer_id",
        "customer_name",
        "email",
        "country_code",
        "signup_date",
        "first_order_date",
        "last_order_date",
        "order_count",
    )
)

customer_profile.write.format("delta").mode("overwrite").save("{_t("lh_silver", "customer_profile")}")
'''

# --- gold: aggregates ---------------------------------------------------------
# Aggregates have no single source column, so an engine that falls back to
# "assume a same-named source" invents edges here. Correct output is an edge
# from the aggregated input, and nothing at all for a literal.

NOTEBOOKS["nb_40_gold_customer_ltv"] = f'''
from pyspark.sql.functions import col, count, sum as ssum

orders_enriched = spark.read.format("delta").load("{_t("lh_silver", "orders_enriched")}")
customer_profile = spark.read.format("delta").load("{_t("lh_silver", "customer_profile")}")

spend = (
    orders_enriched
    .groupBy("customer_id")
    .agg(
        ssum("line_total").alias("lifetime_value"),
        count("order_id").alias("orders_placed"),
    )
)

customer_ltv = (
    customer_profile
    .join(spend, "customer_id", "left")
    .withColumn("avg_order_value", col("lifetime_value") / col("orders_placed"))
    .select(
        "customer_id",
        "customer_name",
        "country_code",
        "signup_date",
        "lifetime_value",
        "orders_placed",
        "avg_order_value",
    )
)

customer_ltv.write.format("delta").mode("overwrite").save("{_t("lh_gold", "customer_ltv")}")
'''

NOTEBOOKS["nb_41_gold_product_performance"] = f'''
from pyspark.sql.functions import countDistinct, sum as ssum

orders_enriched = spark.read.format("delta").load("{_t("lh_silver", "orders_enriched")}")

product_performance = (
    orders_enriched
    .groupBy("product_id", "product_name", "category")
    .agg(
        ssum("quantity").alias("units_sold"),
        ssum("line_total").alias("revenue"),
        countDistinct("customer_id").alias("distinct_buyers"),
    )
)

product_performance.write.format("delta").mode("overwrite").save("{_t("lh_gold", "product_performance")}")
'''

# A union, which is the remaining DataFrame shape the stub reader claims to
# follow — and one where both branches contribute to every output column.
NOTEBOOKS["nb_42_gold_daily_sales"] = f'''
from pyspark.sql.functions import col, lit, sum as ssum

orders_enriched = spark.read.format("delta").load("{_t("lh_silver", "orders_enriched")}")

by_day = (
    orders_enriched
    .groupBy("order_date", "country_code")
    .agg(ssum("line_total").alias("gross_sales"))
)

uk = by_day.filter(col("country_code") == "UK").withColumn("region", lit("UK"))
row = by_day.filter(col("country_code") != "UK").withColumn("region", lit("ROW"))

daily_sales = (
    uk.union(row)
    .select("order_date", "region", "country_code", "gross_sales")
)

daily_sales.write.format("delta").mode("overwrite").save("{_t("lh_gold", "daily_sales")}")
'''


# --------------------------------------------------------------------------
# The pipelines. Three levels deep on the bronze branch, so "a pipeline inside
# a pipeline" is a real case here and not just a claim.
#
#   pl_00_master
#     ├── pl_10_landing            → 3 notebooks
#     ├── pl_20_bronze             → pl_21_bronze_dimensions, pl_22_bronze_facts
#     │      ├── pl_21_bronze_dimensions → 2 notebooks
#     │      └── pl_22_bronze_facts      → 1 notebook
#     ├── pl_30_silver             → 2 notebooks
#     └── pl_40_gold               → 3 notebooks
# --------------------------------------------------------------------------

#: name → (list of notebook names, list of child pipeline names)
PIPELINES: list[tuple[str, list[str], list[str]]] = [
    ("pl_10_landing", ["nb_10_landing_orders", "nb_11_landing_customers", "nb_12_landing_products"], []),
    ("pl_21_bronze_dimensions", ["nb_21_bronze_customers", "nb_22_bronze_products"], []),
    ("pl_22_bronze_facts", ["nb_20_bronze_orders"], []),
    ("pl_20_bronze", [], ["pl_21_bronze_dimensions", "pl_22_bronze_facts"]),
    ("pl_30_silver", ["nb_30_silver_orders_enriched", "nb_31_silver_customer_profile"], []),
    ("pl_40_gold", ["nb_40_gold_customer_ltv", "nb_41_gold_product_performance", "nb_42_gold_daily_sales"], []),
    ("pl_00_master", [], ["pl_10_landing", "pl_20_bronze", "pl_30_silver", "pl_40_gold"]),
]


# --------------------------------------------------------------------------
# Fabric REST plumbing
# --------------------------------------------------------------------------


def _az() -> str:
    """The Azure CLI, found rather than assumed.

    The installer puts `az.cmd` somewhere off the default PATH on Windows often
    enough that `shell=True` alone fails with "not recognized" — which reads
    like "you are not logged in" and sends you to fix the wrong thing.
    """
    found = shutil.which("az") or shutil.which("az.cmd")
    if found:
        return found
    for guess in (
        r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
        r"C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
    ):
        if Path(guess).exists():
            return guess
    sys.exit("could not find the Azure CLI (az). Install it, or add it to PATH.")


def token() -> str:
    out = subprocess.run(
        [
            _az(), "account", "get-access-token",
            "--resource", "https://api.fabric.microsoft.com",
            "--query", "accessToken", "-o", "tsv",
        ],
        capture_output=True, text=True,
    )
    if out.returncode != 0 or not out.stdout.strip():
        sys.exit(f"could not get a Fabric token — run `az login` first.\n{out.stderr}")
    return out.stdout.strip()


TOKEN = ""


def api(method: str, path: str, body: dict | None = None, *, quiet: bool = False) -> Any:
    """One Fabric call, with the long-running-operation dance folded in.

    Item creation answers 202 + a Location header as often as it answers 201,
    and the difference is not predictable per item type — so both are handled
    here rather than at every call site.
    """
    import requests

    url = path if path.startswith("http") else f"{API}{path}"
    resp = requests.request(
        method, url,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json=body, timeout=120,
    )
    if resp.status_code == 202:
        location = resp.headers.get("Location")
        for _ in range(60):
            time.sleep(3)
            poll = requests.get(location, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=60)
            state = (poll.json() or {}).get("status", "")
            if state in ("Succeeded", "Completed"):
                result = requests.get(
                    f"{location}/result", headers={"Authorization": f"Bearer {TOKEN}"}, timeout=60
                )
                return result.json() if result.content else {}
            if state == "Failed":
                raise RuntimeError(f"{method} {path} failed: {poll.text}")
        raise RuntimeError(f"{method} {path} timed out waiting for the operation")
    if resp.status_code >= 400:
        if quiet:
            return None
        raise RuntimeError(f"{method} {path} -> {resp.status_code}: {resp.text[:400]}")
    return resp.json() if resp.content else {}


def b64(obj: Any) -> str:
    raw = obj if isinstance(obj, str) else json.dumps(obj)
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


def ensure_workspace(name: str) -> str:
    for w in api("GET", "/workspaces").get("value", []):
        if w.get("displayName") == name:
            print(f"  workspace {name}: exists")
            return w["id"]
    made = api("POST", "/workspaces", {"displayName": name, "capacityId": CAPACITY_ID})
    print(f"  workspace {name}: created")
    return made["id"]


def existing_items(ws: str, kind: str) -> dict[str, str]:
    items = api("GET", f"/workspaces/{ws}/items?type={kind}").get("value", [])
    return {i["displayName"]: i["id"] for i in items}


def ensure_lakehouse(ws: str, name: str, have: dict[str, str]) -> str:
    if name in have:
        print(f"    {name}: exists")
        return have[name]
    made = api("POST", f"/workspaces/{ws}/lakehouses", {"displayName": name})
    print(f"    {name}: created")
    return made["id"]


def notebook_payload(name: str, source: str) -> dict:
    """A Fabric .ipynb, one code cell, PySpark kernel."""
    lines = [ln + "\n" for ln in source.strip().splitlines()]
    doc = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "language_info": {"name": "python"},
            "kernelspec": {"name": "synapse_pyspark", "display_name": "Synapse PySpark"},
            "microsoft": {"language": "python"},
        },
        "cells": [
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": lines,
            }
        ],
    }
    return {
        "format": "ipynb",
        "parts": [
            {"path": "notebook-content.ipynb", "payload": b64(doc), "payloadType": "InlineBase64"}
        ],
    }


def pipeline_payload(notebooks: list[str], children: list[str], ids: dict[str, str], ws: str) -> dict:
    """Activities chained with `dependsOn`, so the run order is the DAG order."""
    activities: list[dict] = []
    previous: str | None = None

    for nb in notebooks:
        act = {
            "name": f"run {nb}",
            "type": "TridentNotebook",
            "dependsOn": (
                [{"activity": previous, "dependencyConditions": ["Succeeded"]}] if previous else []
            ),
            "typeProperties": {"notebookId": ids[nb], "workspaceId": ws},
        }
        activities.append(act)
        previous = act["name"]

    for child in children:
        # `ExecutePipeline`, not the newer `InvokePipeline` the Fabric canvas
        # emits. Both express "run that pipeline"; InvokePipeline additionally
        # requires an `externalReferences.connection` GUID — a Fabric connection
        # that has to be created and consented to interactively — and the API
        # rejects the item outright without one ("'ExternalReferences' cannot be
        # null"). ExecutePipeline needs no connection for a same-workspace
        # child, which is all this fixture does.
        act = {
            "name": f"invoke {child}",
            "type": "ExecutePipeline",
            "dependsOn": (
                [{"activity": previous, "dependencyConditions": ["Succeeded"]}] if previous else []
            ),
            "typeProperties": {
                "pipeline": {"referenceName": ids[child], "type": "PipelineReference"},
                "waitOnCompletion": True,
            },
        }
        activities.append(act)
        previous = act["name"]

    return {
        "parts": [
            {
                "path": "pipeline-content.json",
                "payload": b64({"properties": {"activities": activities}}),
                "payloadType": "InlineBase64",
            }
        ]
    }


def upsert(ws: str, kind: str, route: str, name: str, definition: dict, have: dict[str, str]) -> str:
    """Create, or replace the definition of one that is already there."""
    if name in have:
        api("POST", f"/workspaces/{ws}/items/{have[name]}/updateDefinition", {"definition": definition})
        print(f"    {name}: updated")
        return have[name]
    made = api("POST", f"/workspaces/{ws}/{route}", {"displayName": name, "definition": definition})
    print(f"    {name}: created")
    return made["id"]


def main() -> None:
    global TOKEN

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="print the plan, create nothing")
    args = ap.parse_args()

    print(f"Platform workspace : {PLATFORM_WS}  ({len(LAKEHOUSES)} lakehouses)")
    print(f"Engineering        : {ENGINEERING_WS}  "
          f"({len(NOTEBOOKS)} notebooks, {len(PIPELINES)} pipelines)")
    if args.dry_run:
        print("\n-- notebooks --")
        for n in NOTEBOOKS:
            print("  ", n)
        print("\n-- pipelines (children must exist first) --")
        for name, nbs, kids in PIPELINES:
            print(f"   {name}: notebooks={nbs or '—'} children={kids or '—'}")
        return

    TOKEN = token()

    print("\nplatform:")
    platform = ensure_workspace(PLATFORM_WS)
    have_lh = existing_items(platform, "Lakehouse")
    for lh in LAKEHOUSES:
        ensure_lakehouse(platform, lh, have_lh)

    print("\nengineering:")
    eng = ensure_workspace(ENGINEERING_WS)

    print("  notebooks:")
    have_nb = existing_items(eng, "Notebook")
    ids: dict[str, str] = {}
    for name, source in NOTEBOOKS.items():
        ids[name] = upsert(eng, "Notebook", "notebooks", name, notebook_payload(name, source), have_nb)

    print("  pipelines:")
    have_pl = existing_items(eng, "DataPipeline")
    for name, nbs, kids in PIPELINES:
        ids[name] = upsert(
            eng, "DataPipeline", "dataPipelines", name,
            pipeline_payload(nbs, kids, ids, eng), have_pl,
        )

    print(f"\ndone.\n  platform    {platform}\n  engineering {eng}")


if __name__ == "__main__":
    main()
