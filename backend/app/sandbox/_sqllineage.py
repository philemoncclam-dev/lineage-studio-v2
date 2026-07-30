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

`MERGE INTO` is covered too, and separately from the `SELECT` path — it has no
projection to qualify, so its columns resolve against the target/source aliases
the statement itself declares. It earns the special case by being the most common
write in a gold notebook; without it a whole Delta-upsert pipeline produced no
lineage at all.

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


def _unwrap_target(target):  # noqa: ANN001
    """The table out of a write target — `CREATE TABLE t (cols) AS …` wraps it."""
    if isinstance(target, exp.Schema):
        target = target.this
    return target if isinstance(target, exp.Table) else None


def _target_of(tree):  # noqa: ANN001
    """The table a statement writes to, or None when it only reads.

    `MERGE`, `UPDATE` and `DELETE` are here because they are writes, and leaving
    them out meant the most common medallion write of all — the Delta upsert —
    produced no lineage whatsoever: no edge, no table, nothing. A gold notebook
    built on `MERGE INTO` looked like a notebook that did nothing.
    """
    if isinstance(tree, exp.Create) and isinstance(tree.expression, exp.Select):
        return _unwrap_target(tree.this)
    if isinstance(tree, (exp.Insert, exp.Merge, exp.Update, exp.Delete)):
        return _unwrap_target(tree.this)
    return None


def _column_owner(
    column,  # noqa: ANN001
    aliases: dict[str, str],
) -> str | None:
    """The ref owning a column, from the alias it is qualified with.

    An unqualified column in a MERGE is genuinely ambiguous — it could belong to
    either side — so it resolves to None rather than to a guess. The frontend
    already knows what to do with that (match on name, drop the edge when two
    candidates tie), and a wrong column edge is worse than an unowned one.
    """
    return aliases.get(column.table) or None


def _flows_from(
    expression,  # noqa: ANN001
    to_column: str,
    target_ref: str,
    aliases: dict[str, str],
    out: dict,
) -> None:
    """Record every source column feeding one output column."""
    if not to_column:
        return
    # A bare column is a passthrough or a rename; anything else is computed, and
    # its text is the transform worth showing. Same rule as the SELECT path.
    transform = None
    if not isinstance(expression, exp.Column):
        try:
            transform = expression.sql(dialect=DIALECT)
        except Exception:  # noqa: BLE001
            transform = None
    for column in expression.find_all(exp.Column):
        from_table = _column_owner(column, aliases)
        key = (to_column, from_table or "", column.name)
        if key not in out:
            out[key] = {
                "to_table": target_ref,
                "to_column": to_column,
                "from_column": column.name,
                "from_table": from_table,
                "transform": transform,
            }


def _tuple_items(node) -> list:  # noqa: ANN001
    if isinstance(node, exp.Tuple):
        return list(node.expressions)
    return [node] if node is not None else []


def _merge(tree, schemas: dict[str, list[dict]], ctx: dict) -> tuple[str, set[str], list[dict]]:
    """A `MERGE INTO` → its target, its reads, and its column flows.

    Deliberately NOT run through `qualify`: a MERGE is not a projection, so there
    is no select list to resolve, and every column in it is already qualified by
    the target or source alias the statement itself declares. Resolving by alias
    is both simpler and exactly as accurate here.

    `WHEN MATCHED THEN UPDATE SET *` and `WHEN NOT MATCHED THEN INSERT *` are the
    common forms and they carry no column list at all; their meaning is "every
    source column into the same-named target column", which the source schema
    supplies. `WHEN MATCHED THEN DELETE` moves no columns and contributes none.
    """
    target = _unwrap_target(tree.this)
    if target is None:
        return "", set(), []
    target_ref = _refs.as_ref(_dotted(target), **ctx)

    reads: set[str] = set()
    # alias (and bare name) → the ref it stands for. The target is included so a
    # `t.col` on the right-hand side of a SET resolves to the target, which is
    # what a self-referencing update (`SET total = t.total + s.amount`) means.
    aliases: dict[str, str] = {}
    for name in {target.alias, target.name} - {""}:
        aliases[name] = target_ref

    using = tree.args.get("using")
    source_ref = ""
    if isinstance(using, exp.Table):
        source_ref = _refs.as_ref(_dotted(using), **ctx)
        if _refs.table_of(source_ref):
            reads.add(source_ref)
            for name in {using.alias, using.name} - {""}:
                aliases[name] = source_ref
    elif using is not None:
        # A subquery source: its tables are real reads, but a column qualified by
        # the subquery's alias belongs to no single one of them, so the alias maps
        # to nothing and those flows come back unowned.
        for table in using.find_all(exp.Table):
            ref = _refs.as_ref(_dotted(table), **ctx)
            if _refs.table_of(ref):
                reads.add(ref)
        if len(reads) == 1:
            # One table under the subquery — then the owner is not ambiguous.
            source_ref = next(iter(reads))
            alias = using.alias_or_name
            if alias:
                aliases[alias] = source_ref

    def _identity_flows(out: dict) -> None:
        """`SET *` / `INSERT *` — every source column into its namesake."""
        if not source_ref:
            return
        target_columns = {c["name"] for c in schemas.get(target_ref, []) if c.get("name")}
        for column in schemas.get(source_ref, []):
            name = column.get("name")
            if not name or (target_columns and name not in target_columns):
                continue
            out[(name, source_ref, name)] = {
                "to_table": target_ref,
                "to_column": name,
                "from_column": name,
                "from_table": source_ref,
                "transform": None,
            }

    flows: dict[tuple, dict] = {}
    whens = tree.args.get("whens")
    clauses = whens.expressions if whens is not None else tree.expressions
    for when in clauses or []:
        then = when.args.get("then") if isinstance(when, exp.When) else None
        if isinstance(then, exp.Update):
            for assignment in then.expressions:
                if isinstance(assignment, exp.Star):
                    _identity_flows(flows)
                elif isinstance(assignment, exp.EQ):
                    _flows_from(
                        assignment.expression,
                        assignment.this.name if isinstance(assignment.this, exp.Column) else "",
                        target_ref,
                        aliases,
                        flows,
                    )
        elif isinstance(then, exp.Insert):
            if isinstance(then.this, exp.Star):
                _identity_flows(flows)
                continue
            columns = _tuple_items(then.this)
            values = _tuple_items(then.expression)
            if len(columns) != len(values):
                continue  # Mismatched arity — pairing them would invent lineage.
            for column, value in zip(columns, values):
                name = column.name if isinstance(column, (exp.Column, exp.Identifier)) else ""
                _flows_from(value, name, target_ref, aliases, flows)

    return target_ref, reads, list(flows.values())


def _write_without_projection(
    tree, target_ref: str, ctx: dict
) -> tuple[str, set[str], list[dict]]:
    """`UPDATE` / `DELETE` — a write whose columns are not a projection.

    No column flows are claimed: a correlated `UPDATE … SET c = (SELECT …)` could
    yield some, but the shapes vary enough that guessing would be the kind of
    quietly-wrong edge this module exists to avoid. The tables it touches are
    still real lineage and are reported.
    """
    reads: set[str] = set()
    for table in tree.find_all(exp.Table):
        ref = _refs.as_ref(_dotted(table), **ctx)
        if _refs.table_of(ref) and ref != target_ref:
            reads.add(ref)
    return target_ref, reads, []


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

    # A MERGE has no projection to qualify — its columns are resolved against the
    # aliases the statement declares. Handled whole, before the SELECT path.
    if isinstance(tree, exp.Merge):
        return _merge(tree, schemas, ctx)

    target_table = _target_of(tree)
    target_ref = _refs.as_ref(_dotted(target_table), **ctx) if target_table is not None else ""
    if isinstance(tree, (exp.Update, exp.Delete)) and target_ref:
        return _write_without_projection(tree, target_ref, ctx)

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
