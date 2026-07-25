// Step 3 of the Fabric sync workflow: runtime notebook lineage (Phase 2).
//
// This is the read-only scaffolding of the workflow — pick which notebooks to
// analyze, choose where the helper notebook RUNS and where its extracted
// lineage DATA is written (workspace + Lakehouse), and read the side-effect
// warning. The actual "Run extraction" action is intentionally GATED (disabled)
// until the Entra app has the write/execute scopes consented and the helper
// template (notebookRuntime.ts) has been validated against a live tenant —
// because running it creates + executes a notebook and writes data.
//
// Everything here uses read-only Fabric calls (listWorkspaceNotebooks /
// listWorkspaceLakehouses) with the ordinary read token, so nothing in this
// screen mutates a workspace.
import { useEffect, useState } from "react";
import { BarsSpinner, Button, Select } from "../ui";
import { useToast } from "../ui/toast";
import {
  listWorkspaceNotebooks,
  listWorkspaceLakehouses,
  type FabricWorkspace,
  type FabricItem,
} from "../connectors/fabricConnector";
import {
  getFabricToken,
  getFabricWriteToken,
  getOneLakeToken,
  isFabricMockMode,
} from "../connectors/fabricAuth";
import {
  runRuntimeLineageExtraction,
  realRuntimeDeps,
  type RuntimeNotebookIo,
} from "../connectors/notebookRuntime";
import { realOneLakeDeps } from "../connectors/oneLake";
import { mockFetch, mockSleep } from "../connectors/mockFabric";

const ONELAKE_DFS = "https://onelake.dfs.fabric.microsoft.com";
type RunPhase = "idle" | "creating" | "running" | "reading" | "done" | "error";
const PHASE_LABEL: Record<Exclude<RunPhase, "idle" | "done" | "error">, string> = {
  creating: "Creating helper notebook…",
  running: "Running notebooks…",
  reading: "Reading captured lineage…",
};

export default function RuntimeNotebookLineage({
  workspaces,
  sourceWorkspaceId,
}: {
  workspaces: FabricWorkspace[];
  sourceWorkspaceId: string;
}) {
  // Notebooks discovered in the source workspace (read-only).
  const [notebooks, setNotebooks] = useState<FabricItem[] | null>(null);
  const [notebooksError, setNotebooksError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Destinations the user controls: where the helper runs, and where its
  // lineage output lands (workspace + Lakehouse).
  const [runInWs, setRunInWs] = useState(sourceWorkspaceId);
  const [outputWs, setOutputWs] = useState(sourceWorkspaceId);
  const [lakehouses, setLakehouses] = useState<FabricItem[] | null>(null);
  const [lakehousesError, setLakehousesError] = useState<string | null>(null);
  const [outputLakehouse, setOutputLakehouse] = useState("");

  // Load the notebooks in the source workspace on open / when it changes.
  useEffect(() => {
    if (!sourceWorkspaceId) return;
    let cancelled = false;
    setNotebooks(null);
    setNotebooksError(null);
    (async () => {
      try {
        const list = await listWorkspaceNotebooks(sourceWorkspaceId, await getFabricToken());
        if (!cancelled) setNotebooks(list);
      } catch (err) {
        if (!cancelled) setNotebooksError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceWorkspaceId]);

  // Load the Lakehouses in whichever workspace the output is being sent to.
  useEffect(() => {
    if (!outputWs) return;
    let cancelled = false;
    setLakehouses(null);
    setLakehousesError(null);
    setOutputLakehouse("");
    (async () => {
      try {
        const list = await listWorkspaceLakehouses(outputWs, await getFabricToken());
        if (cancelled) return;
        setLakehouses(list);
        if (list.length) setOutputLakehouse(list[0].id);
      } catch (err) {
        if (!cancelled) setLakehousesError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outputWs]);

  // Run state.
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<RuntimeNotebookIo[] | null>(null);
  const toast = useToast();

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const running = phase === "creating" || phase === "running" || phase === "reading";
  const canRun = selected.size > 0 && !!outputLakehouse && !running;

  async function handleRun() {
    if (!canRun) return;
    const targets = (notebooks ?? [])
      .filter((nb) => selected.has(nb.id))
      .map((nb) => ({ id: nb.id, name: nb.displayName, runPath: nb.displayName }));
    const runId = Date.now();
    const resultReadPath = `${outputLakehouse}/Files/lineage/${runId}.json`;
    const outputAbfssPath = `${ONELAKE_DFS}/${outputWs}/${resultReadPath}`;
    const mock = isFabricMockMode();

    setRunError(null);
    setCaptured(null);
    setPhase("creating");
    toast.info(`Running ${targets.length} notebook${targets.length === 1 ? "" : "s"}…`);
    try {
      const [writeToken, oneLakeToken] = await Promise.all([
        getFabricWriteToken(),
        getOneLakeToken(),
      ]);
      const io = await runRuntimeLineageExtraction({
        deps: mock ? { fetchImpl: mockFetch, sleep: mockSleep } : realRuntimeDeps,
        oneLakeDeps: mock ? { fetchImpl: mockFetch } : realOneLakeDeps,
        runWorkspaceId: runInWs,
        outputWorkspaceId: outputWs,
        fabricWriteToken: writeToken,
        oneLakeToken,
        targets,
        outputAbfssPath,
        resultReadPath,
        onPhase: setPhase,
      });
      setCaptured(io);
      setPhase("done");
      toast.success(
        `Extraction complete — captured lineage for ${io.length} notebook${io.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunError(message);
      setPhase("error");
      toast.error(`Extraction failed: ${message}`);
    }
  }

  return (
    <div className="sync-field-group runtime-nb">
      <p className="sync-field-help">
        Runs the selected notebooks with a lineage listener to capture the real
        tables they read and write, then adds them as a Transformations layer.
        This <strong>executes your notebooks</strong> — they may write or
        overwrite data and use Spark compute — so choose where they run and where
        the output goes.
      </p>

      {/* Which notebooks to analyze */}
      <label className="ui-field-label">Notebooks to analyze</label>
      {notebooksError && <div className="import-error">{notebooksError}</div>}
      {!notebooks && !notebooksError && <div className="muted loading-row"><BarsSpinner size={16} />Loading notebooks…</div>}
      {notebooks && notebooks.length === 0 && (
        <div className="muted">No notebooks found in this workspace.</div>
      )}
      {notebooks && notebooks.length > 0 && (
        <ul className="runtime-nb-list">
          {notebooks.map((nb) => (
            <li key={nb.id}>
              <label className="import-mode-label">
                <input
                  type="checkbox"
                  checked={selected.has(nb.id)}
                  onChange={() => toggle(nb.id)}
                />
                {nb.displayName}
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* Where the helper runs */}
      <label className="ui-field-label" htmlFor="runtime-nb-runin">
        Run the extraction in
      </label>
      <Select id="runtime-nb-runin" value={runInWs} onChange={(e) => setRunInWs(e.target.value)}>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.displayName}
          </option>
        ))}
      </Select>

      {/* Where the output data goes: workspace + Lakehouse */}
      <label className="ui-field-label" htmlFor="runtime-nb-outws">
        Write lineage output to
      </label>
      <div className="sync-inline-row">
        <Select id="runtime-nb-outws" value={outputWs} onChange={(e) => setOutputWs(e.target.value)}>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayName}
            </option>
          ))}
        </Select>
        <Select
          value={outputLakehouse}
          onChange={(e) => setOutputLakehouse(e.target.value)}
          disabled={!lakehouses || lakehouses.length === 0}
        >
          {!lakehouses && <option value="">Loading Lakehouses…</option>}
          {lakehouses && lakehouses.length === 0 && <option value="">No Lakehouses here</option>}
          {lakehouses?.map((lh) => (
            <option key={lh.id} value={lh.id}>
              {lh.displayName}
            </option>
          ))}
        </Select>
      </div>
      {lakehousesError && <div className="import-error">{lakehousesError}</div>}

      {/* Action */}
      <div className="sync-inline-row runtime-nb-run">
        <Button variant="primary" onClick={handleRun} disabled={selected.size === 0 || !outputLakehouse} loading={running}>
          {running ? "Running…" : "Run extraction"}
        </Button>
        <span className={`runtime-nb-status runtime-nb-status--${phase}`} role="status">
          {running
            ? PHASE_LABEL[phase as keyof typeof PHASE_LABEL]
            : phase === "done"
              ? "✓ Done"
              : phase === "error"
                ? "✕ Failed — see below"
                : selected.size === 0
                  ? "Select at least one notebook."
                  : !outputLakehouse
                    ? "Choose an output Lakehouse."
                    : "Creates + runs a helper notebook, then reads results from the output Lakehouse."}
        </span>
      </div>

      {runError && <div className="import-error">{runError}</div>}

      {captured && (
        <div className="runtime-nb-result">
          {captured.length === 0 && <div className="muted">No lineage was captured.</div>}
          {captured.map((nb) => (
            <div key={nb.id} className="runtime-nb-result-row">
              <strong>{nb.name || nb.id}</strong>
              <div className="runtime-nb-io">
                <span className="muted">reads:</span> {nb.reads.join(", ") || "—"}
              </div>
              <div className="runtime-nb-io">
                <span className="muted">writes:</span> {nb.writes.join(", ") || "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
