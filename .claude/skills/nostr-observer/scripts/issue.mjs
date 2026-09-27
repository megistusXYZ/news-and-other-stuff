// The issue number, the way a paper numbers itself: Vol. for each year since
// the reader's first issue, No. for each day. Two dates in, nothing stored, so
// No. 3 always means the same morning, and a missed morning leaves a gap.

const DAY = 86400000

// A calendar date as 'YYYY-MM-DD', or null. Checked by round trip, so
// 2026-02-30 is not quietly March.
export function dayOf (text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [y, m, d] = text.split('-').map(Number)
  const at = Date.UTC(y, m - 1, d)
  return new Date(at).toISOString().slice(0, 10) === text ? { y, m, d, at } : null
}

function roman (n) {
  let out = ''
  for (const [value, mark] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
    while (n >= value) { out += mark; n -= value }
  }
  return out
}

export function issueOf (founded, date) {
  const first = dayOf(founded)
  const today = dayOf(date)
  if (!first || !today || today.at < first.at) return null
  const number = Math.round((today.at - first.at) / DAY) + 1
  const before = today.m < first.m || (today.m === first.m && today.d < first.d)
  const volume = today.y - first.y - (before ? 1 : 0) + 1
  return { volume, number, label: `Vol. ${roman(volume)} · No. ${number}` }
}

// The issues either side, for the folio's arrows: the nearest living copies
// of the same paper (the same name before the title's dash) on an earlier and
// a later date. `files` is [{ name, title }] from the editions folder.
export const LIVING = /^observer-(\d{4}-\d{2}-\d{2})-[0-9A-F]{6}\.living\.html$/
const paperOf = (title) => String(title || '').split(' — ')[0].trim()
const whenOf = (title) => String(title || '').split(' — ').slice(1).join(' — ').trim()

export function neighbours (files, self, title) {
  const at = LIVING.exec(self)
  if (!at) return { prev: null, next: null }
  const mine = paperOf(title)
  const issues = files
    .map((f) => ({ ...f, date: (LIVING.exec(f.name) || [])[1] }))
    .filter((f) => f.date && f.date !== at[1] && paperOf(f.title) === mine)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
  const step = (f) => (f ? { href: f.name, when: whenOf(f.title) } : null)
  return { prev: step(issues.filter((f) => f.date < at[1]).pop()), next: step(issues.find((f) => f.date > at[1])) }
}
