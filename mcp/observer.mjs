// The Brainstorm Observer connector's work, as plain functions: no MCP, no
// HTTP, no auth. The reader's Claude writes the page; this checks it exactly
// as the skill does and keeps it. Everything here is the skill's own code.

import { readFileSync } from 'node:fs'
import { resolve } from '../.claude/skills/nostr-observer/scripts/resolve.mjs'
import { check } from '../.claude/skills/nostr-observer/scripts/validate.mjs'
import { wireBalance } from '../.claude/skills/nostr-observer/scripts/layout.mjs'
import { dress, loadAssets } from '../.claude/skills/nostr-observer/scripts/dress.mjs'
import { digest, cleanTopics, cleanPaper } from '../.claude/skills/nostr-observer/scripts/corpus.mjs'
import { folioFacts } from './pages/observer.js'

const EDITORIAL = readFileSync(new URL('../.claude/skills/nostr-observer/reference/editorial.md', import.meta.url), 'utf8')
const HOUSE_CSS = readFileSync(new URL('../.claude/skills/nostr-observer/reference/house.css', import.meta.url), 'utf8')
const MAX_PAGE = 400_000
let assets = null

const dateOf = (corpus) => new Date(corpus.until * 1000).toISOString().slice(0, 10)
const refused = (kind, detail) => ({ accepted: false, violations: [{ kind, detail, excerpt: '' }] })

// How much of the day the page used, against what the digest held: said on
// acceptance, never a reason to refuse. A thin paper should be visible.
function fullness (page, corpus) {
  const sections = [...page.matchAll(/<section\b[^>]*\bclass="([^"]*)"/gi)].filter((m) => /\b(fold|band)\b/.test(m[1])).length
  const shortlist = new Set((corpus.art || []).map((a) => a.url))
  const pictures = new Set([...page.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]).filter((u) => shortlist.has(u))).size
  const desks = Object.entries(corpus.desks || {}).filter(([k, v]) => k !== 'topics' && v.length).length
  return { sections, pictures, desks, shortlist: shortlist.size }
}

// The writer does not type the stylesheet; the printer sets it, once.
function houseStyle (html) {
  if (/<style\b/i.test(html)) return html
  const style = `<style>\n${HOUSE_CSS}\n</style>`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}\n</head>`)
  return `${style}\n${html}`
}

export async function submitEdition ({ reader, code, html }, { store }) {
  const entry = store.corpusFor(String(code || ''))
  if (!entry || entry.reader !== reader) return refused('CODE', 'hand in a page for the digest you were given today, with its code')
  if (typeof html !== 'string' || !html.trim()) return refused('PAGE', 'the page is empty')
  if (html.length > MAX_PAGE) return refused('PAGE', `the page is ${html.length} characters; keep it under ${MAX_PAGE}`)

  const { corpus } = entry
  const { html: page, changes } = resolve(houseStyle(html), corpus)
  const { violations } = check(page, corpus)
  if (violations.length) return { accepted: false, violations, changes }

  assets = assets || loadAssets()
  const { html: living } = dress(page, corpus, assets)
  const date = dateOf(corpus)
  const record = { date, code: corpus.code, html: page, living, until: corpus.until, topics: (corpus.topics || []).map((t) => t.topic), fullness: fullness(page, corpus) }
  store.putEdition(reader, record)
  return { accepted: true, edition: corpus.code, date, changes, fullness: record.fullness }
}

// --- the tools --------------------------------------------------------------

// claude.ai cuts a tool result at 100,000 characters; a part leaves room for
// its two framing lines.
const PART = 90_000

const CONNECTOR_NOTE = `

---

## Printing through the Brainstorm Observer connector

You are printing with the connector's tools, not the command-line skill, so a
few steps differ from the brief above:

- Check the lens with get_readiness first. If it is not ready, stop and tell
  the reader what it says; never print a paper without their lens.
- Read the digest with get_digest, passing the reader's favourite topics as
  short phrases if they gave any. It comes in parts: read every part.
- Do not inline house.css and do not write a <style> block: the printer sets
  the house style. Everything else in the brief stands, including picture ids,
  citations and names in their writer forms, and quoting only what was said.
- Print the full paper the brief describes, the same paper the skill prints,
  not a summary of it: the fold, the reader's topics band, and a band or box
  for every desk and wire the digest gives you something worth printing
  from, with pictures from the shortlist. A thin page is a failure of the
  job even when it is accepted.
- Hand in the finished page with submit_edition: the edition code and the
  whole HTML. If it is refused, fix exactly what the reasons say and hand it
  in again, until it is accepted.
- The accepted paper appears on the reader's Observer page in Brainstorm.
  Tell the reader what led and anything the printer changed.
`

// Sent to the reader's Claude when it connects, so the routine is known before
// the reader's prompt says a word: a short prompt is then enough, and an
// unattended morning run still follows it.
export const INSTRUCTIONS = `You print the reader's daily newspaper, News and Other Stuff, from what the people they trust on Nostr said in the last 24 hours. Each time:
1. Call get_readiness. If the lens is not ready, stop and tell the reader exactly what it says to do. The first time, call get_paper too: if nothing is set, ask the reader where they live, which teams they follow and what they love reading about, and save it with set_paper.
2. Call get_brief once and follow it: it is the house style and the rules.
3. Call get_digest, passing the reader's favourite topics as short phrases if they named any, then fetch every part with the code it gives.
4. Write the full paper the brief describes: the fold, a "Your topics" band when there are topics, a band or box for every desk worth printing, pictures by id. Quote only words the posts contain.
5. Call submit_edition with the code and the whole page. If it is refused, fix exactly what each reason says and hand it in again until it is accepted.
6. Finish by telling the reader what led, anything the printer changed, and the link to today's paper.
If get_readiness says today's paper is already in, tell the reader and print a fresh edition only if they asked for one.`

// --- the reader's own paper ---------------------------------------------------

// What a reader (or their Claude) may set. The brand, stamps, imprint and The
// Tape are the host's, not the reader's; the founding date is set on first save.
const SWITCHES = ['almanac', 'cartoon', 'puzzle', 'five', 'recipe', 'picture', 'markets', 'world', 'sky', 'culture', 'tabloid', 'health', 'launches', 'feature']
const READER_KEYS = ['name', 'motto', 'place', 'units', 'teams', 'feeds', 'topics', 'country', ...SWITCHES]
const SWITCH_WORDS = { almanac: 'almanac', cartoon: 'cartoon', puzzle: 'sudoku', five: 'Five', recipe: 'recipe', picture: 'picture of the day', markets: 'markets', world: 'the world at a glance', sky: 'air and moon', culture: 'culture', tabloid: 'the Tabloid', health: 'health & safety', launches: 'launches', feature: 'the Feature' }

// A first save starts from the whole paper: every page on, and the house's
// world and culture headlines. "All of it, unless you say otherwise."
const HOUSE_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', section: 'Wider World' },
  { url: 'https://www.theguardian.com/world/rss', section: 'Wider World' },
  { url: 'https://feeds.npr.org/1001/rss.xml', section: 'Wider World' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', section: 'Wider World' },
  { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', section: 'Culture' },
  { url: 'https://variety.com/feed/', section: 'Culture' },
  { url: 'https://pitchfork.com/rss/news/', section: 'Culture' },
]
const WHOLE_PAPER = { ...Object.fromEntries(SWITCHES.map((k) => [k, true])), feeds: HOUSE_FEEDS }

// A cleaned paper, back in the plain shape a reader sets: only what is set.
function settingsOf (paper) {
  if (!paper) return {}
  const w = paper.wires || {}
  const out = {}
  if (paper.name) out.name = paper.name
  if (paper.motto) out.motto = paper.motto
  if (w.place) out.place = w.place
  if (w.units) out.units = w.units
  if (w.country) out.country = w.country
  if (w.teams && w.teams.length) out.teams = w.teams
  if (w.feeds && w.feeds.length) out.feeds = w.feeds
  for (const k of SWITCHES) if (w[k] === true) out[k] = true
  if (paper.topics && paper.topics.length) out.topics = paper.topics
  if (paper.founded) out.founded = paper.founded
  return out
}

function describePaper (s) {
  if (!s || !Object.keys(s).length) return 'No paper settings yet. Ask the reader where they live (a city or ZIP), which teams they follow and what they love reading about, then call set_paper.'
  const lines = [`Your paper${s.name ? `: ${s.name}` : ''}${s.founded ? ` · founded ${s.founded}` : ''}`]
  if (s.place) lines.push(`Place: ${s.place}${s.units ? ` (${s.units === 'us' ? '°F' : '°C'})` : ''}`)
  if (s.teams) lines.push(`Teams: ${s.teams.join(', ')}`)
  const pages = SWITCHES.filter((k) => s[k]).map((k) => SWITCH_WORDS[k])
  if (pages.length) lines.push(`Pages: ${pages.join(', ')}`)
  if (s.feeds) lines.push(`Feeds: ${s.feeds.length}`)
  if (s.topics) lines.push(`Topics: ${s.topics.join(', ')}`)
  lines.push('Change any of it with set_paper.')
  return lines.join('\n')
}

export const TOOLS = [
  {
    name: 'get_readiness',
    description: 'Check whether the signed-in reader\'s web-of-trust lens is ready. Call this first; if it is not ready, stop and tell the reader what it says to do.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_paper',
    description: 'The reader\'s own paper settings: their place for the weather, the teams they follow, the pages they want and their favourite topics. If there are none yet, ask the reader and call set_paper.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_paper',
    description: 'Set or change the reader\'s paper. Pass only what changes; everything else is kept. Use it when the reader says where they live, which teams they follow, what to add or drop, or what they love reading about.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 60, description: 'A name for the paper, if the reader wants one.' },
        place: { type: 'string', maxLength: 80, description: 'A city or a ZIP / postal code, for the weather.' },
        units: { type: 'string', enum: ['us', 'metric'], description: 'Fahrenheit (us) or Celsius (metric); leave unset to follow the place.' },
        teams: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 5, description: 'The whole list of teams, each as "Name (Sport)" when the name is shared, e.g. "Chicago Fire (Soccer)".' },
        topics: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 5, description: 'The whole list of favourite topics, as short phrases.' },
        ...Object.fromEntries(SWITCHES.map((k) => [k, { type: 'boolean', description: `Print ${SWITCH_WORDS[k]}.` }])),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_brief',
    description: 'The editorial brief: what a front page is, how to quote, cite and lay it out, and the few rules for printing through this connector. Read it before writing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_digest',
    description: 'The reader\'s last 24 hours, ranked by their web of trust: fourteen desks, the art shortlist, and their favourite topics, each searched through their lens. Returns part 1 and the edition code; ask for the other parts with the code.',
    inputSchema: {
      type: 'object',
      properties: {
        topics: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 5, description: 'The reader\'s favourite topics, as short phrases taken from what they asked for (e.g. "sourdough", "formula one").' },
        code: { type: 'string', description: 'The edition code from part 1, to ask for a later part.' },
        part: { type: 'integer', minimum: 1, description: 'Which part to return (with code).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_edition',
    description: 'Hand in the finished front page for today\'s edition. The printer checks every quote, picture and link against the digest, and the reader\'s topics band; it accepts the page for the reader\'s Observer page or refuses it with reasons to fix.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The edition code from get_digest.' },
        html: { type: 'string', description: 'The whole page, <!doctype html> to </html>, without a <style> block.' },
      },
      required: ['code', 'html'],
      additionalProperties: false,
    },
  },
]

// What to do about each kind of refusal, in the writer's terms.
const FIX = {
  QUOTE: 'quote only words the post contains, exactly as written (an ellipsis may join fragments of one post), or paraphrase without quote marks.',
  IMAGE: 'use a picture id from the art shortlist (src="art-N"), never a URL; drop the figure if no id fits.',
  LINK: 'cite a post as https://brainstorm.world/e/<event id from the digest> and a person as https://brainstorm.world/p/<one of their post ids>; use the watch:, listing: and calendar: lines exactly as the digest printed them; write any other address as plain text.',
  MARKUP: 'remove scripts, iframes, forms, event handlers and javascript: links; the printer adds everything interactive.',
  TOPICS: 'add <section class="band your-topics"> near the top with one cell per topic, citing at least one post listed under that topic in "Your topics: the posts".',
  MASTHEAD: 'set the paper\'s name from the digest\'s Masthead in the nameplate <h1> and at the start of the <title>.',
  FOLIO: 'make the folio\'s first span the digest\'s Issue: line, exactly.',
  LAYOUT: 'give the front page exactly one lead headline (class lead-head) inside <section class="fold">.',
  CODE: 'call get_digest for today first, then hand in the page with the code it gave you.',
  PAGE: 'hand in the whole page, <!doctype html> to </html>.',
}

const say = (text, extra = {}) => ({ content: [{ type: 'text', text }], ...extra })
const fail = (text) => say(text, { isError: true })

// Split at desk boundaries, then at items, so every part fits and the parts
// put back together into exactly the digest.
export function splitDigest (text, max = PART) {
  const pieces = []
  for (const section of text.split(/(?=\n## )/)) {
    if (section.length <= max) { pieces.push(section); continue }
    for (const item of section.split(/(?=\n- \[)/)) {
      for (let at = 0; at < item.length; at += max) pieces.push(item.slice(at, at + max))
    }
  }
  const parts = []
  for (const piece of pieces) {
    if (parts.length && parts[parts.length - 1].length + piece.length <= max) parts[parts.length - 1] += piece
    else parts.push(piece)
  }
  return parts
}

function partOf (code, parts, k, topics) {
  const n = parts.length
  const head = `Part ${k} of ${n} · edition code ${code}${topics && topics.length ? ` · topics: ${topics.join(', ')}` : ''}`
  const foot = k < n
    ? `(Part ${k} of ${n}. Next: call get_digest with code "${code}" and part ${k + 1}.)`
    : `(Part ${n} of ${n}: that is the whole digest. Write the page, then call submit_edition with code "${code}".)`
  return say(`${head}\n\n${parts[k - 1]}\n\n${foot}`, { structuredContent: { code, part: k, parts: n } })
}

const verdictText = (v) => (v.ready ? `READY\n${v.say || 'Your lens is ready.'}` : `NOT READY: ${v.state}\n${v.say}\nWhat to do: ${v.do}`)

/**
 * One tool call for the signed-in reader. `deps` is what the host provides:
 * the store, `readiness(reader)` and `pull(reader, { topics })`. The reader
 * comes from sign-in, never from the arguments.
 */
export async function callTool (name, args, reader, deps) {
  // The setup page's "connected" and its progress come from this: the reader's
  // Claude called, and this is where it got to.
  if (deps.store.touch) deps.store.touch(reader)
  const result = await runTool(name, args && typeof args === 'object' ? args : {}, reader, deps)
  if (deps.store.record && TOOLS.some((t) => t.name === name)) deps.store.record(reader, stepOf(name, result))
  return result
}

function stepOf (tool, result) {
  const s = result.structuredContent || {}
  if (tool === 'get_digest') return result.isError ? { tool, outcome: 'refused' } : { tool, part: s.part, parts: s.parts }
  if (tool === 'submit_edition') {
    if (!result.isError) return { tool, outcome: 'accepted', edition: s.edition, ...(s.url ? { url: s.url } : {}) }
    return { tool, outcome: 'refused', problems: (result.content[0].text.match(/^- /gm) || []).length }
  }
  return { tool }
}

async function runTool (name, args, reader, deps) {
  switch (name) {
    case 'get_readiness': {
      // Today's paper, by the same UTC date an edition is filed under.
      const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000)
      const today = new Date(now * 1000).toISOString().slice(0, 10)
      const done = deps.store.editions ? deps.store.editions(reader).find((e) => e.date === today) : null
      const stamp = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      return say(verdictText(await deps.readiness(reader)) + (done ? `\nToday's paper is already in: edition ${done.code}, printed ${stamp(done.printedAt)}. Print a fresh edition only if the reader asked for one.` : ''))
    }
    case 'get_paper': {
      const settings = deps.store.paperOf ? deps.store.paperOf(reader) : null
      return say(describePaper(settings), { structuredContent: settings || {} })
    }
    case 'set_paper': {
      const incoming = Object.fromEntries(Object.entries(args).filter(([k]) => READER_KEYS.includes(k)))
      if (!Object.keys(incoming).length) return fail('Nothing a reader can set was given. Set place, units, teams, topics, name or which pages to print.')
      const current = (deps.store.paperOf && deps.store.paperOf(reader)) || WHOLE_PAPER
      const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000)
      const founded = current.founded || new Date(now * 1000).toISOString().slice(0, 10)
      const settings = settingsOf(cleanPaper({ ...current, ...incoming, founded }))
      deps.store.savePaper(reader, settings)
      return say(`Saved.\n${describePaper(settings)}`, { structuredContent: settings })
    }
    case 'get_brief':
      return say(EDITORIAL + CONNECTOR_NOTE)
    case 'get_digest': {
      if (args.code) {
        const entry = deps.store.corpusFor(String(args.code))
        const parts = deps.store.digestParts(String(args.code))
        const k = Number(args.part) || 1
        if (!entry || entry.reader !== reader || !parts) return fail('No digest with that code for you today. Call get_digest with your topics to start.')
        if (k < 1 || k > parts.length) return fail(`That digest has ${parts.length} part(s).`)
        return partOf(entry.corpus.code, parts, k, (entry.corpus.topics || []).map((t) => t.topic))
      }
      const verdict = await deps.readiness(reader)
      if (!verdict.ready) return fail(`Your lens is not ready, so there is no paper today.\n${verdictText(verdict)}`)
      // The reader's own paper: its place, teams and pages, and its topics
      // unless the reader named others today. A reader who has saved nothing
      // gets the house paper, every page and no place, teams or topics: never
      // anyone else's. The host's defaults (its brand) sit under it.
      const settings = deps.store.paperOf ? deps.store.paperOf(reader) : null
      const paper = cleanPaper({ ...(deps.paperDefaults || {}), ...(settings || WHOLE_PAPER) })
      const named = cleanTopics(args.topics)
      const topics = named.length ? named : ((settings && settings.topics) || [])
      const corpus = await deps.pull(reader, { topics, paper })
      deps.store.keepCorpus(reader, corpus)
      const parts = splitDigest(digest(corpus))
      deps.store.keepDigest(corpus.code, parts)
      return partOf(corpus.code, parts, 1, topics)
    }
    case 'submit_edition': {
      const out = await submitEdition({ reader, code: args.code, html: args.html }, { store: deps.store })
      if (!out.accepted) {
        return fail('Refused. Fix these and hand it in again:\n' + out.violations.map((v) => `- ${v.kind}: ${v.detail}${v.excerpt ? `\n    ${v.excerpt}` : ''}${FIX[v.kind] ? `\n    How to fix: ${FIX[v.kind]}` : ''}`).join('\n'))
      }
      // Only what the reader should hear about: a picture dropped or a link
      // unwrapped. Resolving citations and names is the printer's job, not news.
      const worth = (out.changes || []).filter((c) => c.kind === 'dropped' || c.kind === 'unwrapped')
      const f = out.fullness
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
      const full = `\nThe page has ${plural(f.sections, 'section')} and ${plural(f.pictures, 'picture')}; the digest held ${plural(f.desks, 'desk')} with posts and ${plural(f.shortlist, 'picture')} on the shortlist.`
      const url = deps.paperUrl ? deps.paperUrl(reader, out.date, out.edition) : null
      // Advice for tomorrow's paper; today's is already kept.
      const layout = wireBalance(args.html)
      return say(`Accepted: edition ${out.edition} for ${out.date}, on the reader's Observer page.` + (url ? `\nRead it: ${url}` : '') + full + (worth.length ? `\nThe printer ${worth.map((c) => `${c.kind} ${c.detail || ''}`.trim()).slice(0, 8).join('; ')}.` : '') + (layout.length ? `\nLayout, for next time: ${layout.join(' ')}` : ''), { structuredContent: { edition: out.edition, date: out.date, ...(url ? { url } : {}), ...out.fullness } })
    }
    default:
      return fail(`No tool called ${name}.`)
  }
}

const plain = (html) => html.replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()

/**
 * What a reader recognises a paper by, read from the page as printed: its
 * issue ("Vol. I · No. 3", from the folio) and its lead headline, as plain
 * words. Either is null when the page does not carry it.
 */
export function paperFacts (html) {
  const page = String(html || '')
  const folio = /<div class="folio">([\s\S]*?)<\/div>/.exec(page)
  const spans = folio ? [...folio[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => plain(m[1])) : []
  const lead = /<h2 class="lead-head"[^>]*>([\s\S]*?)<\/h2>/.exec(page)
  return { issue: folioFacts(spans).issue, lead: lead ? plain(lead[1]).slice(0, 200) || null : null }
}
