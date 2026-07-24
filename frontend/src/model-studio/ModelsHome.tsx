// /model landing: the model library. Create, open, duplicate, and delete
// authored models (each persisted separately in localStorage) — the multi-model
// CRUD idea ported from lineage-studio's HomePage, restyled for this shell.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { deleteModel, duplicateModel, listModels, saveModel } from './localdb'
import { newModel, type NodeType } from './types'
import './model-studio.css'

const TYPE_LABELS: [NodeType, string][] = [
  ['Layer', 'layers'],
  ['Object', 'systems'],
  ['Group', 'tables'],
  ['Attribute', 'columns'],
]

export default function ModelsHome() {
  const navigate = useNavigate()
  const [models, setModels] = useState(listModels)
  const refresh = () => setModels(listModels())

  const create = () => {
    const m = saveModel(newModel(`Model ${models.length + 1}`))
    void navigate({ to: '/model/$modelId', params: { modelId: m.id } })
  }

  return (
    <div className="ms-root">
      <header className="ms-toolbar">
        <div>
          <h1 className="ms-title">Modeling</h1>
          <p className="ms-lead">
            Author lineage models the Solidatus way — layers of systems, tables, and columns, with drag-drawn
            attribute mappings. Models are saved in this browser.
          </p>
        </div>
        <div className="ms-toolbar-actions">
          <button className="tbtn ms-primary" onClick={create}>+ New model</button>
        </div>
      </header>

      {models.length === 0 ? (
        <div className="ms-empty">
          <p className="ms-empty-title">No models yet</p>
          <p className="ms-empty-sub">Create a model to start authoring, or import a schema once inside.</p>
          <button className="tbtn ms-primary" onClick={create}>+ Create your first model</button>
        </div>
      ) : (
        <ul className="ms-model-grid">
          {models.map((m) => (
            <li key={m.id} className="ms-model-card">
              <button
                className="ms-model-open"
                onClick={() => void navigate({ to: '/model/$modelId', params: { modelId: m.id } })}
              >
                <span className="ms-model-title">{m.name}</span>
                <span className="ms-model-meta">
                  {TYPE_LABELS.filter(([t]) => m.typeCounts[t]).map(([t, label]) => `${m.typeCounts[t]} ${label}`).join(' · ') || 'empty'}
                  {m.edgeCount > 0 && ` · ${m.edgeCount} mappings`}
                </span>
                <span className="ms-model-date">
                  updated {new Date(m.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <div className="ms-model-actions">
                <button
                  className="tbtn"
                  onClick={() => {
                    duplicateModel(m.id)
                    refresh()
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="tbtn ms-danger"
                  onClick={() => {
                    if (confirm(`Delete model "${m.name}"? This cannot be undone.`)) {
                      deleteModel(m.id)
                      refresh()
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
