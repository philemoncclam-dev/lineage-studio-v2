// element-id-safe short ids: 'table.raw_orders' -> 'raw_orders', 'notebook.x' -> 'nb_x'
// Shared by lineageLayout.ts, graphLayout.ts, and adapt.ts so none of them
// re-derive this mapping independently.
//
// WR-03 fix (v2, injective): the earlier `.replace(/\./g,'__').replace(/[^\w-]/g,'_')`
// was NOT collision-free — it only disambiguated the one originally-reported pair.
// A literal '__' still collided with an encoded interior '.' ('raw.orders' and
// 'raw__orders' both -> 'raw__orders'), and any two distinct punctuation characters
// still collapsed onto a shared '_' ('raw/orders' and 'raw_orders' both -> 'raw_orders').
// This encoding is provably injective: every character outside [A-Za-z0-9_] — which
// includes '.', '/', and '-' itself — is escaped to '-' plus its fixed-width (4-digit)
// hex UTF-16 code unit. '_' and alphanumerics pass through unchanged, so every fixture
// id without special characters is byte-for-byte stable ('raw_orders' -> 'raw_orders').
// Because literal '-' is itself escaped ('-' -> '-002d'), a '-' in the output can only
// ever begin a fixed-width escape; decoding is therefore unambiguous, so distinct raw
// ids can never produce the same short id. Output stays DOM-id/CSS-selector safe
// ([A-Za-z0-9_-] only).
const sanitize = (s: string) =>
  s.replace(/[^A-Za-z0-9_]/g, (c) => '-' + c.charCodeAt(0).toString(16).padStart(4, '0'))

export const tid = (id: string) => sanitize(id.replace(/^table\./, ''))
export const nid = (id: string) => 'nb_' + sanitize(id.replace(/^notebook\./, ''))
