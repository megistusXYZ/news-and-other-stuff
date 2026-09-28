// The Your papers page's decisions, kept apart from the page so they can be
// tested: the page (observer.html) imports this from /assets/observer.js.
// Nothing here touches the DOM beyond what it is handed.

// Reading has begun once the paper is this far down.
const READING = 40
// Smaller moves than this, on a phone, are a thumb resting, not a direction.
const JITTER = 6

/**
 * How much of the header shows at scroll position y. At the top: all of it.
 * Reading on a desktop: a slim bar. On a phone the bar goes on the way down
 * and comes back on the way up; a jitter leaves it as it is (`now`).
 */
export function headState ({ y, lastY, phone, now }) {
  if (y < READING) return 'full'
  if (!phone) return 'slim'
  if (y > lastY + JITTER) return 'hidden'
  if (y < lastY - JITTER) return 'slim'
  return now === 'full' ? 'slim' : now
}

// One paper a day: each date's latest, newest first, as /api/editions lists them.
export function papersByDay (editions) {
  const byDate = new Map()
  for (const e of editions) if (!byDate.has(e.date)) byDate.set(e.date, e)
  return byDate
}

/**
 * The paper a day older (by = 1) or newer (by = -1) than the one being read:
 * that day's latest, past reprints and over days with no paper. null past
 * either end.
 */
export function stepIssue (editions, current, by) {
  const byDate = papersByDay(editions)
  const days = [...byDate.keys()]
  const at = days.indexOf(current.date)
  return at < 0 ? null : byDate.get(days[at + by]) || null
}

// An issue in the address is its date and code, e.g. 2026-09-27-2EE166.
const issueName = (e) => `${e.date}-${e.code}`

// The paper the address names, if this reader has it; otherwise null.
export function issueFromAddress (search, editions) {
  const named = new URLSearchParams(search).get('issue')
  return (named && editions.find((e) => issueName(e) === named)) || null
}

// The address for reading this paper: the rest kept, one issue named.
export function addressFor (search, edition) {
  const params = new URLSearchParams(search)
  params.set('issue', issueName(edition))
  return '?' + params.toString()
}

/**
 * While the Issues drawer is open, everything else on the page is inert:
 * Tab cannot wander behind it and a screen reader does not read the paper
 * underneath. Closing it gives the page back.
 */
export function shutBehind (open, parts, keep) {
  for (const part of parts) if (part !== keep) part.inert = open
}
