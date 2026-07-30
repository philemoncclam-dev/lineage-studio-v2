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

# Sibling module, pure stdlib — see the note in child_stub.py. Not part of
# `app`, so the isolation contract in the docstring above still holds.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _coverage  # noqa: E402
import _refs  # noqa: E402

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


def _scala_seq(seq) -> list:  # noqa: ANN001
    try:
        return [seq.apply(i) for i in range(seq.size())]
    except Exception:  # noqa: BLE001
        return []


def _column_flows(df, target_ref: str) -> list[dict]:
    """Per-output-column source columns, from the write's analyzed plan.

    Each output NamedExpression exposes its input `references()` (attributes by
    name); passthrough columns reference just themselves, computed ones
    reference the inputs they derive from. Anything we can't map falls back to
    an identity (same-named) source so a copy still draws an edge.
    """
    out_names = [f.name for f in df.schema.fields]
    flows: dict[str, tuple[list[str], str | None]] = {}
    try:
        plan = df._jdf.queryExecution().analyzed()
        for expr in _scala_seq(plan.expressions()):
            try:
                name = expr.name()
            except Exception:  # noqa: BLE001
                continue
            if name not in out_names:
                continue
            refs = list(dict.fromkeys(a.name() for a in _scala_seq(expr.references().toSeq())))
            transform = None
            if not (len(refs) == 1 and refs[0] == name):
                try:
                    transform = expr.sql()
                except Exception:  # noqa: BLE001
                    transform = None
            flows[name] = (refs, transform)
    except Exception:  # noqa: BLE001
        pass

    result: list[dict] = []
    for out_col in out_names:
        refs, transform = flows.get(out_col, ([out_col], None))
        for src in refs:
            result.append(
                {"to_table": target_ref, "to_column": out_col, "from_column": src, "transform": transform}
            )
    return result


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
    # The notebook's own workspace/lakehouse — what a bare table name means.
    ctx = {
        "default_workspace": req.get("workspace", ""),
        "default_lakehouse": req.get("lakehouse", ""),
        "name_map": req.get("name_map", {}),
    }

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
    # `views` maps a Spark view name back to the ref it stands for, which is how
    # a plan's `View (\`name\`)` is resolved to a workspace-qualified table.
    views: dict[str, str] = {}
    for tname, cols in schemas.items():
        ref = _refs.as_ref(tname, **ctx)
        view = _refs.view_name(ref, views)
        ddl = _ddl(cols)
        df = spark.createDataFrame([], ddl) if ddl else spark.createDataFrame([], StructType())
        df.createOrReplaceTempView(view)
    if views:
        log.append(f"[spark] registered {len(views)} empty view(s): {sorted(views)}")

    writes: list[str] = []
    reads: set[str] = set()
    # Seed with the registered input views so read tables carry their columns
    # too — the frontend needs source-side columns to draw column edges.
    table_schemas: dict[str, list[dict]] = {
        _refs.as_ref(t, **ctx): [{"name": c["name"], "type": c.get("type")} for c in cols]
        for t, cols in schemas.items()
    }
    column_lineage: list[dict] = []

    def _register_written(ref: str, df) -> None:
        """Publish a written table back into the session as an empty view.

        Without this a later cell reading the table this notebook just wrote
        can't resolve the name: it falls through to the session catalog, which
        off-Fabric has no such table. The read edge is then lost and the
        downstream table gets no columns. Registering the *schema* (never any
        data) makes the chain resolve exactly as it would in Fabric.
        """
        try:
            view = _refs.view_name(ref, views)
            ddl = _ddl(table_schemas.get(ref, []))
            empty = spark.createDataFrame([], ddl) if ddl else spark.createDataFrame([], StructType())
            empty.createOrReplaceTempView(view)
        except Exception as exc:  # noqa: BLE001 — best effort; the run continues
            log.append(f"[spark] could not publish {_refs.table_of(ref)} as a view: {exc}")

    def _resolve_read(token: str) -> str:
        """A name out of a plan → a ref: a known view if it is one, else parsed."""
        return views.get(token.strip("`"), "") or _refs.as_ref(token, **ctx)

    def _capture(target: str, df) -> None:
        # A SQL write's target may already have been rewritten to a view name
        # (when the notebook writes to a table it also reads); map it back.
        ref = views.get(target.strip("`"), "") or _refs.as_ref(target, **ctx)
        if ref not in writes:
            writes.append(ref)
        try:
            plan = df._jdf.queryExecution().analyzed().toString()
            for m in _VIEW_IN_PLAN.findall(plan):
                reads.add(_resolve_read(m))
            for m in _UNRESOLVED_IN_PLAN.findall(plan):
                reads.add(_resolve_read(m))
            table_schemas[ref] = [
                {"name": f.name, "type": f.dataType.simpleString()} for f in df.schema.fields
            ]
            column_lineage.extend(_column_flows(df, ref))
        except Exception as exc:  # noqa: BLE001 — a capture failure must not abort the run
            log.append(f"[spark] could not analyze write to {_refs.table_of(ref)}: {exc}")
        _register_written(ref, df)

    def _view_for(raw: str) -> str:
        """The registered view standing in for a table the notebook names.

        A notebook refers to tables the way Fabric does — `table`,
        `lakehouse.table`, `workspace.lakehouse.table`, or an `abfss://` path —
        but a temp view is a plain identifier, so the reference has to be
        translated. Reading is also recorded here: even when nothing is
        registered under that name (so the cell will fail honestly), the *intent
        to read* is real lineage and belongs in the graph.
        """
        ref = _refs.as_ref(raw, **ctx)
        reads.add(ref)
        for view, owned in views.items():
            if owned == ref:
                return view
        return _refs.view_name(ref)

    # Intercept reads so cross-workspace names resolve to the right view.
    _orig_table = spark.table
    spark.table = lambda name, *a, **k: _orig_table(_view_for(name), *a, **k)

    _orig_reader_table = type(spark.read).table
    type(spark.read).table = lambda self, name, *a, **k: _orig_reader_table(
        self, _view_for(name), *a, **k
    )

    def _rewrite_sql(query: str) -> str:
        """Swap qualified table names in SQL for the views standing in for them.

        Spark would read `Finance.Gold.customers` as catalog/database/table and
        fail; the empty view carrying that table's schema is what should answer.
        Longest name first so `ws.lh.t` isn't half-matched by `lh.t`.
        """
        for view, ref in sorted(views.items(), key=lambda kv: -len(kv[1])):
            ws, lh, table = _refs.parse_ref(ref)
            for candidate in ([f"{ws}.{lh}.{table}", f"{lh}.{table}"] if ws and lh else []):
                query = re.sub(
                    rf"(?<![\w.]){re.escape(candidate)}(?![\w.])", view, query, flags=re.I
                )
        return query

    # Intercept the DataFrame write verbs — capture the plan instead of running.
    def _saveAsTable(self, name, *a, **k):  # noqa: ANN001
        _capture(name, self._df)

    def _insertInto(self, name, *a, **k):  # noqa: ANN001
        _capture(name, self._df)

    def _save(self, path=None, *a, **k):  # noqa: ANN001
        """A path write — `df.write.save("abfss://…/Tables/name")`.

        This is the form Fabric generates for a lakehouse in ANOTHER workspace,
        so it carries the cross-workspace lineage that matters most. It used to
        be a silent no-op sink, which meant that write produced no lineage at
        all. Still nothing is written: the plan is captured exactly as for
        `saveAsTable`, and the path is resolved to a workspace-qualified ref.

        A pathless `.save()` (target set via `.option("path", …)`) has nothing
        to name, so it stays a no-op rather than inventing a table.
        """
        target = path or (k.get("path") if isinstance(k.get("path"), str) else None)
        if target:
            _capture(target, self._df)

    DataFrameWriter.saveAsTable = _saveAsTable
    DataFrameWriter.insertInto = _insertInto
    DataFrameWriter.save = _save

    # Intercept SQL writes; let read queries build their (lazy) plan normally.
    _orig_sql = spark.sql

    def _sql(query, *a, **k):  # noqa: ANN001
        query = _rewrite_sql(query or "")
        m = _WRITE_SQL.match(query)
        if m:
            target = m.group("t1") or m.group("t2")
            select = m.group("sel1") or m.group("sel2")
            try:
                _capture(target, _orig_sql(select))
            except Exception as exc:  # noqa: BLE001
                log.append(f"[spark] sql write to {target} not analyzable: {exc}")
                ref = _refs.qualify(target, **ctx)
                if ref not in writes:
                    writes.append(ref)
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

    # Coverage matters here too, for a different reason: Catalyst reads the
    # DataFrame API fine, so the counts that stay above zero on this engine are
    # the ones no engine can fix — a dynamically built query, an unparsable cell,
    # a write whose plan would not analyze (each already logged above).
    coverage = _coverage.add_writes(
        _coverage.scan_cells(cells), sorted(set(writes)), column_lineage
    )
    log.extend(_coverage.notes(coverage, "spark"))

    result = {
        "ok": True,
        "engine": "spark",
        "workspace": ctx["default_workspace"],
        "cells": cell_results,
        "reads": sorted(r for r in (reads - set(writes)) if _refs.table_of(r)),
        "writes": sorted(set(writes)),
        "coverage": coverage,
        "table_schemas": table_schemas,
        "column_lineage": column_lineage,
        "tables": _refs.table_refs(sorted(reads | set(writes) | set(table_schemas))),
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
