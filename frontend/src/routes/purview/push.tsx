// /purview/push — honest placeholder (D-03). The real write path is Phase 5;
// 02-04 restyles this with the shell's tier-3 tokens, the copy below is
// already the locked Copywriting Contract text (02-UI-SPEC.md) so it doesn't
// need to change there.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/purview/push')({
  component: PushPlaceholder,
})

function PushPlaceholder() {
  return (
    <div className="purview-page">
      <h1 className="page-title">Push to Purview isn't built yet</h1>
      <p className="page-lead">
        Scope selection, preview, and confirmed writes ship in Phase 5. For now, explore lineage on the Graph and
        Lineage canvases to see what you'll push here.
      </p>
    </div>
  )
}
