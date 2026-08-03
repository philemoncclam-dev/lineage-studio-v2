// The sandbox sequence — Explore's third column. Deliberately NOT a builder
// with its own picker: the tree already is the picker, and adding happens on
// the row you are looking at (`AddToSequence` in routes/fabric/explore.tsx).
// This panel owns exactly two things the tree cannot express — the ORDER of
// the steps, and Run.
//
// The lineage those steps produce is drawn by `SequenceCanvas` in the detail
// column's Sandbox tab; both read the one module store in `fabric/sequence.ts`.
import { BarsSpinner } from '../shell/BarsSpinner'
import {
  useSequence,
  removeStep,
  moveStep,
  clearSteps,
  runAll,
  setCompareWithReal,
  type StepKind,
} from './sequence'

export function StepIcon({ kind }: { kind: StepKind }) {
  return (
    <svg
      className="fx-icon"
      data-kind={kind === 'pipeline' ? 'item' : 'notebook'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      {kind === 'pipeline' ? (
        <path d="M4 5h6v5H4zM14 14h6v5h-6zM10 7.5h2.5a1.5 1.5 0 0 1 1.5 1.5v6" />
      ) : (
        <path d="M6 3h9l4 4v14H6z M15 3v4h4M9 12h6M9 16h6" />
      )}
    </svg>
  )
}

export function SequencePanel({ title = 'Sandbox sequence' }: { title?: string }) {
  const { steps, results, running, compareWithReal } = useSequence()

  return (
    <>
      <div className="fx-panel-head fx-panel-head--row">
        <span>{title}</span>
        {steps.length > 0 && (
          <button className="fx-panel-clear" onClick={clearSteps} disabled={running}>
            Clear
          </button>
        )}
      </div>

      <div className="sbx-steps">
        {steps.length === 0 ? (
          <p className="fx-empty">
            Empty. Hover a notebook or pipeline in the tree and hit its <span className="fx-kbd">▶</span>{' '}
            to stack it here, then reorder and run. Steps execute top-to-bottom.
          </p>
        ) : (
          steps.map((step, i) => {
            const st = results.get(step.key)?.status
            return (
              <div className="sbx-step" key={step.key} data-status={st}>
                <span className="sbx-step-num">{i + 1}</span>
                <StepIcon kind={step.kind} />
                <span className="sbx-step-name" title={step.name}>
                  {step.name}
                </span>
                {st === 'running' && <BarsSpinner size={14} />}
                {st === 'ok' && <span className="sbx-step-dot" data-ok />}
                {st === 'error' && <span className="sbx-step-dot" data-err />}
                <div className="sbx-step-ctrls">
                  <button onClick={() => moveStep(step.key, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    onClick={() => moveStep(step.key, 1)}
                    disabled={i === steps.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button onClick={() => removeStep(step.key)} aria-label="Remove">
                    ×
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="sbx-run-bar">
        {/* Sits next to Run rather than in a settings menu, because it changes
            what Run costs — two extra Fabric reads per notebook — and because
            the comparison it produces is the least obvious thing the sandbox
            can tell you. A capability nobody can find is a capability nobody
            has. */}
        <label className="sbx-compare-toggle" title="Read each notebook's last real Fabric run and diff it against this one">
          <input
            type="checkbox"
            checked={compareWithReal}
            disabled={running}
            onChange={(e) => setCompareWithReal(e.target.checked)}
          />
          Compare with last real run
        </label>
        <button className="fx-btn fx-btn--primary" onClick={runAll} disabled={steps.length === 0 || running}>
          {running ? 'Running…' : `Run sequence${steps.length ? ` (${steps.length})` : ''}`}
        </button>
      </div>
    </>
  )
}
