import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FreshnessIndicator from './FreshnessIndicator'

describe('FreshnessIndicator', () => {
  it('shows a relative time and the absolute ISO title when live with fetchedAt (TRUST-03)', () => {
    const now = Date.now()
    const fetchedAt = now - 3 * 60 * 1000
    render(<FreshnessIndicator source="live" fetchedAt={fetchedAt} />)

    const el = screen.getByText(/Refreshed .*ago/)
    expect(el.getAttribute('title')).toBe(new Date(fetchedAt).toISOString())
  })

  it('shows exactly the bundled-sample-data copy for source="sample", never a relative time or title', () => {
    render(<FreshnessIndicator source="sample" fetchedAt={Date.now()} />)

    const el = screen.getByText('Showing bundled sample data')
    expect(el.getAttribute('title')).toBeNull()
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
  })

  it('falls back to the sample-data copy when source="live" but fetchedAt is missing (E5 toolbar partial/empty)', () => {
    render(<FreshnessIndicator source="live" />)

    expect(screen.getByText('Showing bundled sample data')).toBeInTheDocument()
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Refreshed/)).not.toBeInTheDocument()
  })

  it('exposes the full-sentence aria-label for both honest states', () => {
    const fetchedAt = Date.now() - 3 * 60 * 1000
    const { unmount } = render(<FreshnessIndicator source="live" fetchedAt={fetchedAt} />)
    expect(screen.getByLabelText(/Lineage data refreshed .*ago/)).toBeInTheDocument()
    unmount()

    render(<FreshnessIndicator source="sample" />)
    expect(screen.getByLabelText('Lineage data showing bundled sample data')).toBeInTheDocument()
  })
})
