// Snapshot history: save a version, see what changed, put one back.
//
// The store has had `saveVersion` / `listVersions` / `getVersion` since it was
// written, fully working and tested, and nothing ever called them — the whole
// feature was unreachable from the app. This is the missing half.
//
// Restoring is the dangerous bit and shapes the panel. It overwrites the model
// you have open, so a version is never restored from the list directly: you
// select one, read what restoring would change (`diffVersions`, phrased from
// the point of view of the model you are holding), and confirm. Undo covers it
// afterwards — restore goes through the same `onChange` every edit does — but a
// diff read beforehand is worth more than an undo discovered afterwards.
//
// Shares the Views dock's frame (.vw-panel), like the Properties dock does: two
// panels in the same slot that looked different would read as two places.
import { useEffect, useState } from 'react'
import { localStore, type ModelVersion } from '../model/store'
import { diffHeadline, diffVersions, type VersionDiff } from '../model/versionDiff'
import type { LineageModel } from '../model/types'

type VersionMeta = Omit<ModelVersion, 'model'>

export function VersionsPanel({
  model,
  onRestore,
  onClose,
  readOnly = false,
}: {
  model: LineageModel
  /** Hands back the snapshot's graph; the caller applies it as one edit. */
  onRestore: (restored: LineageModel) => void
  onClose: () => void
  readOnly?: boolean
}) {
  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The version being examined, with the diff against what is on screen. */
  const [preview, setPreview] = useState<{ meta: VersionMeta; diff: VersionDiff } | null>(null)

  const refresh = async () => {
    try {
      setVersions(await localStore.listVersions(model.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void refresh()
    // Reset when switching models — a preview of another model's snapshot is
    // a diff against the wrong thing.
    setPreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is recreated per render; model.id is the real input.
  }, [model.id])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      // The store snapshots what is PERSISTED, so the open model has to be
      // saved first or the snapshot silently captures the previous state.
      await localStore.save(model)
      await localStore.saveVersion(model.id, label.trim() || defaultLabel())
      setLabel('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const examine = async (meta: VersionMeta) => {
    setError(null)
    try {
      const snapshot = await localStore.getVersion(model.id, meta.id)
      if (!snapshot) {
        setError('That version could no longer be read.')
        return
      }
      // `from` is the snapshot, `to` is what is open — so "added" means
      // "you added this since, and restoring takes it away".
      setPreview({ meta, diff: diffVersions(snapshot, model) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const restore = async (meta: VersionMeta) => {
    setBusy(true)
    try {
      const snapshot = await localStore.getVersion(model.id, meta.id)
      if (!snapshot) {
        setError('That version could no longer be read.')
        return
      }
      // Keep the model's IDENTITY and its browser metadata; take only the
      // graph. Restoring must not rename the model or resurrect an old
      // description, and it must never change the id the route is on.
      onRestore({
        ...model,
        layers: snapshot.layers,
        transitions: snapshot.transitions,
        properties: snapshot.properties,
        views: snapshot.views,
      })
      setPreview(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="vw-panel" aria-label="Version history">
      <header className="vw-head">
        <h2 className="vw-title">History</h2>
        {versions.length > 0 && <span className="vw-badge">{versions.length}</span>}
        <button className="tg-x" onClick={onClose} aria-label="Close version history">
          ×
        </button>
      </header>

      <div className="vw-body">
        {!readOnly && (
          <div className="vh-save">
            <input
              className="vh-label"
              value={label}
              placeholder="Name this version…"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
              aria-label="Version name"
            />
            <button onClick={() => void save()} disabled={busy}>
              Save
            </button>
          </div>
        )}

        {error && <p className="vh-error">{error}</p>}

        {versions.length === 0 ? (
          <p className="vh-empty">
            No versions yet. Saving one snapshots the whole model, so you can come back
            to it after a change you are not sure about.
          </p>
        ) : (
          <ul className="vh-list">
            {versions.map((v) => (
              <li key={v.id} className="vh-item" data-open={preview?.meta.id === v.id || undefined}>
                <button className="vh-item-main" onClick={() => void examine(v)}>
                  <span className="vh-item-label">{v.label}</span>
                  <span className="vh-item-when">{when(v.savedAt)}</span>
                </button>

                {/* The diff and the restore button appear together, never
                    apart: this is the one place in the app where a click
                    overwrites everything, and it should not be reachable
                    without having been shown what it costs. */}
                {preview?.meta.id === v.id && (
                  <div className="vh-diff">
                    <p className="vh-diff-line">{diffHeadline(preview.diff)}</p>
                    {!preview.diff.empty && (
                      <ul className="vh-diff-detail">
                        {preview.diff.added.slice(0, 5).map((e) => (
                          <li key={`a${e.id}`}>
                            <span data-change="add">+</span> {e.name} <em>{e.kind}</em> — restoring removes it
                          </li>
                        ))}
                        {preview.diff.removed.slice(0, 5).map((e) => (
                          <li key={`r${e.id}`}>
                            <span data-change="del">−</span> {e.name} <em>{e.kind}</em> — restoring brings it back
                          </li>
                        ))}
                        {preview.diff.renamed.slice(0, 5).map((e) => (
                          <li key={`n${e.id}`}>
                            <span data-change="mod">~</span> {e.was} → {e.name}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!readOnly && (
                      <button
                        className="vh-restore"
                        onClick={() => void restore(v)}
                        disabled={busy || preview.diff.empty}
                      >
                        {preview.diff.empty ? 'Nothing to restore' : 'Restore this version'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

/** "3 Aug, 14:05" — a snapshot is found by when it was taken. */
function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const defaultLabel = () => `Snapshot ${when(Date.now())}`
