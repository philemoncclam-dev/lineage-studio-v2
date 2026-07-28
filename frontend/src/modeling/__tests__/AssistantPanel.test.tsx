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
  return {
    text: 'It reaches Gold.',
    trace: [],
    proposals: [],
    stop_reason: 'end_turn',
    ...over,
  }
}

function renderPanel(
  props: {
    onSelect?: (id: string) => void
    onApplyEdits?: (edits: unknown[]) => void
    onSetInstructions?: (text: string) => void
    instructions?: string
  } = {},
) {
  const onApplyEdits = props.onApplyEdits ?? vi.fn()
  const onSetInstructions = props.onSetInstructions ?? vi.fn()
  render(
    <AssistantPanel
      model={{ ...model(), assistantInstructions: props.instructions }}
      onSelect={props.onSelect ?? vi.fn()}
      onApplyEdits={onApplyEdits as never}
      onSetInstructions={onSetInstructions}
      onClose={vi.fn()}
    />,
  )
  return { onApplyEdits, onSetInstructions }
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
    renderPanel()
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
    renderPanel()
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
    renderPanel()
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
    renderPanel()
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
    renderPanel({ onSelect })
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
    renderPanel()
    const user = await ask('q')
    await user.click(await screen.findByRole('button', { name: /1 step/ }))

    expect(screen.getByText('“amount”')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Bronze \// })).toBeNull()
  })

  it('keeps the question in the transcript when the turn fails', async () => {
    // Retrying should not mean retyping.
    askAssistant.mockRejectedValue(new Error('backend is asleep'))
    renderPanel()
    await ask('where does amount go?')

    expect(await screen.findByText('backend is asleep')).toBeTruthy()
    expect(screen.getByText('where does amount go?')).toBeTruthy()
  })

  it('hides the composer and says why when the backend has no key', async () => {
    fetchChatStatus.mockResolvedValue({ configured: false, model: '' })
    renderPanel()

    await waitFor(() => expect(screen.queryByLabelText('Ask about this model')).toBeNull())
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeTruthy()
  })

  describe('proposed edits', () => {
    const edit = {
      kind: 'add_transition',
      describes: 'note has no lineage; bronze feeds gold here.',
      source_id: 'A1',
      target_id: 'A2',
      source_path: 'Bronze / orders / amount',
      target_path: 'Gold / ltv',
    }

    it('shows a proposal as pending rather than as work already done', async () => {
      // The panel, the assistant's own wording and the tool result all have to
      // agree that nothing has changed — a user misled by any one of them acts
      // on a model they think was edited.
      askAssistant.mockResolvedValue(answer({ text: 'I’d wire that up.', proposals: [edit] }))
      renderPanel()
      await ask('fix the gap')

      expect(await screen.findByText('not applied yet')).toBeTruthy()
      expect(screen.getByText('Bronze / orders / amount → Gold / ltv')).toBeTruthy()
      expect(screen.getByText(edit.describes)).toBeTruthy()
    })

    it('does not touch the model until Apply is pressed', async () => {
      askAssistant.mockResolvedValue(answer({ proposals: [edit] }))
      const { onApplyEdits } = renderPanel()
      await ask('fix it')

      await screen.findByText('not applied yet')
      expect(onApplyEdits).not.toHaveBeenCalled()
    })

    it('hands the edit up on Apply', async () => {
      askAssistant.mockResolvedValue(answer({ proposals: [edit] }))
      const { onApplyEdits } = renderPanel()
      const user = await ask('fix it')

      await user.click(await screen.findByRole('button', { name: 'Apply' }))
      expect(onApplyEdits).toHaveBeenCalledWith([edit])
    })

    it('removes a spent proposal rather than leaving its button live', async () => {
      // A second Apply is either a silent no-op or a duplicate edit.
      askAssistant.mockResolvedValue(answer({ proposals: [edit] }))
      renderPanel()
      const user = await ask('fix it')

      await user.click(await screen.findByRole('button', { name: 'Apply' }))
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
      expect(screen.queryByText('not applied yet')).toBeNull()
    })

    it('discards without applying anything', async () => {
      askAssistant.mockResolvedValue(answer({ proposals: [edit] }))
      const { onApplyEdits } = renderPanel()
      const user = await ask('fix it')

      await user.click(await screen.findByRole('button', { name: 'Discard' }))
      expect(onApplyEdits).not.toHaveBeenCalled()
      expect(screen.queryByText('not applied yet')).toBeNull()
    })

    it('applies a batch in one call so it is one undo step', async () => {
      const second = { ...edit, describes: 'and this one too', source_id: 'A2' }
      askAssistant.mockResolvedValue(answer({ proposals: [edit, second] }))
      const { onApplyEdits } = renderPanel()
      const user = await ask('fix them')

      await user.click(await screen.findByRole('button', { name: 'Apply all 2' }))
      expect(onApplyEdits).toHaveBeenCalledTimes(1)
      expect(onApplyEdits).toHaveBeenCalledWith([edit, second])
    })

    it('shows no proposal block on a read-only turn', async () => {
      renderPanel()
      await ask('just tell me')
      await screen.findByText('It reaches Gold.')
      expect(screen.queryByText(/Proposed change/)).toBeNull()
    })
  })

  describe('house rules', () => {
    it('saves on blur rather than on every keystroke', async () => {
      // One undo step per edit, and one persist — not one per character.
      const { onSetInstructions } = renderPanel()
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'House rules' }))

      const box = screen.getByLabelText(/How should the assistant answer/)
      await user.type(box, 'Be terse.')
      expect(onSetInstructions).not.toHaveBeenCalled()

      await user.tab()
      expect(onSetInstructions).toHaveBeenCalledExactlyOnceWith('Be terse.')
    })

    it('does not save when nothing changed', async () => {
      const { onSetInstructions } = renderPanel({ instructions: 'Be terse.' })
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'House rules' }))
      await user.click(screen.getByLabelText(/How should the assistant answer/))
      await user.tab()

      expect(onSetInstructions).not.toHaveBeenCalled()
    })

    it('shows existing rules when reopened', async () => {
      renderPanel({ instructions: 'Answer in British English.' })
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'House rules' }))

      expect(screen.getByDisplayValue('Answer in British English.')).toBeTruthy()
    })

    it('marks the toggle when rules are set', () => {
      renderPanel({ instructions: 'Be terse.' })
      expect(screen.getByRole('button', { name: 'House rules' }).textContent).toContain('•')
    })

    it('says plainly that rules cannot change what counts as a fact', async () => {
      // The backend enforces this; the UI has to promise the same thing, or
      // someone writes a rule expecting it to work and is quietly ignored.
      renderPanel()
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'House rules' }))

      expect(screen.getByText(/can’t change what the assistant treats/)).toBeTruthy()
    })
  })

  it('treats an unreachable status endpoint as unavailable, not as available', async () => {
    // Otherwise the panel offers a composer whose every submission 503s.
    fetchChatStatus.mockRejectedValue(new Error('network'))
    renderPanel()

    await waitFor(() => expect(screen.queryByLabelText('Ask about this model')).toBeNull())
  })
})
