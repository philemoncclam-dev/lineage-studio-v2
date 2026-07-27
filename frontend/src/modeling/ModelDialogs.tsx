// The Model Browser's four modal flows. Split out of ModelBrowser so the page
// file stays about the list, and because all four share one shell and one set
// of dismissal rules.
//
// The styling is self-contained in modelBrowser.css. An earlier version reused
// the viewer's `.imp-*` classes, which live in modeling.css — a file only
// ModelViewer imports. On this page they resolved to nothing and every dialog
// rendered as unstyled markup in the bottom-left corner. Do not reach across
// into another view's stylesheet for a skin.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { normalizeTags } from '../model/store'

// ===== Shared shell =====

interface ShellProps {
  title: string
  label: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}

function DialogShell({ title, label, onClose, children, footer }: ShellProps) {
  // Escape closes from anywhere in the dialog, including the backdrop. Bound on
  // the window rather than the panel so it works before anything is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="mb-backdrop" onMouseDown={onClose}>
      <div
        className="mb-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <header className="mb-dialog-head">
          <h2 className="mb-dialog-title">{title}</h2>
          <button className="mb-dialog-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="mb-dialog-body">{children}</div>
        <footer className="mb-dialog-foot">{footer}</footer>
      </div>
    </div>
  )
}

/** Focuses on mount and selects, so an existing name can be typed straight over. */
function useAutoFocus() {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return ref
}

// ===== Name + description =====

interface DetailsDialogProps {
  title: string
  submitLabel: string
  initialName?: string
  initialDescription?: string
  onSubmit: (name: string, description: string) => void
  onClose: () => void
}

/** Backs both "Create a model" and "Rename" — the same two fields either way. */
export function DetailsDialog({
  title,
  submitLabel,
  initialName = '',
  initialDescription = '',
  onSubmit,
  onClose,
}: DetailsDialogProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const nameRef = useAutoFocus()
  const nameId = useId()
  const descId = useId()

  const trimmed = name.trim()
  const submit = () => {
    if (!trimmed) return
    onSubmit(trimmed, description.trim())
  }

  return (
    <DialogShell
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          <button className="mb-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="mb-btn primary" onClick={submit} disabled={!trimmed}>
            {submitLabel}
          </button>
        </>
      }
    >
      <label className="mb-field-label" htmlFor={nameId}>
        Name
      </label>
      <input
        id={nameId}
        ref={nameRef}
        className="mb-input"
        value={name}
        placeholder="Mortgage lineage"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      <label className="mb-field-label" htmlFor={descId}>
        Description <span className="mb-optional">optional</span>
      </label>
      <textarea
        id={descId}
        className="mb-input mb-textarea"
        value={description}
        rows={3}
        placeholder="What this model covers."
        onChange={(e) => setDescription(e.target.value)}
      />
    </DialogShell>
  )
}

// ===== Tags =====

interface TagDialogProps {
  /** Pre-filled for a single model; empty when tagging a multi-model selection. */
  initialTags: string[]
  /** Names of the models being tagged — the header says so explicitly for bulk. */
  subject: string
  /** Every tag already in use, offered as one-click suggestions. */
  suggestions: string[]
  /** True when editing several models, which REPLACES rather than merges. */
  bulk: boolean
  onSubmit: (tags: string[]) => void
  onClose: () => void
}

export function TagDialog({
  initialTags,
  subject,
  suggestions,
  bulk,
  onSubmit,
  onClose,
}: TagDialogProps) {
  const [tags, setTags] = useState<string[]>(initialTags)
  const [draft, setDraft] = useState('')
  const inputRef = useAutoFocus()

  const add = (raw: string) => {
    const next = normalizeTags([...tags, raw])
    setTags(next)
    setDraft('')
  }
  const remove = (tag: string) => setTags(tags.filter((t) => t !== tag))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter and comma both commit — people type tag lists both ways.
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) add(draft)
    } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
      // Backspace on an empty box deletes the last chip, as every tag input does.
      remove(tags[tags.length - 1])
    }
  }

  const unused = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))

  return (
    <DialogShell
      title="Edit tags"
      label="Edit tags"
      onClose={onClose}
      footer={
        <>
          <button className="mb-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="mb-btn primary"
            // Commit whatever is still in the box, so a typed-but-unconfirmed
            // tag isn't silently thrown away by clicking Save.
            onClick={() => onSubmit(draft.trim() ? normalizeTags([...tags, draft]) : tags)}
          >
            Save
          </button>
        </>
      }
    >
      <p className="mb-lede">{subject}</p>
      {bulk && (
        <p className="mb-warn">
          These tags <strong>replace</strong> the existing tags on every selected model.
        </p>
      )}

      <div className="mb-tag-input" onClick={() => inputRef.current?.focus()}>
        {tags.map((tag) => (
          <span className="mb-chip" key={tag}>
            {tag}
            <button className="mb-chip-x" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="mb-tag-entry"
          value={draft}
          placeholder={tags.length ? '' : 'Type a tag, then Enter'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Add a tag"
        />
      </div>

      {unused.length > 0 && (
        <>
          <p className="mb-field-label">Already in use</p>
          <div className="mb-suggestions">
            {unused.map((tag) => (
              <button className="mb-chip ghost" key={tag} onClick={() => add(tag)}>
                + {tag}
              </button>
            ))}
          </div>
        </>
      )}
    </DialogShell>
  )
}

// ===== Confirm =====

interface ConfirmDialogProps {
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <DialogShell
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          <button className="mb-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="mb-btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {body}
    </DialogShell>
  )
}
