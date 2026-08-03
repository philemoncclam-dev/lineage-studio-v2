"""Reads and writes out of a Spark physical plan — lineage from what RAN.

The third lineage source, alongside static parsing (`app/parser.py`) and the
sandbox (`app/sandbox/`). Those two answer "what would this notebook do"; this
one answers "what did it actually do", from the plans Fabric kept for runs that
already happened.

Fabric proxies the open-source Spark History Server REST API, so a completed
notebook run exposes each SQL execution's `planDescription` — the physical plan
as text — with no diagnostic emitter, no listener, and no configuration. It
works retroactively, which is what makes it worth having: the run is over, and
the plan is still there.

WHAT THIS IS GOOD FOR, AND WHAT IT IS NOT. A plan names its sources as
`abfss://` paths, which `_refs.qualify` already resolves to canonical refs, so
TABLE-level reads and writes come out reliably. Column-level does not, and is
deliberately not attempted:

  * the plan is a *rendering*. Spark truncates long column lists
    (`spark.sql.debug.maxToStringFields`, 25 by default) precisely on the wide
    tables where column lineage matters most;
  * reconstructing output ← input across `Project`/`Aggregate` means parsing
    expression text out of `Arguments:`, a format Spark is free to change
    between versions and does;
  * the sandbox already derives column lineage from live Catalyst objects,
    where the attribute identity is real rather than reverse-engineered.

So this reports tables, and says so. A wrong edge is worse than a missing one —
the same rule `_sqllineage` and `_dflineage` follow.

AND IT MISSES WHAT NEVER RAN. A SQL execution exists only where an *action*
forced one, so a DataFrame built and never materialised leaves no plan at all.
That is the exact complement of the sandbox, which intercepts the write verb and
therefore captures intent whether or not it would have executed. Neither is a
superset of the other, which is why comparing them is worth more than either.

Pure stdlib plus `_refs`. No network here — `runs.py` does the fetching.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..sandbox._refs import qualify, table_of

#: A node header in a FORMATTED plan — `(7) Execute InsertIntoHadoopFsRelationCommand`,
#: optionally decorated with `[codegen id : 2]`. Formatted is Spark's default for
#: the SQL tab (`spark.sql.ui.explainMode`), so it is the shape that normally
#: arrives; the line scanner below covers the other modes.
_NODE = re.compile(r"^\((\d+)\)\s+(?P<name>.+?)(?:\s*\[[^\]]*\])?\s*$", re.M)

#: `Location: PreparedDeltaFileIndex [abfss://…, abfss://…]`. The index type
#: varies (`InMemoryFileIndex`, `PreparedDeltaFileIndex`, `TahoeLogFileIndex`)
#: and can carry a `(3 paths)` count, so only the bracket is anchored on.
_LOCATION = re.compile(r"Location:[^\[\n]*\[(?P<paths>[^\]]*)\]")

#: Any OneLake/ADLS URI, wherever it appears in a node's fields.
_ABFSS = re.compile(r"abfss://[^\s,\]\)'\"]+")

#: Scan nodes that name a catalog table rather than a path:
#: `Scan parquet spark_catalog.bronze.orders`.
_SCAN_TABLE = re.compile(
    r"^(?:File)?Scan\s+\w+\s+(?P<table>[\w.]+?)\s*$", re.I
)

#: A backticked catalog identifier — `` `spark_catalog`.`bronze`.`orders` ``.
#: This is how a COMMAND names its table, and commands are where CTAS lives: a
#: `CREATE TABLE … AS SELECT` renders its child as an unresolved LOGICAL plan, so
#: there is no `Scan` node and no `Location:` anywhere in it. Without this the
#: single most common shape in a medallion notebook yielded nothing at all.
_BACKTICKED = re.compile(r"`(?P<parts>[^`]+(?:`\.`[^`]+)*)`")

#: Nodes that read. `LocalTableScan` and `Scan ExistingRDD` are deliberately not
#: here: they read from memory, not from storage, and have no source to name.
#: `LogicalRelation` and `HiveTableRelation` are the logical-plan counterparts of
#: `Scan`, and appear under commands for the reason above.
_READ_NODE = re.compile(
    r"^(?:(?:File)?Scan|BatchScan|LogicalRelation|HiveTableRelation|Relation)\b", re.I
)

#: Nodes that write. Covers the file-relation commands, the Delta commands every
#: medallion notebook is built on, and the DataSource-v2 write operators.
_WRITE_NODE = re.compile(
    r"""^(?:Execute\s+)?(?:
          InsertIntoHadoopFsRelationCommand
        | InsertIntoDataSourceCommand
        | InsertIntoHiveTable
        | CreateDataSourceTableAsSelectCommand
        | CreateHiveTableAsSelectCommand
        | SaveIntoDataSourceCommand
        | WriteIntoDelta
        | MergeIntoCommand
        | UpdateCommand
        | DeleteCommand
        | AppendData
        | OverwriteByExpression
        | OverwritePartitionsDynamic
        | ReplaceData
        | AtomicCreateTableAsSelect
        | AtomicReplaceTableAsSelect
    )\b""",
    re.I | re.X,
)

#: Maintenance commands that touch a table without moving data between tables.
#: They would otherwise register as writes and put a spurious edge in the graph.
_NOT_LINEAGE = re.compile(
    r"^(?:Execute\s+)?(?:Optimize|Vacuum|AnalyzeTable|RefreshTable|CreateTable|"
    r"DescribeTable|ShowTable|SetCommand|AddJar)\w*\b",
    re.I,
)

#: Spark's own default catalog, which is not a lakehouse and must not become one.
_DEFAULT_CATALOGS = {"spark_catalog", "hive_metastore", "default", "delta"}

#: Placeholder relation names the engine puts in a plan where a real table would
#: go. Delta renders every `DeltaTableV2` as `DummyDeltaTable` — it is the name
#: of a Scala class, not of anything in a lakehouse, and the path alongside it is
#: where the actual identity lives.
_PLACEHOLDER_TABLES = {"dummydeltatable", "onerowrelation", "unresolvedrelation"}

#: The tree drawing and codegen marker leading an operator in a non-formatted
#: plan — `   +- *(1) FileScan parquet …`. Stripped so the operator name is at
#: the start of what gets matched.
_TREE_PREFIX = re.compile(r"^[\s+\-*:|]*(?:\(\d+\)\s*)?")


@dataclass
class PlanScan:
    """What one plan touched, plus what could not be read.

    `unrecognised` is load-bearing for the same reason `Coverage` is: a plan that
    yields nothing looks identical whether it moved no data or whether it was
    written in node types this parser has never seen. Naming them makes the
    second case diagnosable instead of silent.
    """

    reads: set[str] = field(default_factory=set)
    writes: set[str] = field(default_factory=set)
    unrecognised: set[str] = field(default_factory=set)

    def merge(self, other: PlanScan) -> None:
        self.reads |= other.reads
        self.writes |= other.writes
        self.unrecognised |= other.unrecognised


def _refs_in(text: str, ctx: dict) -> set[str]:
    """Every canonical ref named by a path in one node's fields.

    Paths come from a `Location:` bracket where there is one, and from a bare
    scan of the block otherwise — a write command carries its target as the head
    of `Arguments:` rather than under any labelled field.
    """
    found: set[str] = set()
    candidates: list[str] = []
    for match in _LOCATION.finditer(text):
        candidates.extend(part.strip() for part in match.group("paths").split(","))
    candidates.extend(_ABFSS.findall(text))
    for raw in candidates:
        # A truncated list renders the overflow as `...`; it names nothing.
        if not raw or raw.startswith("..."):
            continue
        ref = qualify(raw, **ctx)
        if table_of(ref):
            found.add(ref)
    return found


def _table_ref(dotted: str, ctx: dict) -> str:
    """A dotted identifier out of a node header → a ref, or `""`.

    Spark's own catalog name is stripped rather than resolved: `spark_catalog` is
    not a workspace, and leaving it in would produce a ref whose first segment is
    an implementation detail of the engine.
    """
    parts = [p for p in dotted.replace("`", "").split(".") if p]
    while parts and parts[0].lower() in _DEFAULT_CATALOGS:
        parts.pop(0)
    if not parts or parts[-1].lower() in _PLACEHOLDER_TABLES:
        return ""
    ref = qualify(".".join(parts), **ctx)
    return ref if table_of(ref) else ""


def _identifiers_in(text: str, ctx: dict) -> list[str]:
    """Backticked catalog identifiers in a node's fields, in the order written.

    Order matters for a write: a command names its TARGET first and its options
    after, so the first identifier is the table being written and any later one
    is not.

    Only ever consulted when no path was found. A path carries the workspace and
    an identifier does not, so resolving both would produce two different refs
    for one table — the path's, and one defaulted into the notebook's own
    workspace. Preferring the path keeps a table's identity single.
    """
    out: list[str] = []
    for match in _BACKTICKED.finditer(text):
        ref = _table_ref(match.group("parts"), ctx)
        if ref and ref not in out:
            out.append(ref)
    return out


def _is_empty(body: str) -> bool:
    """Whether a node carries no arguments at all.

    `Execute SomeCommand` wraps the command that holds the detail, and renders
    with a bare `Output: []`. It is a wrapper, not a node that failed to parse,
    so it must not be reported as unrecognised — that would put a warning on
    every single CTAS.
    """
    return not any(
        line.strip() and not line.strip().startswith(("Output:", "Input:"))
        for line in body.splitlines()
    )


def _blocks(plan: str) -> list[tuple[str, str]]:
    """The formatted plan's detail section as `(node name, its fields)` pairs.

    Empty when the plan is not in formatted mode, which is the signal for the
    caller to fall back to scanning lines.
    """
    matches = list(_NODE.finditer(plan))
    if not matches:
        return []
    out: list[tuple[str, str]] = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(plan)
        out.append((match.group("name").strip(), plan[match.end() : end]))
    return out


def _scan_lines(plan: str, ctx: dict) -> PlanScan:
    """Fallback for a plan that is not in formatted mode.

    `simple` and `extended` modes render each operator as one line carrying its
    own arguments, so the line IS the block. Same classification, less structure.
    """
    scan = PlanScan()
    for line in plan.splitlines():
        stripped = _TREE_PREFIX.sub("", line)
        if _NOT_LINEAGE.match(stripped):
            continue
        refs = _refs_in(line, ctx)
        if _WRITE_NODE.match(stripped):
            # A one-line write names its target first; anything else on the line
            # is an option, not a second table.
            scan.writes |= set(sorted(refs)[:1]) if refs else set()
        elif _READ_NODE.match(stripped):
            scan.reads |= refs
    return scan


def scan_plan(plan: str, workspace: str = "", lakehouse: str = "", name_map: dict | None = None) -> PlanScan:
    """One physical plan → the tables it read and wrote.

    `workspace`/`lakehouse` are the notebook's own — what an unqualified name
    resolves against, exactly as everywhere else in this codebase. `name_map`
    turns the GUIDs in an `abfss://` path into display names.
    """
    ctx = {
        "default_workspace": workspace,
        "default_lakehouse": lakehouse,
        "name_map": name_map or {},
    }
    text = plan or ""
    if not text.strip():
        return PlanScan()

    blocks = _blocks(text)
    if not blocks:
        return _scan_lines(text, ctx)

    scan = PlanScan()
    for name, body in blocks:
        if _NOT_LINEAGE.match(name) or _is_empty(body):
            continue
        if _WRITE_NODE.match(name):
            paths = _refs_in(body, ctx)
            if paths:
                # The target is the first path in `Arguments:`; the rest of the
                # block is options. Sorting makes the pick deterministic rather
                # than dependent on set iteration order.
                scan.writes.add(sorted(paths)[0])
                continue
            # A command names its target as a backticked identifier instead —
            # first one wins, because that is the position the target occupies.
            identifiers = _identifiers_in(body, ctx)
            if identifiers:
                scan.writes.add(identifiers[0])
            else:
                scan.unrecognised.add(name)
        elif _READ_NODE.match(name):
            refs = _refs_in(body, ctx)
            if not refs:
                # A catalog read names its table in the header instead.
                header = _SCAN_TABLE.match(name)
                ref = _table_ref(header.group("table"), ctx) if header else ""
                refs = {ref} if ref else set(_identifiers_in(body, ctx))
            if refs:
                scan.reads |= refs
            elif not name.lower().startswith(("localtablescan", "scan existingrdd")):
                scan.unrecognised.add(name)
    # A table both read and written in one plan is a write — the same rule the
    # sandbox applies, so the two answers stay comparable.
    scan.reads -= scan.writes
    return scan
