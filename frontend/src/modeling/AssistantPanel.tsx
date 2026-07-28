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
import type { AssistantAnswer, ChatMessage } from '../api'
import type { EntityId, LineageModel } from '../model/types'
import { BarsSpinner } from '../shell/BarsSpinner'

/** A user turn plus, for an assistant turn, the walks that produced it. */
interface Turn extends ChatMessage {
  trace?: AssistantAnswer['trace']
  stopReason?: AssistantAnswer['stop_reason']
}

const EXAMPLES = [
  'What feeds this model’s gold layer?',
  'Where does this column end up?',
  'Which columns have no lineage recorded?',
]

export function AssistantPanel({
  model,
  onSelect,
  onClose,
}: {
  model: LineageModel
  /** Select and reveal an entity on the canvas behind the panel. */
  onSelect: (id: EntityId) => void
  onClose: () => void
}) {
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
      )
      setTurns([
        ...history,
        {
          role: 'assistant',
          content: answer.text,
          trace: answer.trace,
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
        <button className="tg-x" onClick={onClose} aria-label="Close assistant">
          ×
        </button>
      </header>

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
              <TraceList trace={turn.trace ?? []} paths={paths} onSelect={onSelect} />
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
      )}
    </aside>
  )
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
