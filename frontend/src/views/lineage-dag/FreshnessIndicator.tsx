// TRUST-03's honest "last refreshed" signal (03-UI-SPEC.md "Freshness
// Indicator") — lives in the new lineage-toolbar strip (plan 03-07),
// right-aligned. Two mutually-exclusive states, never a third:
//   - live + fetchedAt set  -> "Refreshed {relative} ago" (Intl.RelativeTimeFormat),
//     title = the absolute ISO timestamp
//   - sample, OR live with no fetchedAt yet -> "Showing bundled sample data",
//     no relative time, no misleading title (T-03-09 mitigation — never
//     fabricate a refresh time for data that was never actually fetched)
//
// Styling: text-micro / --color-text-tertiary, a 14px inline stroke-based
// clock icon preceding the text (same inline-SVG convention as Inspector.tsx's
// DirArrow) — no raw hex, tier-2 tokens only.

const SAMPLE_DATA_COPY = 'Showing bundled sample data'

export interface FreshnessIndicatorProps {
  source: 'live' | 'sample'
  fetchedAt?: number
}

function relativeTimeAgo(fetchedAt: number, now: number): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const diffSec = Math.round((fetchedAt - now) / 1000)
  const absSec = Math.abs(diffSec)
  if (absSec < 60) return rtf.format(diffSec, 'second')
  const diffMin = Math.round(diffSec / 60)
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  const diffHour = Math.round(diffMin / 60)
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour')
  const diffDay = Math.round(diffHour / 24)
  return rtf.format(diffDay, 'day')
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.8"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}

export default function FreshnessIndicator({ source, fetchedAt }: FreshnessIndicatorProps) {
  const isLive = source === 'live' && fetchedAt != null

  if (!isLive) {
    return (
      <span
        className="freshness-indicator"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-1)',
          fontSize: 'var(--text-micro)', color: 'var(--color-text-tertiary)',
        }}
        aria-label={`Lineage data ${SAMPLE_DATA_COPY.toLowerCase()}`}
      >
        <ClockIcon />
        {SAMPLE_DATA_COPY}
      </span>
    )
  }

  // relativeTimeAgo already yields the full "{N} {unit} ago" phrase (or
  // "in {N} {unit}" for a future timestamp, which can't happen for a real
  // fetch but is handled the same honest way regardless).
  const relative = relativeTimeAgo(fetchedAt, Date.now())
  const absoluteIso = new Date(fetchedAt).toISOString()

  return (
    <span
      className="freshness-indicator"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-1)',
        fontSize: 'var(--text-micro)', color: 'var(--color-text-tertiary)',
      }}
      title={absoluteIso}
      aria-label={`Lineage data refreshed ${relative}`}
    >
      <ClockIcon />
      {`Refreshed ${relative}`}
    </span>
  )
}
