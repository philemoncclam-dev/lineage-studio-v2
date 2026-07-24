"""The real sandbox executor (M2b) — runs a notebook in a local Spark session
and derives lineage from Spark's own analyzed plans, never from execution.

Why plan-capture and not execution: on this stack (PySpark 4 + Python 3.12 +
Windows) any *action* spawns a Python worker that crashes, but the analyzed
logical plan is pure JVM Catalyst and resolves fine. So the notebook's DataFrame
code runs in the driver (building plans), reads resolve against empty temp views
carrying the real schema, and each **write** is intercepted to capture its
analyzed plan + output schema instead of triggering an action. Nothing executes,
nothing is written, and no real Fabric table is ever touched.

Same isolation contract as child_stub.py: standalone (imports nothing from
`app`), launched by path in a throwaway cwd with a scrubbed environment, so it
has no route to the repo `.env` or the Fabric client. Speaks the same JSON
contract (protocol.py) — reads a RunRequest file (argv[1]), writes a RunResult
to stdout — so the runner, router, and frontend are unchanged.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import types
from contextlib import redirect_stdout
from pathlib import Path

# Loopback binding + a Python interpreter for the driver — set before Spark
# imports so the JVM picks them up. (Actions still won't run; this keeps the
# driver side clean.)
os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")
os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
os.environ.setdefault("PYSPARK_DRIVER_PYTHON", sys.executable)

_WRITE_SQL = re.compile(
    r"""^\s*(?:
        INSERT\s+(?:INTO|OVERWRITE)\s+(?:TABLE\s+)?(?P<t1>[\w.`]+)\s+(?P<sel1>.*)
      | CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?P<t2>[\w.`]+)\s+.*?\bAS\b\s+(?P<sel2>SELECT.*)
    )""",
    re.I | re.S | re.X,
)
_VIEW_IN_PLAN = re.compile(r"View \(`([^`]+)`", re.I)
_UNRESOLVED_IN_PLAN = re.compile(r"UnresolvedRelation \[([^\],]+)", re.I)


def _short(ref: str) -> str:
    ref = ref.strip().strip("`").rstrip("/")
    return ref.split("/")[-1].split(".")[-1]


def _saw_credentials() -> bool:
    for key in os.environ:
        up = key.upper()
        if up.startswith(("PURVIEW_", "AZURE_")) or "SECRET" in up or "TOKEN" in up:
            return True
    return False


def _ddl(cols: list[dict]) -> str:
    return ", ".join(f"`{c['name']}` {c.get('type') or 'string'}" for c in cols if c.get("name"))


def main() -> None:
    req = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    cells: list[str] = req.get("cells", [])
    schemas: dict[str, list[dict]] = req.get("schemas", {})
    creds = _saw_credentials()

    from pyspark.sql import SparkSession
    from pyspark.sql.readwriter import DataFrameWriter
    from pyspark.sql.types import StructType

    spark = (
        SparkSession.builder.master("local[1]")
        .appName("lineage-sandbox")
        .config("spark.ui.enabled", "false")
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.sql.shuffle.partitions", "1")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("ERROR")

    log: list[str] = ["[spark] engine=spark — plan analysis only, no actions executed."]
    if creds:
        log.append("[spark] WARNING: credential env visible to child — isolation breach.")

    # Empty temp views carrying the real schema, so reads resolve with zero data.
    registered: set[str] = set()
    for tname, cols in schemas.items():
        view = _short(tname)
        ddl = _ddl(cols)
        df = spark.createDataFrame([], ddl) if ddl else spark.createDataFrame([], StructType())
        df.createOrReplaceTempView(view)
        registered.add(view)
    if registered:
        log.append(f"[spark] registered {len(registered)} empty view(s): {sorted(registered)}")

    writes: list[str] = []
    reads: set[str] = set()
    table_schemas: dict[str, list[dict]] = {}

    def _capture(target: str, df) -> None:
        name = _short(target)
        if name not in writes:
            writes.append(name)
        try:
            plan = df._jdf.queryExecution().analyzed().toString()
            reads.update(_short(m) for m in _VIEW_IN_PLAN.findall(plan))
            reads.update(_short(m) for m in _UNRESOLVED_IN_PLAN.findall(plan))
            table_schemas[name] = [
                {"name": f.name, "type": f.dataType.simpleString()} for f in df.schema.fields
            ]
        except Exception as exc:  # noqa: BLE001 — a capture failure must not abort the run
            log.append(f"[spark] could not analyze write to {name}: {exc}")

    # Intercept the DataFrame write verbs — capture the plan instead of running.
    def _saveAsTable(self, name, *a, **k):  # noqa: ANN001
        _capture(name, self._df)

    def _insertInto(self, name, *a, **k):  # noqa: ANN001
        _capture(name, self._df)

    DataFrameWriter.saveAsTable = _saveAsTable
    DataFrameWriter.insertInto = _insertInto
    DataFrameWriter.save = lambda self, *a, **k: None  # path writes: no-op sink

    # Intercept SQL writes; let read queries build their (lazy) plan normally.
    _orig_sql = spark.sql

    def _sql(query, *a, **k):  # noqa: ANN001
        m = _WRITE_SQL.match(query or "")
        if m:
            target = m.group("t1") or m.group("t2")
            select = m.group("sel1") or m.group("sel2")
            try:
                _capture(target, _orig_sql(select))
            except Exception as exc:  # noqa: BLE001
                log.append(f"[spark] sql write to {target} not analyzable: {exc}")
                writes.append(_short(target))
            return None
        return _orig_sql(query, *a, **k)

    spark.sql = _sql

    # notebookutils / mssparkutils don't exist off-Fabric — stub them so imports
    # and common calls don't explode the cell.
    for mod in ("notebookutils", "mssparkutils"):
        stub = types.ModuleType(mod)
        stub.__getattr__ = lambda _name: (lambda *a, **k: None)  # type: ignore[attr-defined]
        sys.modules[mod] = stub

    # Neuter actions: on this stack they crash the Python worker, and lineage
    # needs none of them. Benign return values keep cell control-flow alive.
    from pyspark.sql import DataFrame as _DF

    _DF.show = lambda self, *a, **k: None
    _DF.collect = lambda self, *a, **k: []
    _DF.count = lambda self, *a, **k: 0
    _DF.toPandas = lambda self, *a, **k: None
    _DF.take = lambda self, *a, **k: []
    _DF.first = lambda self, *a, **k: None
    _DF.head = lambda self, *a, **k: None

    glb: dict = {"spark": spark, "__name__": "__sandbox__"}
    cell_results = []
    for i, cell in enumerate(cells):
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                exec(compile(cell, f"<cell-{i}>", "exec"), glb)  # noqa: S102 — the sandbox's purpose
            status, err = "ok", None
        except Exception as exc:  # noqa: BLE001
            status, err = "error", f"{type(exc).__name__}: {exc}"
            log.append(f"[spark] cell {i} error: {err}")
        cell_results.append(
            {"index": i, "status": status, "reads": [], "writes": [], "stdout": buf.getvalue()[:4000], "error": err}
        )

    spark.stop()

    result = {
        "ok": True,
        "engine": "spark",
        "cells": cell_results,
        "reads": sorted(reads - set(writes)),
        "writes": sorted(set(writes)),
        "table_schemas": table_schemas,
        "log": log,
        "saw_credentials": creds,
        "error": None,
    }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback

        sys.stdout.write(
            json.dumps(
                {"ok": False, "engine": "spark", "error": f"{type(exc).__name__}: {exc}", "log": [traceback.format_exc()[:2000]]}
            )
        )
        sys.exit(1)
