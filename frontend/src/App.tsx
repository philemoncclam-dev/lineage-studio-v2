import { useState } from 'react'
import LineageView from './views/LineageView'
import GraphView from './views/GraphView'
import './App.css'

type Mode = 'lineage' | 'graph'

export default function App() {
  const [mode, setMode] = useState<Mode>('graph')
  const [focusTable, setFocusTable] = useState<string | undefined>('clean')

  const openLineage = (tableId: string) => { setFocusTable(tableId); setMode('lineage') }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand"><span className="dot" /> Lineage Studio</div>
        <div className="seg">
          <button className={mode === 'lineage' ? 'on' : ''} onClick={() => setMode('lineage')}>Lineage</button>
          <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>Knowledge graph</button>
        </div>
        <div className="spacer" />
        <label className="search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
          <input placeholder="Search tables, columns…" />
        </label>
      </header>

      {mode === 'lineage' ? <LineageView focusTable={focusTable} /> : <GraphView onOpenLineage={openLineage} />}
    </div>
  )
}
