"""The sandbox run contract — the JSON shape passed to the executor subprocess
and back.

This is the seam that stays stable across the M2a → M2b swap: today a stub
executor fills it by static analysis, later a real local-Spark executor fills
the same shape from execution. The backend, the router, and the frontend all
speak only this contract, so swapping the engine underneath changes nothing
above it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ColumnSchema(BaseModel):
    name: str
    type: str | None = None


class TableRef(BaseModel):
    """The parts behind a canonical ref, for display and grouping.

    Carried as a side table on the result (ref → TableRef) rather than by
    replacing the ref strings with objects: `reads`, `writes` and
    `table_schemas` stay keyed by a plain string, so every existing consumer —
    including models saved before workspaces existed — keeps working, and only
    the views that want to group by workspace read this.
    """

    workspace: str = ""
    lakehouse: str = ""
    table: str = ""
    #: False when the workspace could not be determined, so the UI can show it
    #: as unknown instead of implying it belongs to the notebook's own.
    resolved: bool = False


class SchemaResolution(BaseModel):
    """Whether the input schemas the run needed were actually readable.

    Off-engine column lineage is only ever as good as these. sqlglot's `qualify`
    resolves a column to its owning table using the schemas the backend fetched
    from OneLake, and a table with no known columns is *omitted* from the
    mapping rather than entered empty — so an unreadable OneLake yields an empty
    `column_lineage` that looks exactly like "this notebook has no SQL".

    Every failure along that chain used to be swallowed (`except FabricError:
    return {}`), and in these APIs empty means "no permission" at least as often
    as it means "nothing there". So each one is recorded here instead of
    vanishing, and the run reports what it could not read.

    `None` on a result means no fetch was attempted — the caller supplied
    `schemas`, or supplied `cells` directly and never went near Fabric.
    """

    #: Read tables the static pre-scan found, as canonical refs.
    requested: list[str] = Field(default_factory=list)
    #: Of those, the ones a schema came back for.
    resolved: list[str] = Field(default_factory=list)
    #: Of those, the ones that stayed unknown — each one is columns the run
    #: cannot resolve and lineage it will therefore not derive.
    unresolved: list[str] = Field(default_factory=list)
    #: One line per swallowed failure, in the order they occurred. Empty with a
    #: non-empty `unresolved` means the lookups succeeded and the table simply
    #: was not found — a genuinely different diagnosis from being refused.
    failures: list[str] = Field(default_factory=list)


class RunRequest(BaseModel):
    """Backend → executor: what to run and the schemas to stand up.

    `schemas` maps a canonical table ref to its columns. The Spark executor
    registers each as an *empty* temp view so the notebook's reads resolve
    without any real data moving; the stub executor carries them straight back
    out as `table_schemas` (it has no session to register them in, but the
    columns are just as real).

    `workspace`/`lakehouse` are the notebook's own — the defaults an unqualified
    table name resolves against, exactly as inside Fabric. `name_map` resolves
    the GUIDs in `abfss://` paths to display names.
    """

    notebook_name: str
    cells: list[str]
    schemas: dict[str, list[ColumnSchema]] = Field(default_factory=dict)
    workspace: str = ""
    lakehouse: str = ""
    name_map: dict[str, str] = Field(default_factory=dict)


class ColumnFlow(BaseModel):
    """One output column ← one source column.

    `transform` is the SQL of the producing expression when the column is
    computed rather than passed through unchanged.

    `from_table` is the source column's OWNING table when the deriving engine
    knew it. The Spark path resolves attributes by name and cannot say (so the
    frontend matches on the column name and drops the edge when two candidates
    tie); the sqlglot path qualifies every column against the schemas and knows
    exactly. Optional rather than required because that asymmetry is real — an
    absent value means "not known", never "no table".
    """

    to_table: str
    to_column: str
    from_column: str
    from_table: str | None = None
    transform: str | None = None


class CellResult(BaseModel):
    index: int
    status: Literal["ok", "error", "skipped"]
    reads: list[str] = Field(default_factory=list)
    writes: list[str] = Field(default_factory=list)
    stdout: str = ""
    error: str | None = None


class RunResult(BaseModel):
    """Executor → backend: the outcome of a sandbox run.

    `saw_credentials` is the safety assertion made visible: the executor reports
    whether any Fabric/Azure credential was reachable from inside the child
    process. It must always be False — the runner scrubs the environment before
    spawning — and surfacing it turns the guarantee into something observable
    rather than merely intended.
    """

    ok: bool
    engine: Literal["stub", "spark"]
    #: The notebook's own workspace, echoed back so a consumer can tell which of
    #: the tables it touched are in *other* workspaces without re-deriving it.
    workspace: str = ""
    cells: list[CellResult] = Field(default_factory=list)
    reads: list[str] = Field(default_factory=list)
    writes: list[str] = Field(default_factory=list)
    #: Schema per table the run touched — written tables as Spark's analyzer
    #: resolved them, read tables as their input views were registered. The stub
    #: engine fills the read side by echoing the schemas it was given; only
    #: WRITTEN tables need an analyzer, so only those are missing there. Feeds
    #: attribute-level model creation.
    table_schemas: dict[str, list[ColumnSchema]] = Field(default_factory=dict)
    #: Column-level lineage. The spark engine derives it from analyzed plans
    #: (all cells, no source table); the stub engine derives it from the SQL
    #: text with sqlglot (SQL cells only, source table resolved).
    column_lineage: list[ColumnFlow] = Field(default_factory=list)
    #: ref → its parts, for every ref named in `reads`, `writes` or
    #: `table_schemas`. Lets the UI group tables by workspace without parsing
    #: refs itself, and lets it mark cross-workspace access.
    tables: dict[str, TableRef] = Field(default_factory=dict)
    #: How the input-schema fetch went. Filled by the backend AFTER the executor
    #: returns — the child process has no network and no credential, so it could
    #: not report this even in principle. See `SchemaResolution`.
    schema_resolution: SchemaResolution | None = None
    log: list[str] = Field(default_factory=list)
    saw_credentials: bool = False
    error: str | None = None
