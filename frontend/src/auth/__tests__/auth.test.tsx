// What sign-in has to guarantee, independent of Entra ID being reachable.
//
// No live MSAL here — the module is mocked. What is under test is our own
// behaviour around it: that the gate does not flash, that an unconfigured
// build explains itself instead of dead-ending, and that a request carries the
// caller's identity only when there is one to carry.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMsal, isConfigured } = vi.hoisted(() => ({
  mockMsal: {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    getActiveAccount: vi.fn().mockReturnValue(null),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    logoutRedirect: vi.fn().mockResolvedValue(undefined),
    acquireTokenSilent: vi.fn(),
    acquireTokenPopup: vi.fn(),
  },
  isConfigured: { value: true },
}))

vi.mock('../msal', async () => {
  const actual = await vi.importActual<typeof import('../msal')>('../msal')
  return {
    ...actual,
    msal: mockMsal,
    redirectUri: 'http://localhost:5173',
    get isConfigured() {
      return isConfigured.value
    },
  }
})

import { AuthProvider, useAuth } from '../auth'
import { LoginPage } from '../LoginPage'
import { fabricFetch, setTokenSource } from '../../api'

function Gate() {
  const { phase } = useAuth()
  if (phase === 'starting') return <div>starting</div>
  if (phase === 'signed-out') return <LoginPage />
  return <div>the app</div>
}

function renderGate() {
  return render(
    <AuthProvider>
      <Gate />
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  setTokenSource(null)
  isConfigured.value = true
  mockMsal.initialize.mockResolvedValue(undefined)
  mockMsal.handleRedirectPromise.mockResolvedValue(null)
  mockMsal.getAllAccounts.mockReturnValue([])
  mockMsal.getActiveAccount.mockReturnValue(null)
})

describe('the sign-in gate', () => {
  it('shows sign-in when nobody is signed in', async () => {
    renderGate()
    expect(await screen.findByRole('button', { name: /sign in with microsoft/i })).toBeTruthy()
    expect(screen.queryByText('the app')).toBeNull()
  })

  it('lets a returning user straight through without flashing the gate', async () => {
    // handleRedirectPromise resolves asynchronously, so treating that instant
    // as signed-out would show the sign-in screen to somebody who just signed
    // in. `starting` exists to prevent exactly that.
    const account = { name: 'Ada Lovelace', username: 'ada@contoso.com' }
    mockMsal.handleRedirectPromise.mockResolvedValue({ account })

    renderGate()
    expect(screen.getByText('starting')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /sign in with microsoft/i })).toBeNull()
    expect(await screen.findByText('the app')).toBeTruthy()
    expect(mockMsal.setActiveAccount).toHaveBeenCalledWith(account)
  })

  it('picks up an existing session on a plain reload', async () => {
    mockMsal.getAllAccounts.mockReturnValue([{ name: 'Ada', username: 'ada@contoso.com' }])
    renderGate()
    expect(await screen.findByText('the app')).toBeTruthy()
  })

  it('asks for the Fabric scope at sign-in, not just a profile', async () => {
    // Without the delegated Fabric scope the token cannot read Fabric, and the
    // failure lands much later as an opaque 401 on the workspace list.
    renderGate()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /sign in with microsoft/i }))

    await waitFor(() => expect(mockMsal.loginRedirect).toHaveBeenCalled())
    const { scopes } = mockMsal.loginRedirect.mock.calls[0][0]
    expect(scopes).toContain('https://api.fabric.microsoft.com/Workspace.Read.All')
  })

  it('shows the gate rather than a blank page when MSAL itself fails', async () => {
    mockMsal.initialize.mockRejectedValue(new Error('authority unreachable'))
    renderGate()
    expect(await screen.findByRole('alert')).toHaveTextContent('authority unreachable')
  })
})

describe('an unconfigured build', () => {
  beforeEach(() => {
    isConfigured.value = false
  })

  it('explains the setup instead of offering a dead button', async () => {
    renderGate()
    expect(await screen.findByText(/isn't configured/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /sign in with microsoft/i })).toBeNull()
    // The redirect URI is quoted because a mismatch fails at Microsoft before
    // any of our code runs, and the error there names nothing useful.
    expect(screen.getByText('http://localhost:5173')).toBeTruthy()
  })

  it('names whose workspaces you get if you continue without signing in', async () => {
    // The dangerous reading of the fallback is "these are my workspaces". They
    // are the service principal's, and the screen has to say so.
    renderGate()
    await screen.findByText(/isn't configured/i)
    expect(screen.getByText(/service principal/i)).toBeTruthy()
  })

  it('does not re-ask after a deliberate skip', async () => {
    renderGate()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /continue without signing in/i }))
    expect(await screen.findByText('the app')).toBeTruthy()

    renderGate()
    expect(await screen.findAllByText('the app')).toHaveLength(2)
  })
})

describe('carrying identity to the backend', () => {
  it('sends no Authorization header when nobody is signed in', async () => {
    // Not a detail: the backend reads a missing header as "use the service
    // principal", so a stale or empty header would break that fallback.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'))
    await fabricFetch('http://api.test/fabric/workspaces')

    const init = fetchSpy.mock.calls[0][1] as RequestInit | undefined
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    fetchSpy.mockRestore()
  })

  it('sends the bearer token when there is one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'))
    setTokenSource(async () => ({ fabric: 'tok-123', onelake: 'lake-456' }))
    await fabricFetch('http://api.test/fabric/workspaces')

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-123')
    // OneLake is a different audience and rides in its own header.
    expect(new Headers(init.headers).get('X-OneLake-Authorization')).toBe('Bearer lake-456')
    fetchSpy.mockRestore()
  })

  it('falls back to an unauthenticated call when the token cannot be renewed', async () => {
    // An expired session should degrade to the service principal rather than
    // send `Bearer null` and turn a readable tree into a 401.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'))
    setTokenSource(async () => ({ fabric: null, onelake: null }))
    await fabricFetch('http://api.test/fabric/workspaces')

    const init = fetchSpy.mock.calls[0][1] as RequestInit | undefined
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    fetchSpy.mockRestore()
  })
})
