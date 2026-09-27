// Stop Press: the posts that arrived after the paper closed, edited the way a
// late-news column is. living.js carries these three functions byte for byte
// (test/press.test.mjs holds it to that), so each is self-contained.

// A post as it reads: no nostr: references, no links, whitespace closed up.
export function pressText (content) {
  return String(content || '').replace(/\[([^\]\n]+)\]\(https?:\/\/[^)\s]+\)/g, '$1').replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/nostr:[a-z0-9]+/gi, '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim()
    .replace(/(?:\s*#[\p{L}\p{N}_]+)+$/u, '').trim()
}

// The first sentence as the headline, the rest as its text. A first sentence
// that runs long is cut at a word, and the story carries on beneath it.
export function headlineOf (text) {
  const max = 90
  const first = /^(.+?[.!?])(?:\s+|$)/.exec(text)
  if (first && first[1].length <= max) return { headline: first[1], text: text.slice(first[0].length).trim() }
  if (text.length <= max) return { headline: text, text: '' }
  const word = text.slice(0, max - 1).lastIndexOf(' ')
  const at = word > 40 ? word : max - 1
  return { headline: text.slice(0, at).replace(/[\s,;:–—-]+$/, '') + '…', text: '…' + text.slice(at).trim() }
}

// Small talk (under five words), and replies the page cannot place (an e tag
// marked reply or root, or unmarked in the old positional way), are left out.
// One line per person, their latest, with how many they posted. The line with
// the most words leads; the rest are briefs, newest first, all of them (the
// page shows eight and folds the rest).
export function stopPress (events) {
  const words = (text) => text.split(' ').filter((w) => /\p{L}/u.test(w)).length
  const reply = (e) => (e.tags || []).some((t) => t[0] === 'e' && t[3] !== 'mention')
  const clip = (text, max) => {
    if (text.length <= max) return text
    const cut = text.slice(0, max - 1)
    const word = cut.lastIndexOf(' ')
    return (word > max / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:–—-]+$/, '') + '…'
  }
  const people = new Map()
  for (const e of [...events].sort((a, b) => b.created_at - a.created_at)) {
    const text = pressText(e.content)
    if (words(text) < 5 || reply(e)) continue
    const seen = people.get(e.pubkey)
    if (seen) seen.count += 1
    else people.set(e.pubkey, { event: e, text, count: 1 })
  }
  const lines = [...people.values()]
  if (!lines.length) return { lead: null, briefs: [], stories: 0 }
  const lead = lines.reduce((best, line) => (words(line.text) > words(best.text) ? line : best))
  const told = headlineOf(lead.text)
  return {
    lead: { event: lead.event, count: lead.count, headline: told.headline, text: clip(told.text, 280) },
    briefs: lines.filter((line) => line !== lead).map((line) => ({ event: line.event, count: line.count, text: clip(line.text, 160) })),
    stories: lines.length,
  }
}
