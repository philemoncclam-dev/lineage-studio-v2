"""`/fabric/sandbox/run` — execute a notebook in the isolated sandbox.

Either the cells are supplied directly (offline / test path), or a live notebook
is fetched from Fabric by workspace + item id and decoded to cells first. Either
way the run itself goes through `run_sandbox`, so the isolation guarantees hold
regardless of where the code came from.

Both paths are gated on a caller Fabric recognises (`sandbox_require_auth`,
default on). Calling the cells path the "offline / test path" undersold it: it
is also what the deployed frontend uses for every re-run, and it hands code
straight to the child. `run_sandbox`'s guarantees are about what the child can
REACH — no credential, a throwaway home and cwd — and were never a claim that
running a stranger's code is safe.

A run can additionally carry what the notebook ACTUALLY did the last time it ran
in Fabric (`include_observed`), read back from the Spark plans Fabric keeps — see
`app/fabric/runs.py`. That is attached here rather than in the executor for the
same reason `schema_resolution` is: it takes network and a credential the child
deliberately does not have. It is enrichment throughout, and wrapped so that a
history lookup which fails cannot fail the run it was decorating.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from ..fabric.access import assert_visible, limit_to_visible, visible_workspace_ids
from ..fabric.client import FabricClient, FabricError
from ..fabric.router import onelake_token, user_token
from ..fabric.notebooks import NotebookDecodeError, fetch_notebook_source
from ..fabric.runs import compare, observe_run
from ..fabric.schema import (
    guid_name_map,
    resolve_read_schemas,
    scan_read_tables,
    workspace_index,
)
from ._refs import referenced_workspace_ids
from .protocol import (
    ColumnSchema,
    ObservedRun,
    RunComparison,
    RunRequest,
    RunResult,
    SchemaResolution,
)
from .runner import run_sandbox

router = APIRouter(prefix="/fabric/sandbox", tags=["sandbox"])


class SandboxRunRequest(BaseModel):
    name: str = "notebook"
    workspace_id: str | None = None
    item_id: str | None = None
    #: When present, run these cells directly and skip the Fabric fetch.
    cells: list[str] | None = None
    #: Empty-view schemas for the tables the notebook reads, so the Spark engine
    #: can resolve them with zero data. Ignored by the stub engine.
    schemas: dict[str, list[ColumnSchema]] | None = None
    #: Schemas observed by EARLIER steps of the same sequence — `table_schemas`
    #: from their results, accumulated by the caller.
    #:
    #: Separate from `schemas` because the two mean different things. `schemas`
    #: is authoritative and suppresses the OneLake fetch entirely; these only
    #: FILL GAPS after it, and never override a schema OneLake answered for.
    #: A silver notebook reading a table its bronze predecessor just created had
    #: nothing to resolve against — the table may not exist in OneLake yet — so
    #: the downstream half of every medallion sequence came back with no column
    #: lineage. `child_spark` already does exactly this between cells of one
    #: notebook; this is the same idea across the process boundary.
    carried_schemas: dict[str, list[ColumnSchema]] | None = None
    #: The notebook's own workspace and attached lakehouse — the defaults an
    #: unqualified table name resolves against. `workspace` is the display name
    #: (`workspace_id` is the GUID used for API calls); when it is omitted the
    #: name is looked up from the id.
    workspace: str | None = None
    lakehouse: str | None = None
    #: Also fetch what the notebook ACTUALLY did on its last real Fabric run, and
    #: diff it against this one. Off by default: it is two extra Fabric round
    #: trips, and the sandbox is useful without it. Needs `workspace_id` +
    #: `item_id` — a cells-only run has no notebook in Fabric to have a history.
    include_observed: bool = False


@router.post("/run", response_model=RunResult)
def sandbox_run(
    req: SandboxRunRequest,
    token: Annotated[str | None, Depends(user_token)] = None,
    lake: Annotated[str | None, Depends(onelake_token)] = None,
) -> RunResult:
    """Read Fabric as the CALLER, falling back to the service principal.

    The client is built from the caller's own tokens, exactly as every other
    Fabric route builds one. An earlier version constructed a bare
    `FabricClient()` here, on the reasoning that the run "needs the SP, because
    there is no user in the loop once the child process starts" — which
    describes the child accurately and this function not at all. The child
    holds no credential of any kind (`runner._scrubbed_env` sees to that) and
    never speaks to Fabric; every Fabric call this endpoint makes happens
    *here*, in-request, where the caller's tokens are available. Dropping them
    meant a deployment without service-principal secrets answered signed-in
    users with "Fabric is not configured — sign in", which they had already
    done.

    `onelake_token` matters as much as the Fabric one and was not being read at
    all: OneLake is a separate audience, and it is what `resolve_read_schemas`
    below reads columns from. Without it a run resolved no schemas, so even a
    successful run came back with no column lineage.

    Passing them through also makes the authorisation intrinsic rather than
    bolted on — Fabric evaluates the caller's own access on the fetch itself,
    so the `assert_visible` gate is a fast, honest 404 in front of a check that
    now also happens for real, instead of the only thing standing between a
    caller and any notebook the SP can reach.

    A caller who sends no token still gets the service principal, so the
    non-interactive paths — tests, a curl, the DEV-only "continue without
    signing in" — behave exactly as before.
    """
    # Who may ask — settled before anything is fetched OR executed.
    #
    # The fetch path below has always been gated. The cells path never was, and
    # it is the dangerous one: cells go straight to the child, which `exec()`s
    # them on the Spark engine. While production ran only the stub that was
    # merely untidy; the moment a JVM is deployed it is remote code execution,
    # so the gate has to come first and cover both paths.
    #
    # "Sent a bearer token" is not by itself a gate — any string satisfies it.
    # Fabric is the authority here as everywhere else in this backend: a token
    # it refuses lists no workspaces, and `visible_workspace_ids` turns that
    # into a 403. Nothing is validated locally, so there is still only one
    # authority on who a caller is.
    gate = get_settings().sandbox_require_auth
    visible: set[str] | None = None
    if gate:
        if not token:
            raise HTTPException(
                status_code=401,
                detail=(
                    "Sign in to run a notebook. (A local backend can set "
                    "SANDBOX_REQUIRE_AUTH=false to allow anonymous runs.)"
                ),
            )
        visible = visible_workspace_ids(token)

    cells = req.cells
    schemas: dict[str, list[ColumnSchema]] = dict(req.schemas or {})
    # Stays None when no fetch is attempted — caller-supplied cells or schemas.
    # That is a real third state, distinct from "attempted and found nothing".
    resolution: SchemaResolution | None = None
    workspace = req.workspace or ""
    lakehouse = req.lakehouse or ""
    # GUID → display name, so `abfss://` paths (which carry GUIDs) resolve to
    # readable workspace and lakehouse names in the graph.
    name_map: dict[str, str] = {}
    if cells is None:
        if not (req.workspace_id and req.item_id):
            raise HTTPException(
                status_code=400,
                detail="provide cells, or workspace_id + item_id to fetch the notebook",
            )
        # Before anything is fetched: may THIS caller see that workspace? The
        # gate above may already have asked; asking twice is a wasted round trip
        # to Fabric, not a second opinion.
        if not gate:
            visible = visible_workspace_ids(token)
        assert_visible(visible, req.workspace_id)
        try:
            client = FabricClient(user_token=token, onelake_token=lake)
            source = fetch_notebook_source(client, req.workspace_id, req.item_id, req.name)
        except (FabricError, NotebookDecodeError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        cells = source.cells
        # The notebook's attached lakehouse, off its own metadata header — what
        # an unqualified table name inside it resolves against.
        lakehouse = lakehouse or (source.lakehouse_default or "")
        # Names for the GUIDs the notebook's paths use, and the notebook's own
        # workspace name when the caller didn't supply it.
        try:
            # Both indexes are cut to what the caller can see. `workspace_index`
            # is every workspace the SP reaches, and it is what an unqualified
            # table name is resolved against — so leaving it whole would read
            # schemas out of workspaces the caller was just refused, by name
            # rather than by id.
            ws_index = {
                k: v
                for k, v in workspace_index(client).items()
                if visible is None or v.lower() in visible
            }
            # Include any workspace the notebook reaches into by `abfss://`,
            # so its lakehouse GUIDs get names too — not just the notebook's own.
            name_map = guid_name_map(
                client,
                limit_to_visible(
                    visible, [req.workspace_id, *referenced_workspace_ids(cells)]
                ),
            )
            workspace = workspace or name_map.get(req.workspace_id.lower(), "")
        except FabricError:
            ws_index = {}
        # Fetch the read tables' schemas from OneLake. The Spark engine
        # registers them as empty views the notebook resolves against; the stub
        # engine needs them to resolve columns at all (see _sqllineage), so on
        # production this fetch IS the column lineage.
        #
        # Still best-effort — one unreadable table must not fail a run that can
        # resolve the rest — but no longer silent: `resolution` records what was
        # asked for, what came back, and every refusal in between, and rides out
        # on the result. Empty schemas and empty column lineage are what a
        # principal without OneLake access produces, and that used to be
        # indistinguishable from a notebook that simply had no SQL.
        if not schemas:
            resolution = SchemaResolution()
            try:
                refs = scan_read_tables(cells, workspace, lakehouse, name_map)
                fetched = resolve_read_schemas(
                    client, req.workspace_id, refs, ws_index, resolution
                )
                schemas = {k: list(v) for k, v in fetched.items()}
            except FabricError as exc:
                # The scan itself failed, so `requested` may be empty too — the
                # message is the only diagnosis there is.
                resolution.failures.append(f"schema fetch abandoned — {exc}")
                schemas = {}

    # Upstream steps fill what OneLake could not answer for, and only that:
    # an observed schema is never overridden by a carried one, because OneLake is
    # ground truth for a table that already exists. What it is NOT is a
    # prediction of a table an earlier step in this sequence just created — and
    # that is precisely the read a silver or gold notebook is built on.
    carried_used: list[str] = []
    for ref, columns in (req.carried_schemas or {}).items():
        if ref not in schemas and columns:
            schemas[ref] = list(columns)
            carried_used.append(ref)
    if resolution is not None and carried_used:
        resolution.carried = sorted(carried_used)
        # No longer a gap: these columns are known, just not from OneLake.
        filled = set(carried_used)
        resolution.unresolved = [r for r in resolution.unresolved if r not in filled]

    result = run_sandbox(
        RunRequest(
            notebook_name=req.name,
            cells=cells,
            schemas=schemas,
            workspace=workspace,
            lakehouse=lakehouse,
            name_map=name_map,
        )
    )
    # Attached here rather than inside the executor: the child has no network
    # and no credential, so it could not know any of this even in principle.
    result.schema_resolution = resolution

    # What the notebook really did, last time it ran for real. Same reasoning as
    # above — network and a credential — and best-effort for a different one:
    # this is enrichment, and a history lookup that fails must not take a
    # perfectly good sandbox run down with it.
    if req.include_observed and req.workspace_id and req.item_id:
        result.observed, result.comparison = _observe(
            req, token, lake, workspace, lakehouse, name_map, result
        )
    return result


def _observe(
    req: SandboxRunRequest,
    token: str | None,
    lake: str | None,
    workspace: str,
    lakehouse: str,
    name_map: dict[str, str],
    result: RunResult,
) -> tuple[ObservedRun, RunComparison | None]:
    """The last real run of this notebook, and how the sandbox compares.

    Wrapped in its own function so the failure envelope is total: any exception
    from the Fabric surface becomes a note on the result rather than an error on
    the response. `observe_run` already degrades on `FabricError`; this covers
    the rest, because "the enrichment broke" must never read as "the run broke".
    """
    try:
        client = FabricClient(user_token=token, onelake_token=lake)
        observed = observe_run(
            client, req.workspace_id, req.item_id, workspace, lakehouse, name_map
        )
    except Exception as exc:  # noqa: BLE001 — enrichment never fails the run
        return ObservedRun(notes=[f"run history unavailable — {exc}"]), None
    if not observed.available:
        return observed, None
    return observed, compare(result.reads, result.writes, observed)


@router.get("/observed", response_model=ObservedRun)
def sandbox_observed(
    workspace_id: str,
    item_id: str,
    workspace: str = "",
    lakehouse: str = "",
    token: Annotated[str | None, Depends(user_token)] = None,
    lake: Annotated[str | None, Depends(onelake_token)] = None,
) -> ObservedRun:
    """What a notebook actually did, without running the sandbox at all.

    The same lineage `/run` can attach, standalone — for the case where the
    question is "what did this notebook touch last night" rather than "what would
    it touch". Gated exactly as `/run` is: Fabric decides who may look, and
    `assert_visible` is a fast 404 in front of a check Fabric makes for real on
    the fetch itself.
    """
    visible = visible_workspace_ids(token)
    assert_visible(visible, workspace_id)
    try:
        client = FabricClient(user_token=token, onelake_token=lake)
    except FabricError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return observe_run(client, workspace_id, item_id, workspace, lakehouse, {})
