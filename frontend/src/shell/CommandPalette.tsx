// cmdk Command.Dialog STUB (D-17, NAV-01/NAV-03). AppShell owns the open
// state (rail-bottom search trigger + the global Cmd+K keydown listener) and
// mounts this unconditionally; 02-06 fills in the real
// Command.Input/Command.List port of SearchPalette.tsx's ranking logic.
// Wrapping cmdk's Command.Dialog now (rather than a raw Radix Dialog) means
// 02-06 only adds content — the focus-trap/Esc/backdrop wiring is already
// correct via cmdk's own Radix-Dialog-backed implementation.
import { Command } from 'cmdk'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search"
      shouldFilter={false}
      overlayClassName="palette-overlay"
      contentClassName="palette-content"
      className="palette"
    >
      {/* 02-06 fills in Command.Input / Command.List here. */}
    </Command.Dialog>
  )
}
