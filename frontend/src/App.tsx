import { useEffect, useState } from 'react'
import LineageView from './views/LineageView'
import GraphView from './views/GraphView'
import SearchPalette, { type SearchResult } from './views/SearchPalette'
import './App.css'

type Mode = 'lineage' | 'graph'

export default function App() {
  const [mode, setMode] = useState<Mode>('graph')
  const [focusTable, setFocusTable] = useState<string | undefined>('clean')
  const [focusColumn, setFocusColumn] = useState<string | undefined>()
  const [searchOpen, setSearchOpen] = useState(false)

  const openLineage = (tableId: string, colKey?: string) => {
    setFocusTable(tableId)
    setFocusColumn(colKey)
    setMode('lineage')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSearchResult = (r: SearchResult) => {
    setSearchOpen(false)
    if (r.kind === 'table' && r.tableId) openLineage(r.tableId)
    else if (r.kind === 'column' && r.tableId) openLineage(r.tableId, r.colKey)
    else setMode('lineage') // notebooks + code live on the lineage canvas
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="seg">
          <button className={mode === 'lineage' ? 'on' : ''} onClick={() => setMode('lineage')}>Lineage</button>
          <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>Knowledge graph</button>
        </div>
        <div className="spacer" />
        <button className="search" onClick={() => setSearchOpen(true)}>
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
          <span className="ph">Search tables, columns, code…</span>
          <kbd>⌘K</kbd>
        </button>
      </header>

      {mode === 'lineage' ? <LineageView focusTable={focusTable} focusColumn={focusColumn} /> : <GraphView onOpenLineage={openLineage} />}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onResult={onSearchResult} />
    </div>
  )
}
