"""Materialise the demo lakehouse tables in OneLake, without running anything.

Why not just run the notebooks
------------------------------
Running them needs a Spark session on a Fabric capacity, which a trial capacity
will not always give you. But nothing about lineage needs the notebooks to have
run: what the sandbox reads from OneLake is each table's **schema**, and a Delta
table keeps its schema in `_delta_log`, not in its data files.

So this writes the transaction log directly over the OneLake filesystem API and
skips compute entirely. Fabric then sees real Delta tables, with real columns,
in the lakehouse explorer.

What you get, and what you don't
--------------------------------
Real tables with correct columns and types, and **zero rows**. The log carries a
`protocol` and a `metaData` action but no `add` action, which is precisely what
Delta calls an empty table — a legal state, not a broken one.

Rows are missing because writing them means writing Parquet, and there is no
Parquet writer in this environment (no pyarrow, no pandas) nor a reason to add
one: the sandbox never reads a single row. It registers empty views carrying
these schemas and analyses the plan. Data would change nothing it computes.

    py backend/scripts/seed_onelake_tables.py
    py backend/scripts/seed_onelake_tables.py --dry-run

Pairs with `seed_fabric_demo.py`, which creates the workspaces, lakehouses,
notebooks and pipelines. Run that one first. Auth is the Azure CLI, so there is
no secret here.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

ONELAKE = "https://onelake.dfs.fabric.microsoft.com"
WORKSPACE = "LS_Demo_Retail_Platform"

#: table → (lakehouse, [(column, delta type), …])
#:
#: These mirror what each notebook's final DataFrame produces. Delta spells a
#: few types differently from Spark — `integer` not `int` — and the difference
#: matters, because this string is what Fabric parses to show the columns.
TABLES: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "orders_raw": ("lh_landing", [
        ("OrderID", "string"), ("CustomerID", "string"), ("ProductID", "string"),
        ("OrderDate", "string"), ("Quantity", "integer"), ("UnitPrice", "double"),
    ]),
    "customers_raw": ("lh_landing", [
        ("CustomerID", "string"), ("FullName", "string"), ("Email", "string"),
        ("Country", "string"), ("SignupDate", "string"),
    ]),
    "products_raw": ("lh_landing", [
        ("ProductID", "string"), ("ProductName", "string"),
        ("Category", "string"), ("ListPrice", "double"),
    ]),

    "orders": ("lh_bronze", [
        ("order_id", "string"), ("customer_id", "string"), ("product_id", "string"),
        ("order_date", "date"), ("quantity", "integer"), ("unit_price", "double"),
    ]),
    "customers": ("lh_bronze", [
        ("customer_id", "string"), ("customer_name", "string"), ("email", "string"),
        ("country_code", "string"), ("signup_date", "date"),
    ]),
    "products": ("lh_bronze", [
        ("product_id", "string"), ("product_name", "string"),
        ("category", "string"), ("list_price", "double"),
    ]),

    "orders_enriched": ("lh_silver", [
        ("order_id", "string"), ("customer_id", "string"), ("customer_name", "string"),
        ("country_code", "string"), ("product_id", "string"), ("product_name", "string"),
        ("category", "string"), ("order_date", "date"), ("quantity", "integer"),
        ("unit_price", "double"), ("line_total", "double"), ("list_margin", "double"),
    ]),
    "customer_profile": ("lh_silver", [
        ("customer_id", "string"), ("customer_name", "string"), ("email", "string"),
        ("country_code", "string"), ("signup_date", "date"), ("first_order_date", "date"),
        ("last_order_date", "date"), ("order_count", "long"),
    ]),

    "customer_ltv": ("lh_gold", [
        ("customer_id", "string"), ("customer_name", "string"), ("country_code", "string"),
        ("signup_date", "date"), ("lifetime_value", "double"),
        ("orders_placed", "long"), ("avg_order_value", "double"),
    ]),
    "product_performance": ("lh_gold", [
        ("product_id", "string"), ("product_name", "string"), ("category", "string"),
        ("units_sold", "long"), ("revenue", "double"), ("distinct_buyers", "long"),
    ]),
    "daily_sales": ("lh_gold", [
        ("order_date", "date"), ("region", "string"),
        ("country_code", "string"), ("gross_sales", "double"),
    ]),
}


def _az() -> str:
    found = shutil.which("az") or shutil.which("az.cmd")
    if found:
        return found
    guess = Path(r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd")
    if guess.exists():
        return str(guess)
    sys.exit("could not find the Azure CLI (az). Install it, or add it to PATH.")


def token() -> str:
    """A storage token — OneLake's filesystem API is ADLS Gen2, not the Fabric API."""
    out = subprocess.run(
        [_az(), "account", "get-access-token", "--resource", "https://storage.azure.com",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode != 0 or not out.stdout.strip():
        sys.exit(f"could not get a storage token — run `az login` first.\n{out.stderr}")
    return out.stdout.strip()


def delta_log(columns: list[tuple[str, str]]) -> str:
    """Version 0 of a Delta transaction log: a schema and nothing else.

    Three newline-delimited actions. `protocol` states the reader/writer
    versions, `metaData` carries the schema (itself a JSON *string*, which is
    Delta's format and not a nesting mistake), and there is deliberately no
    `add` — no data files exist.
    """
    schema = {
        "type": "struct",
        "fields": [
            {"name": name, "type": kind, "nullable": True, "metadata": {}}
            for name, kind in columns
        ],
    }
    actions = [
        {"protocol": {"minReaderVersion": 1, "minWriterVersion": 2}},
        {
            "metaData": {
                "id": str(uuid.uuid4()),
                "format": {"provider": "parquet", "options": {}},
                "schemaString": json.dumps(schema),
                "partitionColumns": [],
                "configuration": {},
                "createdTime": int(time.time() * 1000),
            }
        },
    ]
    return "\n".join(json.dumps(a) for a in actions) + "\n"


def put_file(session, url: str, body: str, tok: str) -> None:
    """Create, append, flush — the three-step ADLS Gen2 write."""
    head = {"Authorization": f"Bearer {tok}"}
    data = body.encode("utf-8")

    made = session.put(f"{url}?resource=file", headers=head, timeout=60)
    if made.status_code >= 400:
        raise RuntimeError(f"create failed {made.status_code}: {made.text[:300]}")

    app = session.patch(
        f"{url}?action=append&position=0", headers=head, data=data, timeout=120
    )
    if app.status_code >= 400:
        raise RuntimeError(f"append failed {app.status_code}: {app.text[:300]}")

    flush = session.patch(
        f"{url}?action=flush&position={len(data)}", headers=head, timeout=60
    )
    if flush.status_code >= 400:
        raise RuntimeError(f"flush failed {flush.status_code}: {flush.text[:300]}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Create the demo Delta tables in OneLake.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    by_lake: dict[str, list[str]] = {}
    for table, (lake, _cols) in TABLES.items():
        by_lake.setdefault(lake, []).append(table)
    for lake in sorted(by_lake):
        print(f"  {lake}: {', '.join(sorted(by_lake[lake]))}")
    if args.dry_run:
        return

    import requests

    tok = token()
    session = requests.Session()
    ok = 0
    for table, (lake, cols) in TABLES.items():
        url = f"{ONELAKE}/{WORKSPACE}/{lake}.Lakehouse/Tables/{table}/_delta_log/00000000000000000000.json"
        try:
            put_file(session, url, delta_log(cols), tok)
            print(f"    {lake}/{table}: {len(cols)} columns")
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print(f"    {lake}/{table}: FAILED — {exc}")
    print(f"\n{ok}/{len(TABLES)} tables written.")


if __name__ == "__main__":
    main()
