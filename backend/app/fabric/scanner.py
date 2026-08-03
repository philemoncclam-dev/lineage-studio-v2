"""The BI half of the lineage: semantic models, reports and dashboards.

Everything else in this app stops at the lakehouse table. Fabric's own lineage
view does not — it carries on through the semantic model to the report, which is
the half a business reader actually recognises, and the half that answers "who
sees this number". This is where that comes from.

WHY A SEPARATE CLIENT. This is the Power BI **admin metadata scanner**, not the
Fabric REST API:

  * different host (`api.powerbi.com`, not `api.fabric.microsoft.com`);
  * different token audience — `https://analysis.windows.net/powerbi/api`, so a
    Fabric token is rejected outright;
  * different authority — the caller must be a Fabric administrator, or a
    service principal explicitly allowed in the tenant's *metadata scanning*
    settings. Ordinary workspace access is not enough and never becomes enough.

So this is deliberately optional everywhere it is consumed. A tenant that has
not turned it on gets the graph it always got, plus a note saying which half is
missing — never an error, and never silence.

IT IS ASYNCHRONOUS, in three legs: POST `getInfo` returns a scan id, GET
`scanStatus/{id}` is polled until `Succeeded`, GET `scanResult/{id}` returns the
metadata. Rate limits are real and low (500 getInfo/hour, 16 concurrent, max 100
workspaces per call), which is why nothing here is on a page load.

WHICH EDGES ARE DRAWN, AND WHY NOT MORE. A report names its semantic model by id
(`report.datasetId`), and a dashboard tile names both — those are facts, stated
by the API, and they are drawn. A semantic model's connection to a LAKEHOUSE is
inferred from its datasource instances, and only when the connection resolves to
a lakehouse this crawl already knows by name; a guess that a dataset reading
`sqlserver.database.windows.net` is "probably" some lakehouse would be exactly
the fabricated edge the rest of this codebase refuses to draw.

The M/Mashup expressions in `tables[].source[]` would give table-level lineage
into a semantic model, and are deliberately NOT parsed here: M is a real
language, the expressions arrive as free text, and half-parsing one produces
confident wrong answers about which table feeds which report.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

#: Azure AD scope for the Power BI service. NOT the Fabric scope — the admin
#: endpoints reject a Fabric token, and the failure looks like a permissions
#: problem rather than a wrong-audience one, so it is worth being explicit.
POWERBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default"

_BASE = "https://api.powerbi.com/v1.0/myorg/admin"

#: Documented ceiling on one `getInfo` call.
MAX_WORKSPACES_PER_SCAN = 100

#: Terminal states of a scan. Anything else means "still going".
_DONE = "succeeded"
_FAILED = ("failed", "cancelled")


class ScannerError(RuntimeError):
    """The scanner is unavailable, unauthorised, or failed a scan."""


@dataclass
class BiDataset:
    """A semantic model (the API still calls it a dataset)."""

    id: str
    name: str
    workspace_id: str
    #: `datasourceInstanceId`s this model reads, resolved below where possible.
    datasource_ids: list[str] = field(default_factory=list)
    #: Upstream semantic models, for a composite model.
    upstream_dataset_ids: list[str] = field(default_factory=list)
    upstream_dataflow_ids: list[str] = field(default_factory=list)


@dataclass
class BiReport:
    id: str
    name: str
    workspace_id: str
    #: The semantic model it renders. Empty for a paginated report bound
    #: directly to a datasource rather than to a model.
    dataset_id: str = ""


@dataclass
class BiDashboard:
    id: str
    name: str
    workspace_id: str
    #: Distinct reports its tiles come from.
    report_ids: list[str] = field(default_factory=list)


@dataclass
class BiDatasource:
    """One entry from the tenant-wide `datasourceInstances` table."""

    id: str
    kind: str
    #: The connection, flattened — `server`/`database`, or `path`/`url` for the
    #: file-shaped kinds. Kept raw because what identifies a lakehouse differs
    #: by connector and guessing a single field would lose most of them.
    details: dict[str, str] = field(default_factory=dict)


@dataclass
class ScanResult:
    datasets: list[BiDataset] = field(default_factory=list)
    reports: list[BiReport] = field(default_factory=list)
    dashboards: list[BiDashboard] = field(default_factory=list)
    datasources: dict[str, BiDatasource] = field(default_factory=dict)
    #: Why a workspace contributed nothing, when it did — kept so the UI can
    #: say "not scanned" rather than implying "nothing there".
    notes: list[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not (self.datasets or self.reports or self.dashboards)


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def parse_scan_result(payload: dict) -> ScanResult:
    """A `scanResult` body → the BI objects and the links between them.

    Pure. Every consumer of this module is testable without a tenant, an admin
    account, or the scanner being switched on at all.
    """
    out = ScanResult()

    for source in (payload or {}).get("datasourceInstances") or []:
        ds_id = _text(source.get("datasourceId"))
        if not ds_id:
            continue
        details = source.get("connectionDetails") or {}
        out.datasources[ds_id] = BiDatasource(
            id=ds_id,
            kind=_text(source.get("datasourceType")),
            details={k: _text(v) for k, v in details.items() if _text(v)},
        )

    for workspace in (payload or {}).get("workspaces") or []:
        ws_id = _text(workspace.get("id"))
        # A workspace the scan could not read comes back as a shell with a
        # state and nothing else. Saying so is the point — an empty workspace
        # and an unreadable one must not look the same.
        state = _text(workspace.get("state")) or "Unknown"
        if state.lower() not in ("active", ""):
            out.notes.append(
                f"Workspace {_text(workspace.get('name')) or ws_id} was not scanned ({state})."
            )
            continue

        for dataset in workspace.get("datasets") or []:
            d_id = _text(dataset.get("id"))
            if not d_id:
                continue
            out.datasets.append(
                BiDataset(
                    id=d_id,
                    name=_text(dataset.get("name")) or d_id,
                    workspace_id=ws_id,
                    datasource_ids=[
                        _text(u.get("datasourceInstanceId"))
                        for u in dataset.get("datasourceUsages") or []
                        if _text(u.get("datasourceInstanceId"))
                    ],
                    upstream_dataset_ids=[
                        _text(u.get("targetDatasetId"))
                        for u in dataset.get("upstreamDatasets") or []
                        if _text(u.get("targetDatasetId"))
                    ],
                    upstream_dataflow_ids=[
                        _text(u.get("targetDataflowId"))
                        for u in dataset.get("upstreamDataflows") or []
                        if _text(u.get("targetDataflowId"))
                    ],
                )
            )

        for report in workspace.get("reports") or []:
            r_id = _text(report.get("id"))
            if not r_id:
                continue
            out.reports.append(
                BiReport(
                    id=r_id,
                    name=_text(report.get("name")) or r_id,
                    workspace_id=ws_id,
                    dataset_id=_text(report.get("datasetId")),
                )
            )

        for dashboard in workspace.get("dashboards") or []:
            b_id = _text(dashboard.get("id"))
            if not b_id:
                continue
            # A dashboard's tiles each name their report; the dashboard depends
            # on every distinct one. Order is kept stable for the same reason
            # everything else here is sorted — a diff of two crawls should show
            # real change only.
            reports = []
            for tile in dashboard.get("tiles") or []:
                rid = _text(tile.get("reportId"))
                if rid and rid not in reports:
                    reports.append(rid)
            out.dashboards.append(
                BiDashboard(
                    id=b_id,
                    name=_text(dashboard.get("displayName")) or _text(dashboard.get("name")) or b_id,
                    workspace_id=ws_id,
                    report_ids=reports,
                )
            )

    return out


def lakehouse_for_datasource(source: BiDatasource, lakehouse_names: dict[str, str]) -> str:
    """The lakehouse a datasource points at, or `""` when it is not one.

    `lakehouse_names` maps a lowercased lakehouse name to its item id. Matching
    is on the connection's own fields — a Fabric lakehouse or warehouse reached
    over its SQL endpoint names the item in `database`, and a DirectLake model
    names it in the path. Anything that does not match one of the lakehouses
    this crawl actually found returns empty: a semantic model reading a real SQL
    Server is upstream of nothing we know about, and inventing a link to a
    same-named lakehouse would be a fabricated edge.
    """
    for key in ("database", "path", "url", "server"):
        value = source.details.get(key, "")
        if not value:
            continue
        # A path or URL carries the item as one of its segments.
        for candidate in [value] + [seg for seg in value.replace("\\", "/").split("/") if seg]:
            hit = lakehouse_names.get(candidate.strip().lower())
            if hit:
                return hit
    return ""


class ScannerClient:
    """The three-leg admin scan, over an injected transport.

    `request(method, url, **kwargs) -> (status, json)` is supplied by the caller
    so this class carries no auth of its own and is testable with a stub. The
    Fabric client already owns credential handling; duplicating it here would
    mean two places to get token audiences wrong.
    """

    def __init__(
        self,
        request: Callable[..., tuple[int, dict]],
        *,
        poll_interval: float = 2.0,
        timeout: float = 120.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._request = request
        self._poll_interval = poll_interval
        self._timeout = timeout
        self._sleep = sleep

    def scan(self, workspace_ids: list[str]) -> ScanResult:
        """Scan up to `MAX_WORKSPACES_PER_SCAN` workspaces and parse the result."""
        ids = [w for w in workspace_ids if w][:MAX_WORKSPACES_PER_SCAN]
        if not ids:
            return ScanResult(notes=["No workspaces to scan."])

        status, body = self._request(
            "POST",
            f"{_BASE}/workspaces/getInfo",
            params={"lineage": "true", "datasourceDetails": "true"},
            json={"workspaces": ids},
        )
        if status == 401 or status == 403:
            raise ScannerError(
                "The metadata scanner refused this caller. It needs a Fabric "
                "administrator, or a service principal enabled under the "
                "tenant's metadata-scanning settings — ordinary workspace "
                "access is never sufficient."
            )
        if status >= 400:
            raise ScannerError(f"Scan could not be started [{status}].")

        scan_id = _text(body.get("id"))
        if not scan_id:
            raise ScannerError("Scan was accepted but returned no id.")

        deadline = self._timeout
        while True:
            status, body = self._request("GET", f"{_BASE}/workspaces/scanStatus/{scan_id}")
            if status >= 400:
                raise ScannerError(f"Scan status could not be read [{status}].")
            state = _text(body.get("status")).lower()
            if state == _DONE:
                break
            if state in _FAILED:
                raise ScannerError(f"The scan {state}.")
            if deadline <= 0:
                # Not an error worth failing the whole crawl over — the caller
                # degrades to a table-level graph and says the BI half timed
                # out, which is true and more useful than nothing.
                raise ScannerError("The scan did not finish in time.")
            self._sleep(self._poll_interval)
            deadline -= self._poll_interval

        status, body = self._request("GET", f"{_BASE}/workspaces/scanResult/{scan_id}")
        if status >= 400:
            raise ScannerError(f"Scan result could not be read [{status}].")
        return parse_scan_result(body)


@dataclass
class BiConsumer:
    """One BI object downstream of something a run wrote."""

    id: str
    name: str
    kind: str  # "semanticmodel" | "report" | "dashboard"
    #: The lakehouse it reaches through — the reason it is in this list.
    via: str = ""


def downstream_of(written_lakehouses: set[str], scan: ScanResult) -> list[BiConsumer]:
    """Semantic models, reports and dashboards fed by these lakehouses.

    The question a sandbox run raises and could not previously answer: this
    notebook writes `Silver`, so **what breaks if it fails tonight?** Table
    lineage stops at the lakehouse; this carries it to the people looking at it.

    Matching is by lakehouse, not by table. The scanner reports a semantic
    model's DATASOURCE, which for a Fabric model is the lakehouse or its SQL
    endpoint — it does not say which tables inside were used without parsing M,
    which this module deliberately does not do. So the honest claim is "this
    model reads that lakehouse", and a caller must not upgrade it to "this model
    reads that table".
    """
    if not written_lakehouses or scan.empty:
        return []
    wanted = {name.strip().lower(): name for name in written_lakehouses if name.strip()}
    if not wanted:
        return []

    out: list[BiConsumer] = []
    hit_datasets: dict[str, str] = {}
    for dataset in scan.datasets:
        for source_id in dataset.datasource_ids:
            source = scan.datasources.get(source_id)
            if not source:
                continue
            via = lakehouse_for_datasource(source, wanted)
            if via:
                hit_datasets[dataset.id] = via
                out.append(
                    BiConsumer(id=dataset.id, name=dataset.name, kind="semanticmodel", via=via)
                )
                break

    hit_reports: dict[str, str] = {}
    for report in scan.reports:
        via = hit_datasets.get(report.dataset_id)
        if via:
            hit_reports[report.id] = via
            out.append(BiConsumer(id=report.id, name=report.name, kind="report", via=via))

    for dashboard in scan.dashboards:
        via = next((hit_reports[r] for r in dashboard.report_ids if r in hit_reports), "")
        if via:
            out.append(
                BiConsumer(id=dashboard.id, name=dashboard.name, kind="dashboard", via=via)
            )

    return out
