"""Column-level lineage from SQL text, with no Spark session and no JVM.

This exists because **production has no JVM**. The Spark executor derives
column lineage from Catalyst's analyzed plans, which is the accurate answer and
is unavailable on the deployed backend — so on prod every model came out with
objects and edges but no attributes. For the SQL half of a notebook that is a
solvable problem: the lineage is recoverable from the query text alone.

sqlglot parses to an AST and `qualify` resolves every column to the table it
came from, given the schemas. Those schemas are not a guess either — they are
the ones the backend already fetched from OneLake and puts in the RunRequest.
So for a `spark.sql(...)` cell this is not a degraded heuristic: joins, CTEs,
subqueries, aliases and `SELECT *` all resolve the way the engine would resolve
them.

What it does NOT cover is the DataFrame API — `df.select(...)`,
`df.withColumn(...)`. That needs a plan, and a plan needs Spark. Cells written
that way yield nothing here, deliberately: a hand-rolled approximation of
Catalyst would fail silently on anything dynamic, and a wrong column edge is
worse than a missing one (the same rule the frontend already applies when it
drops ambiguous edges).

TABLES ARE FLATTENED BEFORE QUALIFYING. A notebook names tables at three
different depths — `t`, `lakehouse.t`, `workspace.lakehouse.t` — and
sqlglot's MappingSchema requires one consistent nesting level, so mixing them
in a single query is a hard error. Each table is therefore rewritten to a
single identifier standing for its canonical ref, exactly as child_spark.py
rewrites them to temp views, and mapped back afterwards.

Pure stdlib plus sqlglot: importable by the stub child, which is launched by
path with a scrubbed environment and must never reach `app`. A missing sqlglot
degrades to "no column lineage" rather than failing the run.
"""

from __future__ import annotations

import ast
import re

import _refs

try:  # sqlglot is a backend dependency, but the run must survive without it.
    import sqlglot
    from sqlglot import exp
    from sqlglot.optimizer.qualify import qualify

    AVAILABLE = True
except Exception:  # noqa: BLE001 — any import failure means "degrade", not "crash"
    AVAILABLE = False

DIALECT = "spark"

#: A `%%sql` / `%%spark-sql` magic cell — the whole body is one statement.
_SQL_MAGIC = re.compile(r"^\s*%%\s*(?:spark-)?sql\b[^\n]*\n(?P<body>.*)$", re.I | re.S)


def sql_statements(cell: str) -> list[str]:
    """Every SQL string a cell hands to Spark.

    Two forms: a `%%sql` magic cell, whose entire body is the statement, and
    `spark.sql("…")` calls. The latter are found by parsing the cell as Python
    rather than by regex — a triple-quoted multi-line query is the normal way to
    write these, and it is exactly what a regex gets wrong.

    An f-string or a variable is skipped rather than guessed at: its value is
    not knowable without running the cell, and inventing one would produce
    lineage for a query that was never issued.
    """
    magic = _SQL_MAGIC.match(cell or "")
    if magic:
        return [magic.group("body")]

    try:
        tree = ast.parse(cell or "")
    except SyntaxError:
        return []

    out: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "sql"):
            continue
        if not node.args:
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            out.append(arg.value)
    return out


def _dotted(table) -> str:  # noqa: ANN001
    return ".".join(p for p in (table.catalog, table.db, table.name) if p)


def _target_of(tree):  # noqa: ANN001
    """The table a statement writes to, or None when it only reads."""
    if isinstance(tree, exp.Create) and isinstance(tree.expression, exp.Select):
        target = tree.this
        # `CREATE TABLE t (cols) AS SELECT` wraps the table in a Schema node.
        if isinstance(target, exp.Schema):
            target = target.this
        return target if isinstance(target, exp.Table) else None
    if isinstance(tree, exp.Insert):
        target = tree.this
        if isinstance(target, exp.Schema):
            target = target.this
        return target if isinstance(target, exp.Table) else None
    return None


def analyze(
    sql: str,
    schemas: dict[str, list[dict]],
    ctx: dict,
) -> tuple[str, set[str], list[dict]]:
    """One statement → `(target ref, refs read, column flows)`.

    The target is `""` for a read-only query; its reads are still returned,
    because a `SELECT` feeding a temp view is real lineage even though this
    function cannot see where it lands.

    Never raises. Unparseable SQL, an unknown dialect construct or a schema that
    doesn't cover the query all degrade to whatever was resolvable — the run
    must not fail because one cell held something exotic.
    """
    if not AVAILABLE or not (sql or "").strip():
        return "", set(), []

    try:
        tree = sqlglot.parse_one(sql, dialect=DIALECT)
    except Exception:  # noqa: BLE001
        return "", set(), []
    if tree is None:
        return "", set(), []

    target_table = _target_of(tree)
    target_ref = _refs.as_ref(_dotted(target_table), **ctx) if target_table is not None else ""
    select = tree.expression if target_table is not None else tree
    if not isinstance(select, (exp.Select, exp.Union, exp.Subquery)):
        return target_ref, set(), []

    # Flatten every source table to a single identifier — see the module note.
    # `taken` maps identifier → canonical ref, and is what turns a resolved
    # column back into a workspace-qualified table.
    taken: dict[str, str] = {}
    reads: set[str] = set()
    try:
        for table in select.find_all(exp.Table):
            ref = _refs.as_ref(_dotted(table), **ctx)
            if not _refs.table_of(ref):
                continue
            identifier = _refs.view_name(ref, taken)
            reads.add(ref)
            table.set("catalog", None)
            table.set("db", None)
            table.set("this", exp.to_identifier(identifier))
    except Exception:  # noqa: BLE001
        return target_ref, reads, []

    # A CTE name also parses as a table; it is not a real one, so it must not be
    # reported as a read. It stays in `taken` (harmlessly) so a column resolving
    # to it maps to no table rather than to the wrong one.
    for cte in select.find_all(exp.CTE):
        reads.discard(_refs.as_ref(cte.alias_or_name, **ctx))

    # Only tables we actually have columns for. A table is left OUT rather than
    # entered with an empty column map: sqlglot rejects a zero-column entry
    # outright ("must have at least one column"), which would take down the
    # whole statement — and partial schema coverage is the normal case, since
    # the backend only sends schemas for the tables it could resolve.
    schema = {}
    for identifier, ref in taken.items():
        columns = {
            col["name"]: (col.get("type") or "string")
            for col in schemas.get(ref, [])
            if col.get("name")
        }
        if columns:
            schema[identifier] = columns

    try:
        qualified = qualify(
            select,
            schema=schema,
            dialect=DIALECT,
            # A column the schemas don't cover must not abort the statement —
            # partial schema coverage is the normal case, not an error.
            validate_qualify_columns=False,
            infer_schema=True,
        )
    except Exception:  # noqa: BLE001
        return target_ref, reads, []

    if not target_ref:
        return target_ref, reads, []

    alias_to_identifier: dict[str, str] = {}
    for table in qualified.find_all(exp.Table):
        alias_to_identifier[table.alias or table.name] = table.name

    flows: dict[tuple[str, str, str], dict] = {}
    for projection in getattr(qualified, "expressions", []):
        name = projection.alias_or_name
        if not name or name == "*":
            continue
        inner = projection.this if isinstance(projection, exp.Alias) else projection
        # A bare column is a passthrough (or a rename, which the differing
        # to_column already records); anything else is computed, and the
        # expression text is the transform worth showing.
        transform = None
        if not isinstance(inner, exp.Column):
            try:
                transform = inner.sql(dialect=DIALECT)
            except Exception:  # noqa: BLE001
                transform = None

        for column in projection.find_all(exp.Column):
            identifier = alias_to_identifier.get(column.table, column.table)
            from_table = taken.get(identifier, "")
            key = (name, from_table, column.name)
            if key in flows:
                continue
            flows[key] = {
                "to_table": target_ref,
                "to_column": name,
                "from_column": column.name,
                # Empty when the column resolves to a CTE or a subquery rather
                # than a base table; the frontend then falls back to matching on
                # the column name, as it did before this field existed.
                "from_table": from_table or None,
                "transform": transform,
            }

    return target_ref, reads, list(flows.values())


def analyze_cells(
    cells: list[str],
    schemas: dict[str, list[dict]],
    ctx: dict,
) -> tuple[set[str], set[str], list[dict], list[str]]:
    """Every SQL statement across a notebook → `(reads, writes, flows, log)`."""
    reads: set[str] = set()
    writes: set[str] = set()
    flows: list[dict] = []
    log: list[str] = []

    if not AVAILABLE:
        log.append("[stub] sqlglot unavailable — no column lineage derived.")
        return reads, writes, flows, log

    statements = 0
    for index, cell in enumerate(cells or []):
        for sql in sql_statements(cell):
            statements += 1
            target, cell_reads, cell_flows = analyze(sql, schemas, ctx)
            reads |= cell_reads
            if target:
                writes.add(target)
            flows.extend(cell_flows)
            if cell_flows:
                log.append(
                    f"[stub] cell {index}: {len(cell_flows)} column edge(s) into "
                    f"{_refs.table_of(target)}"
                )
    if statements and not flows:
        log.append(f"[stub] {statements} SQL statement(s) parsed, no column lineage resolved.")
    return reads, writes, flows, log
