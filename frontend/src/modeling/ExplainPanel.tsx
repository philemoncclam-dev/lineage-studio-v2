// "Explain" — the lineage of whatever is selected, written out.
//
// The canvas is for people who will follow a line. This dock is for everyone
// else: it answers where the selected thing comes from, what it feeds, and what
// would break if it changed, as text you can read once and quote in an email.
//
// It invents nothing. `model/explain` assembles the sentences out of the
// transitions and the property bag the sandbox port already writes, so anything
// here can be checked against the graph beside it.
//
// Shares the Views dock's skin (`.vw-*`) for the same reason Properties does —
// two docks in the same slot that looked different would read as two different
// kinds of surface.
import { useMemo } from 'react'
import { explain, impactOf, type Link } from '../model/explain'
import type { ModelIndex } from '../model/index'
import type { EntityId, LineageModel } from '../model/types'

export function ExplainPanel({
  model,
  index,
  selection,
  onSelect,
  onClose,
}: {
  model: LineageModel
  index: ModelIndex
  selection: EntityId[]
  /** Walks to a named entity, so every sentence is a way into the canvas. */
  onSelect: (id: EntityId) => void
  onClose: () => void
}) {
  // One subject only. Explaining a multi-selection would have to either merge
  // two lineages into one paragraph — which is how you get a sentence that is
  // true of neither — or print two panels' worth in one column.
  const id = selection.length === 1 ? selection[0] : null
  const story = useMemo(() => (id ? explain(model, index, id) : null), [model, index, id])
  const impact = useMemo(() => (id ? impactOf(index, id) : null), [model, index, id])

  return (
    <aside className="vw-panel xp-panel" aria-label="Explain">
      <header className="vw-head">
        <h2 className="vw-title">Explain</h2>
        <button className="tg-x" onClick={onClose} aria-label="Close explain">
          ×
        </button>
      </header>

      {!story || !impact ? (
        <div className="vw-body">
          <p className="tg-empty">
            {selection.length > 1
              ? 'Select one thing. Two lineages in one paragraph would be true of neither.'
              : 'Select a column, a table or a job on the canvas and its lineage is written out here.'}
          </p>
        </div>
      ) : (
        <div className="vw-body">
          <div className="xp-subject">
            <strong className="xp-name">{story.name}</strong>
            <span className="xp-kind">{story.kind}</span>
            {story.where && <span className="xp-where">in {story.where}</span>}
          </div>
          <p className="xp-headline">{story.headline}</p>

          <Section
            title="Where it comes from"
            links={story.upstream}
            empty="Nothing feeds this — it is where the data enters the model."
            onSelect={onSelect}
          />
          <Section
            title="What it feeds"
            links={story.downstream}
            empty="Nothing reads this yet."
            onSelect={onSelect}
          />

          <div className="xp-sec">
            <h3 className="xp-sec-title">What breaks if this changes</h3>
            {impact.total === 0 ? (
              <p className="xp-empty">
                Nothing downstream depends on this. Changing it affects no other table or report in
                this model.
              </p>
            ) : (
              <>
                <p className="xp-count">
                  <strong>{impact.total}</strong> thing{impact.total === 1 ? '' : 's'} across{' '}
                  <strong>{impact.objects.length}</strong>{' '}
                  {impact.objects.length === 1 ? 'object' : 'objects'}
                  {impact.truncated && ' (and more — the model is larger than this list)'}.
                </p>
                <ul className="xp-list">
                  {impact.objects.map((o) => (
                    <li key={o.id} className="xp-item">
                      <button className="xp-link" onClick={() => onSelect(o.id)}>
                        {o.name}
                      </button>
                      {o.where && <span className="xp-where">{o.where}</span>}
                      {o.items.length > 0 && (
                        // Named, not just counted: "3 columns" makes the reader
                        // go and find out which, which is the work this panel
                        // exists to do for them.
                        <span className="xp-items">{o.items.join(', ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {story.facts.length > 0 && (
            <div className="xp-sec">
              <h3 className="xp-sec-title">Provenance</h3>
              <dl className="xp-facts">
                {story.facts.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function Section({
  title,
  links,
  empty,
  onSelect,
}: {
  title: string
  links: Link[]
  empty: string
  onSelect: (id: EntityId) => void
}) {
  return (
    <div className="xp-sec">
      <h3 className="xp-sec-title">{title}</h3>
      {links.length === 0 ? (
        <p className="xp-empty">{empty}</p>
      ) : (
        <ul className="xp-list">
          {links.map((l) => (
            <li key={l.id + l.what} className="xp-item">
              <button className="xp-link" onClick={() => onSelect(l.id)}>
                {l.what}
              </button>
              {l.where && <span className="xp-where">{l.where}</span>}
              {/* How it got across — the transform where the run resolved one,
                  else "unchanged", which is a fact and not a blank. */}
              {l.how && <span className="xp-how">{l.how}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
