import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as Tooltip from '@radix-ui/react-tooltip'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, className, children }: { to: string; className?: string; children?: React.ReactNode }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useRouterState: (opts: { select: (s: { location: { pathname: string } } ) => unknown }) =>
    opts.select({ location: { pathname: '/graph' } }),
}))

import Rail from '../Rail'
import type { RailItem } from '../railConfig'

function renderRail(items: RailItem[]) {
  return render(
    <Tooltip.Provider>
      <Rail items={items} />
    </Tooltip.Provider>,
  )
}

describe('Rail (SHELL-01)', () => {
  it('renders exactly N buttons for an N-entry config (three graph-mode items)', () => {
    const items: RailItem[] = [
      { key: 'drill-scope', label: 'Drill scope', icon: 'scope', to: '/graph' },
      { key: 'filters', label: 'Filters', icon: 'filter', to: '/graph' },
      { key: 'layout', label: 'Layout', icon: 'layout', to: '/graph' },
    ]
    renderRail(items)
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('each rail item carries its locked accessible name', () => {
    const items: RailItem[] = [
      { key: 'push', label: 'Push to Purview', icon: 'push', to: '/purview/push' },
      { key: 'definitions', label: 'Definitions import', icon: 'definitions', to: '/purview/definitions' },
      { key: 'data-products', label: 'Data products', icon: 'products', to: '/purview/data-products' },
    ]
    renderRail(items)
    expect(screen.getByRole('link', { name: 'Push to Purview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Definitions import' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Data products' })).toBeInTheDocument()
  })

  it('renders a single item for a one-destination mode (empty edge / D-05)', () => {
    const items: RailItem[] = [{ key: 'only', label: 'Only destination', icon: 'scope', to: '/graph' }]
    renderRail(items)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('two config entries never merge — N entries always produce N buttons in declared order', () => {
    const items: RailItem[] = [
      { key: 'a', label: 'Alpha', icon: 'scope', to: '/graph' },
      { key: 'b', label: 'Beta', icon: 'filter', to: '/graph' },
    ]
    renderRail(items)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links.map((l) => l.textContent)).toEqual(['Alpha', 'Beta'])
  })
})
