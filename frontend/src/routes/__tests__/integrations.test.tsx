// The integrations page. What matters is that an UNCONFIGURED service is the
// most useful row on the page, not the quietest one — it is the reason someone
// opened this — and that "configuration" is never mistaken for "health".
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { Integration } from '../../api'

const fetchIntegrations = vi.fn()
const fetchIdentity = vi.fn()
vi.mock('../../api', () => ({
  fetchIntegrations: () => fetchIntegrations(),
  fetchIdentity: () => fetchIdentity(),
}))

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
  fetchIdentity.mockReset()
  fetchIdentity.mockResolvedValue({
    mode: 'service-principal',
    client_id: 'da314ac2-2211-4969-837c-9f86778547c7',
    tenant_id: 't',
    display_name: 'Lineage-Studio-Dev',
    note: '',
  })
})

describe('the integrations page', () => {
  it('lists each service with the host it actually calls', async () => {
    fetchIntegrations.mockResolvedValue([item()])
    render(<Page />)
    expect(await screen.findByText('Power BI metadata scanner')).toBeInTheDocument()
    expect(screen.getByText('api.powerbi.com')).toBeInTheDocument()
  })

  it('says what is lost only for the ones not set up', async () => {
    const user = userEvent.setup()
    fetchIntegrations.mockResolvedValue([
      item(),
      item({ key: 'fabric', name: 'Fabric', configured: true, degrades: 'Nothing at all.' }),
    ])
    render(<Page />)
    await user.click(await screen.findByText('Power BI metadata scanner'))
    expect(await screen.findByText(/Reports are drawn without edges/)).toBeInTheDocument()

    await user.click(screen.getByText('Fabric'))
    // On a configured service, "what you'd lose" is noise.
    expect(screen.queryByText(/Nothing at all/)).not.toBeInTheDocument()
  })

  it('names the principal it calls as, so a grant can be aimed at it', async () => {
    fetchIntegrations.mockResolvedValue([item()])
    render(<Page />)
    expect(await screen.findByText('Lineage-Studio-Dev')).toBeInTheDocument()
    // The client id is what you paste into an access grant — never truncated.
    expect(screen.getByText('da314ac2-2211-4969-837c-9f86778547c7')).toBeInTheDocument()
  })

  it('says when there is no principal and calls run as the user', async () => {
    fetchIntegrations.mockResolvedValue([item()])
    fetchIdentity.mockResolvedValue({
      mode: 'user',
      client_id: '',
      tenant_id: '',
      display_name: '',
      note: 'no sp',
    })
    render(<Page />)
    expect(await screen.findByText(/the signed-in user/)).toBeInTheDocument()
  })

  it('still lists the services when the identity lookup fails', async () => {
    // The directory read is a separate grant and is often refused; the list is
    // the point of the page and must not wait on it.
    fetchIntegrations.mockResolvedValue([item()])
    fetchIdentity.mockRejectedValue(new Error('graph refused'))
    render(<Page />)
    expect(await screen.findByText('Power BI metadata scanner')).toBeInTheDocument()
  })

  it('keeps detail closed until a row is opened', async () => {
    fetchIntegrations.mockResolvedValue([item()])
    render(<Page />)
    await screen.findByText('Power BI metadata scanner')
    expect(screen.queryByText(/Semantic models and reports/)).not.toBeInTheDocument()
  })

  it('states configuration in words, not only colour', async () => {
    fetchIntegrations.mockResolvedValue([item(), item({ key: 'f', configured: true })])
    render(<Page />)
    expect(await screen.findByText('Not set up')).toBeInTheDocument()
    expect(screen.getByText('Configured')).toBeInTheDocument()
  })

  it('warns that this is not a health check', async () => {
    fetchIntegrations.mockResolvedValue([item()])
    render(<Page />)
    expect(await screen.findByText(/not a live health check/)).toBeInTheDocument()
  })

  it('shows caveats on a service that works but is limited', async () => {
    const user = userEvent.setup()
    fetchIntegrations.mockResolvedValue([
      item({ configured: true, caveats: ['Rate limited: 500 scans/hour.'] }),
    ])
    render(<Page />)
    await user.click(await screen.findByText('Power BI metadata scanner'))
    expect(await screen.findByText(/500 scans\/hour/)).toBeInTheDocument()
  })

  it('shows the error rather than an empty page when the fetch fails', async () => {
    fetchIntegrations.mockRejectedValue(new Error('backend unreachable'))
    render(<Page />)
    expect(await screen.findByText(/backend unreachable/)).toBeInTheDocument()
  })
})
