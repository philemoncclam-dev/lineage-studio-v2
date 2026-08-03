"""A notebook's real Fabric runs, and the lineage they actually produced.

Fabric proxies the open-source Spark History Server REST API under its own
authentication, so for any notebook run that already happened we can ask for:

  * the Livy sessions — one per run, with state, submitter and timestamps;
  * each run's SQL executions, and for each the `planDescription` — the physical
    plan Spark executed.

Which means ground-truth table lineage from real runs with **no diagnostic
emitter, no listener, no Spark configuration, and no notebook change**, working
retroactively on runs that are already over. That last property is what makes
this worth doing: the alternative routes (a diagnostic emitter to Storage/Event
Hubs, or an OpenLineage listener on an Environment item) only ever capture runs
that happen *after* somebody sets them up.

EVERY CALL HERE IS BEST-EFFORT. This enriches a sandbox run; it must never fail
one. A tenant that has never enabled the monitoring APIs, a caller without the
scope, a notebook that has never been run, a plan in a shape `plans.py` does not
read — each degrades to an `ObservedRun` that says what happened, in the same
spirit as `SchemaResolution`. An empty answer with no explanation is the one
outcome this module refuses to produce.

The scopes are ones the app already asks for: `Item.Read.All` or
`Notebook.Read.All`, the same as reading the notebook's definition. So this costs
the caller no new consent.
"""

from __future__ import annotations

from typing import Any

from ..sandbox._refs import table_refs
from ..sandbox.protocol import ObservedRun, ObservedStatement, RunComparison, TableRef
from .client import FabricClient, FabricError
from .plans import PlanScan, scan_plan

#: States a run can be in where plans exist to read. A session that never started
#: has nothing to say, and asking costs a round trip per run.
_DONE = {"success", "succeeded", "completed", "finished", "dead", "error", "failed", "killed"}

#: How many SQL executions to pull for one run. A notebook doing real work has
#: tens; the ceiling stops a pathological session (a loop issuing thousands of
#: small queries) from turning one enrichment into a minutes-long fetch.
_MAX_STATEMENTS = 200


def _first(payload: dict, *keys: str) -> Any:
    """The first key present in a payload, for a surface whose casing drifts.

    The Fabric monitoring APIs have shipped both `livyId`/`livySessionId` and
    `applicationId`/`appId` in different revisions, and the swagger has been
    wrong before (see the note in `client.list_lakehouse_tables`). Accepting
    several spellings is cheaper than a fetch that silently returns nothing
    because one field got renamed.
    """
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return value
    return None


def list_runs(client: FabricClient, workspace_id: str, item_id: str) -> list[dict]:
    """Every Spark application recorded for one notebook, newest first."""
    payload = client.request(
        "GET", f"/workspaces/{workspace_id}/notebooks/{item_id}/livySessions"
    )
    sessions = payload.get("value") or payload.get("data") or []
    return sorted(
        sessions,
        key=lambda s: str(_first(s, "submittedDateTime", "startDateTime", "queuedDateTime") or ""),
        reverse=True,
    )


def latest_run(sessions: list[dict]) -> dict | None:
    """The newest run worth reading plans from.

    A finished run is preferred over a running one — its plans are complete —
    but a running session is accepted when it is all there is, because a
    long-running notebook is exactly when someone wants to see what it has
    touched so far.
    """
    for session in sessions:
        if str(_first(session, "state", "status") or "").lower() in _DONE:
            return session
    return sessions[0] if sessions else None


def _sql_executions(
    client: FabricClient, workspace_id: str, item_id: str, livy_id: str, app_id: str
) -> list[dict]:
    """The run's SQL executions, via the Spark History Server surface.

    `details=false` is deliberate: the plan text comes back either way, and the
    detailed form additionally carries every node's metrics, which is a large
    payload we would immediately discard.
    """
    payload = client.request(
        "GET",
        f"/workspaces/{workspace_id}/notebooks/{item_id}/livySessions/{livy_id}"
        f"/applications/{app_id}/sql",
        params={"details": "false", "length": _MAX_STATEMENTS},
    )
    # The open-source endpoint answers with a bare JSON array; `client.request`
    # hands back whatever was decoded, so both shapes are accepted.
    if isinstance(payload, list):
        return payload
    return payload.get("value") or payload.get("data") or []


def observe_run(
    client: FabricClient,
    workspace_id: str,
    item_id: str,
    workspace: str = "",
    lakehouse: str = "",
    name_map: dict | None = None,
) -> ObservedRun:
    """A notebook's last real run → the tables it actually read and wrote.

    Never raises. Every failure becomes a note on the result, because this is
    enrichment: a sandbox run that could not also fetch its history is still a
    perfectly good sandbox run, and turning that into a 502 would trade a whole
    feature for a nice-to-have.
    """
    observed = ObservedRun()

    try:
        sessions = list_runs(client, workspace_id, item_id)
    except FabricError as exc:
        observed.notes.append(f"could not list runs for this notebook — {exc}")
        return observed

    if not sessions:
        observed.notes.append(
            "this notebook has no recorded Spark runs. Fabric keeps roughly 30 "
            "days of history, so a notebook that has not run recently shows none."
        )
        return observed

    session = latest_run(sessions)
    livy_id = str(_first(session or {}, "livyId", "livySessionId", "id") or "")
    app_id = str(_first(session or {}, "sparkApplicationId", "applicationId", "appId") or "")
    observed.livy_id = livy_id
    observed.state = str(_first(session or {}, "state", "status") or "")
    observed.application_id = app_id
    observed.submitted_at = str(
        _first(session or {}, "submittedDateTime", "startDateTime", "queuedDateTime") or ""
    )
    submitter = _first(session or {}, "submitter", "creator") or {}
    observed.submitter = (
        submitter.get("displayName") or submitter.get("userPrincipalName") or ""
        if isinstance(submitter, dict)
        else str(submitter)
    )

    if not (livy_id and app_id):
        observed.notes.append(
            "the most recent run reported no Spark application id, so there are "
            "no plans to read. A session that failed to start looks like this."
        )
        return observed

    try:
        executions = _sql_executions(client, workspace_id, item_id, livy_id, app_id)
    except FabricError as exc:
        observed.notes.append(f"could not read the run's SQL executions — {exc}")
        return observed

    total = PlanScan()
    for execution in executions[:_MAX_STATEMENTS]:
        observed.statements_seen += 1
        plan = execution.get("planDescription") or ""
        scan = scan_plan(plan, workspace, lakehouse, name_map)
        total.merge(scan)
        if not (scan.reads or scan.writes):
            continue
        observed.statements_resolved += 1
        observed.statements.append(
            ObservedStatement(
                execution_id=int(execution.get("id") or 0),
                description=str(execution.get("description") or "")[:300],
                status=str(execution.get("status") or ""),
                submitted=str(execution.get("submissionTime") or ""),
                duration_ms=execution.get("duration"),
                reads=sorted(scan.reads),
                writes=sorted(scan.writes),
            )
        )

    # A table written by one statement and read by another is a write overall —
    # the same rule the sandbox applies, so the two answers stay comparable.
    observed.writes = sorted(total.writes)
    observed.reads = sorted(total.reads - total.writes)
    observed.unrecognised = sorted(total.unrecognised)
    observed.tables = {
        ref: TableRef(**parts)
        for ref, parts in table_refs(observed.reads + observed.writes).items()
    }
    observed.available = True

    if not observed.statements_seen:
        observed.notes.append(
            "the run recorded no SQL executions. Spark only creates one when an "
            "ACTION runs, so a notebook that builds DataFrames without "
            "materialising them leaves no plans behind."
        )
    elif not observed.statements_resolved:
        observed.notes.append(
            f"{observed.statements_seen} SQL execution(s) ran, none naming a table "
            "this parser could resolve — typically in-memory work only."
        )
    if observed.unrecognised:
        observed.notes.append(
            f"{len(observed.unrecognised)} plan node type(s) not recognised: "
            + ", ".join(observed.unrecognised[:6])
        )
    if len(sessions) > 1:
        observed.notes.append(f"{len(sessions)} run(s) in history; showing the most recent.")
    return observed


def compare(
    predicted_reads: list[str],
    predicted_writes: list[str],
    observed: ObservedRun,
) -> RunComparison:
    """The sandbox's prediction against what really ran.

    Set arithmetic on refs, nothing cleverer. Both sides already speak canonical
    refs — the sandbox derives them from source, this module from `abfss://`
    paths in a plan, and `_refs.qualify` is the single implementation both go
    through — so they are directly comparable without any name matching.

    See `RunComparison` for why neither side is the "right" one.
    """
    pr, pw = set(predicted_reads or []), set(predicted_writes or [])
    orr, ow = set(observed.reads or []), set(observed.writes or [])
    return RunComparison(
        agreed_reads=sorted(pr & orr),
        agreed_writes=sorted(pw & ow),
        predicted_only_reads=sorted(pr - orr),
        predicted_only_writes=sorted(pw - ow),
        observed_only_reads=sorted(orr - pr),
        observed_only_writes=sorted(ow - pw),
    )
