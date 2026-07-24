// /fabric/definitions — hosts the DefinitionsImport overlay (rescued from the
// retired Purview mode). A table picker matches a catalog-backed table's
// columns against a spreadsheet of definitions.
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useModel } from '../../model'
import DefinitionsImport from '../../views/DefinitionsImport'
import '../../views/purview.css'

export const Route = createFileRoute('/fabric/definitions')({
  component: DefinitionsRoute,
})

// A table's id is its Purview GUID in the live model; sample ids are names
// with nothing to write to (mirrors the old PurviewPanel isGuid check).
const isGuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id)

function DefinitionsRoute() {
  const model = useModel()
  const [activeId, setActiveId] = useState<string | null>(null)
  const candidates = model.tables.filter((t) => isGuid(t.id))
  const active = candidates.find((t) => t.id === activeId)

  return (
    <div className="purview-page">
      <h1 className="page-title">Import column definitions</h1>
      {candidates.length === 0 ? (
        <p className="page-lead">
          No catalog-backed tables in the current graph — load the graph from Purview first.
        </p>
      ) : (
        <>
          <p className="page-lead">Pick a table to match its columns against a spreadsheet of definitions.</p>
          <ul className="purview-table-list">
            {candidates.map((t) => (
              <li key={t.id}>
                <button className="tbtn" onClick={() => setActiveId(t.id)}>
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {active && (
        <DefinitionsImport tableGuid={active.id} tableName={active.name} onClose={() => setActiveId(null)} />
      )}
    </div>
  )
}
