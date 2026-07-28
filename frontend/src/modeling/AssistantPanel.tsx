// The model assistant — ask the lineage graph a question in English.
//
// A docked panel rather than a modal, for the same reason Views is one: the
// answer is about the thing on screen, and a modal would cover it. Clicking an
// entity in a trace selects and reveals it on the canvas behind, which is the
// whole point of docking — the answer and the graph are readable together.
//
// This component is a transcript and a composer. It holds NO knowledge of
// lineage: the backend runs the traversal (backend/app/chat/graph.py) and the
// LLM phrases the result, and the panel's one editorial job is to keep the
// answer's provenance visible rather than presenting prose as fact.
//
// Two things it deliberately makes ugly:
//
//   - An answer with an EMPTY TRACE is badged "not checked against the model".
//     That is the model replying from the outline in its system prompt instead
//     of reading the graph, and it is the one failure mode where a wrong answer
//     looks exactly like a right one.
//   - The trace shows each walk's own caveats ("object level", "truncated")
//     rather than a tidy count, so prose implying column lineage next to a
//     table-level walk is a visible contradiction instead of a silent one.
import { useEffect, useMemo, useRef, useState } from 'react'
import { askAssistant, fetchChatStatus } from '../api'
import type { AssistantAnswer, ChatMessage, ProposedEdit } from '../api'
import type { EntityId, LineageModel } from '../model/types'
import { BarsSpinner } from '../shell/BarsSpinner'

/** A user turn plus, for an assistant turn, the walks that produced it. */
interface Turn extends ChatMessage {
  trace?: AssistantAnswer['trace']
  proposals?: ProposedEdit[]
  stopReason?: AssistantAnswer['stop_reason']
}

// Each of these maps onto an operation the engine can actually compute. The
// third and fourth are scans rather than walks — they were unanswerable until
// lineage_gaps and coverage existed, and a chip promising something the engine
// cannot do just teaches the model to improvise.
const EXAMPLES = [
  'Where does this column end up?',
  'What breaks if I drop this table?',
  'Which columns have no lineage recorded?',
  'How much of this model is verified?',
  'Has this table drifted from Fabric?',
]

export function AssistantPanel({
  model,
  selection,
  onSelect,
  onApplyEdits,
  onSetInstructions,
  onClose,
}: {
  model: LineageModel
  /**
   * Entity ids selected on the canvas. Sent with every question so "this
   * column" resolves to what the user is pointing at rather than to whatever a
   * name search happens to return first.
   */
  selection: EntityId[]
  /** Select and reveal an entity on the canvas behind the panel. */
  onSelect: (id: EntityId) => void
  /**
   * Apply approved proposals. The panel never edits the model itself — it hands
   * the accepted edits up, and the viewer runs them through the normal editor
   * and undo history so an assistant edit is indistinguishable from a hand one.
   */
  onApplyEdits: (edits: ProposedEdit[]) => void
  /** Save the house rules onto the model. Committed on blur, not per keystroke. */
  onSetInstructions: (text: string) => void
  onClose: () => void
}) {
  const [rulesOpen, setRulesOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)

  const paths = useMemo(() => entityPaths(model), [model])
  const scroller = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchChatStatus()
      .then((s) => {
        if (!cancelled) setConfigured(s.configured)
      })
      // An unreachable backend is indistinguishable from an unconfigured one
      // from here, and both mean the same thing to the user: not available.
      .catch(() => {
        if (!cancelled) setConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Pin to the newest turn. The transcript grows at the bottom and a question
    // whose answer lands off-screen reads as no answer at all.
    // Assigning scrollTop rather than calling scrollTo: jsdom implements the
    // property but not the method, and there is no smooth-scroll to want here.
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [turns, busy])

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    setDraft('')
    setError(null)
    setBusy(true)
    // The full conversation goes up each turn — there is no server-side
    // session, so this array IS the memory.
    const history: Turn[] = [...turns, { role: 'user', content: question }]
    setTurns(history)
    try {
      const answer = await askAssistant(
        model,
        history.map((t) => ({ role: t.role, content: t.content })),
        selection,
      )
      setTurns([
        ...history,
        {
          role: 'assistant',
          content: answer.text,
          trace: answer.trace,
          proposals: answer.proposals ?? [],
          stopReason: answer.stop_reason,
        },
      ])
    } catch (err) {
      // The question stays in the transcript: retrying should not mean retyping.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="as-panel" aria-label="Assistant">
      <header className="vw-head">
        <h2 className="vw-title">Assistant</h2>
        <button
          className="as-rules-toggle"
          aria-expanded={rulesOpen}
          aria-label="House rules"
          title="House rules — how the assistant should answer"
          onClick={() => setRulesOpen((open) => !open)}
        >
          Rules{model.assistantInstructions?.trim() ? ' •' : ''}
        </button>
        <button className="tg-x" onClick={onClose} aria-label="Close assistant">
          ×
        </button>
      </header>

      {rulesOpen && (
        <HouseRules value={model.assistantInstructions ?? ''} onSave={onSetInstructions} />
      )}

      <div className="as-log" ref={scroller}>
        {turns.length === 0 && (
          <div className="as-empty">
            <p className="as-empty-lead">
              Ask about this model’s lineage. Every answer is computed by walking the
              graph — the steps are shown so you can check them.
            </p>
            <div className="as-examples">
              {EXAMPLES.map((q) => (
                <button key={q} className="as-example" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div className="as-turn" data-role={turn.role} key={i}>
            <div className="as-bubble">{turn.content}</div>
            {turn.role === 'assistant' && (
              <>
                <TraceList trace={turn.trace ?? []} paths={paths} onSelect={onSelect} />
                {(turn.proposals?.length ?? 0) > 0 && (
                  <ProposalList
                    proposals={turn.proposals ?? []}
                    onApply={onApplyEdits}
                    // Discarding is local: the proposal is gone from the
                    // transcript and nothing is sent anywhere. There is nothing
                    // on the server to tell.
                    onDiscard={(remaining) =>
                      setTurns((prev) =>
                        prev.map((t, j) => (j === i ? { ...t, proposals: remaining } : t)),
                      )
                    }
                  />
                )}
              </>
            )}
          </div>
        ))}

        {busy && (
          <div className="as-turn" data-role="assistant">
            <div className="as-bubble as-thinking">
              <BarsSpinner size={12} /> Walking the graph…
            </div>
          </div>
        )}

        {error && <div className="as-error">{error}</div>}
      </div>

      {configured === false ? (
        <div className="as-off">
          The assistant isn’t available on this backend. It needs an
          <code> ANTHROPIC_API_KEY</code> in the environment.
        </div>
      ) : (
        <>
          {selection.length > 0 && (
            /* The assistant resolving a pronoun to a selection the user has
               forgotten about is indistinguishable from it guessing. Naming the
               referent makes the behaviour checkable rather than uncanny. */
            <div className="as-referent" title="Vague references resolve to this">
              Referring to{' '}
              <strong>
                {selection.length === 1
                  ? (paths.get(selection[0]) ?? '1 selected entity')
                  : `${selection.length} selected entities`}
              </strong>
            </div>
          )}
          <form
            className="as-composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send(draft)
          }}
        >
          <textarea
            className="as-input"
            value={draft}
            rows={2}
            placeholder="Ask about this model…"
            aria-label="Ask about this model"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line. A chat box where
              // Enter inserts a newline is the wrong way round.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(draft)
              }
            }}
          />
            <button className="as-send" type="submit" disabled={busy || !draft.trim()}>
              Ask
            </button>
          </form>
        </>
      )}
    </aside>
  )
}

/**
 * House rules — the user's own instructions for how answers should read.
 *
 * Drafted locally and committed on blur, matching the Properties panel: one
 * undo step per edit rather than one per keystroke, and the model is not
 * rewritten (and re-persisted) on every character typed.
 *
 * The placeholder is doing real work. Left to guess, people write rules about
 * what the assistant should *conclude*, which is the one thing house rules
 * cannot govern — the backend keeps them downstream of the fidelity rules. The
 * examples are all about voice and shape, which is what they can actually change.
 */
function HouseRules({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value)

  // A rules edit from elsewhere (undo, another tab) should win over a stale draft.
  useEffect(() => setDraft(value), [value])

  return (
    <div className="as-rules">
      <label className="as-rules-label" htmlFor="as-rules-input">
        How should the assistant answer? Applies to this model only.
      </label>
      <textarea
        id="as-rules-input"
        className="as-rules-input"
        rows={4}
        value={draft}
        placeholder={
          'e.g. Answer in British English.\n' +
          'Lead with a one-line summary, then the detail.\n' +
          'Use a bullet per hop when describing a path.\n' +
          'Always name the layer a table sits in.'
        }
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft)
        }}
      />
      <p className="as-rules-note">
        These shape voice and formatting. They can’t change what the assistant treats
        as a fact — a table-level answer stays a table-level answer.
      </p>
    </div>
  )
}

/**
 * Proposed edits, awaiting approval.
 *
 * The header says "Proposed changes" and the button says "Apply", because the
 * one thing this must never do is read as work already done — the assistant is
 * told the same, and the two have to agree or the user is misled by whichever
 * they read first.
 *
 * Applied and discarded proposals LEAVE the list rather than staying greyed
 * out. A spent proposal that still shows an Apply button invites a second
 * click, and a second Apply is either a silent no-op or a duplicate edit.
 */
function ProposalList({
  proposals,
  onApply,
  onDiscard,
}: {
  proposals: ProposedEdit[]
  onApply: (edits: ProposedEdit[]) => void
  onDiscard: (remaining: ProposedEdit[]) => void
}) {
  const take = (edits: ProposedEdit[], keep: ProposedEdit[]) => {
    onApply(edits)
    onDiscard(keep)
  }

  return (
    <div className="as-proposals">
      <div className="as-proposals-head">
        <span className="as-proposals-title">
          Proposed change{proposals.length === 1 ? '' : 's'}
        </span>
        <span className="as-proposals-note">not applied yet</span>
      </div>

      <ul className="as-proposal-list">
        {proposals.map((edit, i) => (
          <li className="as-proposal" key={i}>
            <span className="as-proposal-kind">{KIND_LABEL[edit.kind] ?? edit.kind}</span>
            <span className="as-proposal-target">{targetLabel(edit)}</span>
            <p className="as-proposal-why">{edit.describes}</p>
            <div className="as-proposal-acts">
              <button
                className="as-proposal-apply"
                onClick={() => take([edit], proposals.filter((_, j) => j !== i))}
              >
                Apply
              </button>
              <button
                className="as-proposal-skip"
                onClick={() => onDiscard(proposals.filter((_, j) => j !== i))}
              >
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>

      {proposals.length > 1 && (
        <div className="as-proposal-acts">
          <button className="as-proposal-apply" onClick={() => take(proposals, [])}>
            Apply all {proposals.length}
          </button>
          <button className="as-proposal-skip" onClick={() => onDiscard([])}>
            Discard all
          </button>
        </div>
      )}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  add_transition: 'New lineage',
  set_property: 'Set property',
  add_tag: 'Add tag',
  rename: 'Rename',
}

/** What the edit acts on, named by path rather than by id. */
function targetLabel(edit: ProposedEdit): string {
  if (edit.kind === 'add_transition') {
    return `${edit.source_path ?? edit.source_id ?? '?'} → ${edit.target_path ?? edit.target_id ?? '?'}`
  }
  const where = edit.entity_path ?? edit.entity_id ?? '?'
  if (edit.kind === 'set_property') return `${where} · ${edit.key} = ${edit.value}`
  if (edit.kind === 'add_tag') return `${where} · ${edit.value}`
  return `${where} → ${edit.value}`
}

function TraceList({
  trace,
  paths,
  onSelect,
}: {
  trace: AssistantAnswer['trace']
  paths: Map<EntityId, string>
  onSelect: (id: EntityId) => void
}) {
  const [open, setOpen] = useState(false)

  if (trace.length === 0) {
    return (
      <div className="as-untraced" title="No traversal ran for this answer.">
        not checked against the model
      </div>
    )
  }

  return (
    <div className="as-trace">
      <button className="as-trace-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {trace.length} step{trace.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ol className="as-steps">
          {trace.map((call, i) => {
            // Only entity_id is a canvas coordinate. A find_entity call names a
            // string the user typed, which points at nothing selectable.
            const id = typeof call.input.entity_id === 'string' ? call.input.entity_id : null
            const label = id ? paths.get(id) : null
            return (
              <li className="as-step" key={i}>
                <span className="as-step-name">{VERB[call.name] ?? call.name}</span>
                {label && id ? (
                  <button className="as-step-entity" onClick={() => onSelect(id)}>
                    {label}
                  </button>
                ) : (
                  <span className="as-step-arg">{argLabel(call.input)}</span>
                )}
                <span className="as-step-result">{call.result}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

const VERB: Record<string, string> = {
  find_entity: 'found',
  trace_downstream: 'downstream of',
  trace_upstream: 'upstream of',
  describe_entity: 'described',
  lineage_gaps: 'scanned for gaps',
  impact: 'impact of',
  coverage: 'measured coverage',
  // Named for the source they read, not the action: a step that says "Fabric"
  // is the reader's signal that this claim is about the live tenant and not
  // about the authored model.
  fabric_search: 'searched Fabric for',
  fabric_table_schema: 'read Fabric schema',
  compare_to_fabric: 'compared to Fabric',
}

function argLabel(input: Record<string, unknown>): string {
  const name = input.name
  return typeof name === 'string' ? `“${name}”` : ''
}

/**
 * id → display path, for naming an entity the assistant traced.
 *
 * Walks attributes RECURSIVELY: a group is an attribute with children (see
 * model/types.ts), so a one-level read would leave every grouped column
 * unnamed — and an unnamed trace step is one the user cannot click through to.
 */
function entityPaths(model: LineageModel): Map<EntityId, string> {
  const out = new Map<EntityId, string>()
  const walk = (attrs: LineageModel['layers'][number]['objects'][number]['children'], trail: string[]) => {
    for (const attr of attrs) {
      const here = [...trail, attr.name]
      out.set(attr.id, here.join(' / '))
      walk(attr.children, here)
    }
  }
  for (const layer of model.layers) {
    out.set(layer.id, layer.name)
    for (const obj of layer.objects) {
      const trail = [layer.name, obj.name]
      out.set(obj.id, trail.join(' / '))
      walk(obj.children, trail)
    }
  }
  return out
}
