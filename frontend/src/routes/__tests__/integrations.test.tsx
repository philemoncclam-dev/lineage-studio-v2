// The integrations page. What matters is that an UNCONFIGURED service is the
// most useful row on the page, not the quietest one — it is the reason someone
// opened this — and that "configuration" is never mistaken for "health".
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { Integration } from '../../api'

const fetchIntegrations = vi.fn()
vi.mock('../../api', () => ({ fetchIntegrations: () => fetchIntegrations() }))

const { Route } = await import('../fabric/integrations')
// `JSX` is not a global namespace under the modern transform — the cold
// build catches this even though a warm incremental one does not.
const Page = Route.options.component as () => ReactElement

const item = (over: Partial<Integration> = {}): Integration => ({
  key: 'powerbi-scanner',
  name: 'Power BI metadata scanner',
  vendor: 'Microsoft',
  host: 'api.powerbi.com',
  configured: false,
  purpose: 'Semantic models and reports.',
  degrades: 'Reports are drawn without edges.',
  needs: 'A Fabric administrator.',
  detail: '',
  caveats: [],
  ...over,
})

beforeEach(() => {
  fetchIntegrations.mockReset()
})

describe('the integrations page', () => {
  it('lists each service with the host it actually calls', async () => {
    fetchIntegrations.mockResolvedValue([item()])
    render(<Page />)
    expect(await screen.findByText('Power BI metadata scanner')).toBeInTheDocument()
    expect(screen.getByText('api.powerbi.com')).toBeInTheDocument()
  })

  it('says what is lost only for the ones not set up', async () => {
    fetchIntegrations.mockResolvedValue([
      item(),
      item({ key: 'fabric', name: 'Fabric', configured: true, degrades: 'Nothing at all.' }),
    ])
    render(<Page />)
    expect(await screen.findByText(/Reports are drawn without edges/)).toBeInTheDocument()
    // On a configured service, "what you'd lose" is noise.
    expect(screen.queryByText(/Nothing at all/)).not.toBeInTheDocument()
  })

  it('states configuration in words, not only colour', async () => {
    fetchIntegrations.mockResolvedValue([item(), item({ key: 'f', configured: true })])
    render(<Page />)
    expect(await screen.findByText('Not configured')).toBeInTheDocument()
    expect(screen.getByText('Configured')).toBeInTheDocument()
  })

  it('warns that this is not a health check', async () => {
    fetchIntegrations.mockResolvedValue([item()])
    render(<Page />)
    expect(await screen.findByText(/not a live health check/)).toBeInTheDocument()
  })

  it('shows caveats on a service that works but is limited', async () => {
    fetchIntegrations.mockResolvedValue([
      item({ configured: true, caveats: ['Rate limited: 500 scans/hour.'] }),
    ])
    render(<Page />)
    expect(await screen.findByText(/500 scans\/hour/)).toBeInTheDocument()
  })

  it('shows the error rather than an empty page when the fetch fails', async () => {
    fetchIntegrations.mockRejectedValue(new Error('backend unreachable'))
    render(<Page />)
    expect(await screen.findByText(/backend unreachable/)).toBeInTheDocument()
  })
})
