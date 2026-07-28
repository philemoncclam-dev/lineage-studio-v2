// The Assistant dock, driven directly — no router, no canvas, no backend.
//
// The `api` module is mocked, so what these tests cover is the panel's own
// contract: that the whole conversation is replayed each turn (there is no
// server session), that a failed turn keeps the question, and — the two that
// matter most — that an untraced answer is visibly marked and that a trace step
// is a way back to the entity on the canvas.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantPanel } from '../AssistantPanel'
import type { LineageModel } from '../../model/types'

const { askAssistant, fetchChatStatus } = vi.hoisted(() => ({
  askAssistant: vi.fn(),
  fetchChatStatus: vi.fn(),
}))

vi.mock('../../api', () => ({ askAssistant, fetchChatStatus }))

function model(): LineageModel {
  return {
    id: 'm',
    name: 'Medallion',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      {
        id: 'L1',
        name: 'Bronze',
        objects: [
          {
            id: 'O1',
            name: 'orders',
            children: [
              {
                id: 'G1',
                name: 'money',
                children: [{ id: 'A1', name: 'amount', children: [] }],
              },
            ],
          },
        ],
      },
    ],
    transitions: [],
    properties: {},
  }
}

function answer(over: Partial<Record<string, unknown>> = {}) {
  return { text: 'It reaches Gold.', trace: [], stop_reason: 'end_turn', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchChatStatus.mockResolvedValue({ configured: true, model: 'claude-opus-5' })
  askAssistant.mockResolvedValue(answer())
})

async function ask(text: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Ask about this model'), text)
  await user.click(screen.getByRole('button', { name: 'Ask' }))
  return user
}

describe('AssistantPanel', () => {
  it('sends the model and the question, and shows the answer', async () => {
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)
    await ask('where does amount go?')

    await waitFor(() => expect(askAssistant).toHaveBeenCalled())
    const [sentModel, messages] = askAssistant.mock.calls[0]
    expect(sentModel).toMatchObject({ id: 'm' })
    expect(messages).toEqual([{ role: 'user', content: 'where does amount go?' }])
    expect(await screen.findByText('It reaches Gold.')).toBeTruthy()
  })

  it('replays the whole conversation on the next turn', async () => {
    // There is no server-side session — this array IS the memory, so a second
    // question sent alone would arrive with no context at all.
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)
    await ask('first')
    await screen.findByText('It reaches Gold.')
    await ask('and then?')

    await waitFor(() => expect(askAssistant).toHaveBeenCalledTimes(2))
    expect(askAssistant.mock.calls[1][1]).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'It reaches Gold.' },
      { role: 'user', content: 'and then?' },
    ])
  })

  it('marks an answer that no traversal backed', async () => {
    // The one failure mode where a wrong answer looks exactly like a right one:
    // the model replying from its system-prompt outline instead of the graph.
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)
    await ask('anything')
    expect(await screen.findByText('not checked against the model')).toBeTruthy()
  })

  it('shows the traversal steps with the walk’s own caveats', async () => {
    askAssistant.mockResolvedValue(
      answer({
        trace: [
          { name: 'trace_downstream', input: { entity_id: 'A1' }, result: '1 path · object level' },
        ],
      }),
    )
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)
    const user = await ask('trace it')

    expect(screen.queryByText('not checked against the model')).toBeNull()
    await user.click(await screen.findByRole('button', { name: /1 step/ }))
    // "object level" is what stops table-level lineage being read as
    // column-level — a bare "1 path" would hide it.
    expect(screen.getByText('1 path · object level')).toBeTruthy()
  })

  it('names a traced entity by its full path, including nested groups', async () => {
    // A group is an attribute with children, so a one-level walk would leave
    // A1 unnamed — and an unnamed step is one you cannot click through to.
    askAssistant.mockResolvedValue(
      answer({ trace: [{ name: 'trace_upstream', input: { entity_id: 'A1' }, result: 'ok' }] }),
    )
    const onSelect = vi.fn()
    render(<AssistantPanel model={model()} onSelect={onSelect} onClose={vi.fn()} />)
    const user = await ask('q')
    await user.click(await screen.findByRole('button', { name: /1 step/ }))

    const link = screen.getByRole('button', { name: 'Bronze / orders / money / amount' })
    await user.click(link)
    expect(onSelect).toHaveBeenCalledWith('A1')
  })

  it('does not offer an entity link for a step that names no entity', async () => {
    askAssistant.mockResolvedValue(
      answer({ trace: [{ name: 'find_entity', input: { name: 'amount' }, result: '1 match' }] }),
    )
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)
    const user = await ask('q')
    await user.click(await screen.findByRole('button', { name: /1 step/ }))

    expect(screen.getByText('“amount”')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Bronze \// })).toBeNull()
  })

  it('keeps the question in the transcript when the turn fails', async () => {
    // Retrying should not mean retyping.
    askAssistant.mockRejectedValue(new Error('backend is asleep'))
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)
    await ask('where does amount go?')

    expect(await screen.findByText('backend is asleep')).toBeTruthy()
    expect(screen.getByText('where does amount go?')).toBeTruthy()
  })

  it('hides the composer and says why when the backend has no key', async () => {
    fetchChatStatus.mockResolvedValue({ configured: false, model: '' })
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.queryByLabelText('Ask about this model')).toBeNull())
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeTruthy()
  })

  it('treats an unreachable status endpoint as unavailable, not as available', async () => {
    // Otherwise the panel offers a composer whose every submission 503s.
    fetchChatStatus.mockRejectedValue(new Error('network'))
    render(<AssistantPanel model={model()} onSelect={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.queryByLabelText('Ask about this model')).toBeNull())
  })
})
