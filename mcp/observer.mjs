// The Brainstorm Observer connector's work, as plain functions: no MCP, no
// HTTP, no auth. The reader's Claude writes the page; this checks it exactly
// as the skill does and keeps it. Everything here is the skill's own code.

import { readFileSync } from 'node:fs'
import { resolve } from '../.claude/skills/nostr-observer/scripts/resolve.mjs'
import { check } from '../.claude/skills/nostr-observer/scripts/validate.mjs'
import { dress, loadAssets } from '../.claude/skills/nostr-observer/scripts/dress.mjs'
import { digest, cleanTopics } from '../.claude/skills/nostr-observer/scripts/corpus.mjs'

const EDITORIAL = readFileSync(new URL('../.claude/skills/nostr-observer/reference/editorial.md', import.meta.url), 'utf8')
const HOUSE_CSS = readFileSync(new URL('../.claude/skills/nostr-observer/reference/house.css', import.meta.url), 'utf8')
const MAX_PAGE = 400_000
let assets = null

const dateOf = (corpus) => new Date(corpus.until * 1000).toISOString().slice(0, 10)
const refused = (kind, detail) => ({ accepted: false, violations: [{ kind, detail, excerpt: '' }] })

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
  store.putEdition(reader, { date, code: corpus.code, html: page, living })
  return { accepted: true, edition: corpus.code, date, changes }
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
- Hand in the finished page with submit_edition: the edition code and the
  whole HTML. If it is refused, fix exactly what the reasons say and hand it
  in again, until it is accepted.
- The accepted paper appears on the reader's Observer page in Brainstorm.
  Tell the reader what led and anything the printer changed.
`

export const TOOLS = [
  {
    name: 'get_readiness',
    description: 'Check whether the signed-in reader\'s web-of-trust lens is ready. Call this first; if it is not ready, stop and tell the reader what it says to do.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
  args = args && typeof args === 'object' ? args : {}
  switch (name) {
    case 'get_readiness':
      return say(verdictText(await deps.readiness(reader)))
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
      const topics = cleanTopics(args.topics)
      const corpus = await deps.pull(reader, { topics })
      deps.store.keepCorpus(reader, corpus)
      const parts = splitDigest(digest(corpus))
      deps.store.keepDigest(corpus.code, parts)
      return partOf(corpus.code, parts, 1, topics)
    }
    case 'submit_edition': {
      const out = await submitEdition({ reader, code: args.code, html: args.html }, { store: deps.store })
      if (!out.accepted) {
        return fail('Refused. Fix these and hand it in again:\n' + out.violations.map((v) => `- ${v.kind}: ${v.detail}${v.excerpt ? `\n    ${v.excerpt}` : ''}`).join('\n'))
      }
      const changed = (out.changes || []).filter((c) => !['resolved', 'feature', 'credit'].includes(c.kind))
      return say(`Accepted: edition ${out.edition} for ${out.date}, on the reader's Observer page.` + (changed.length ? `\nThe printer changed ${changed.length} thing(s): ${changed.slice(0, 8).map((c) => c.detail || c.kind).join('; ')}` : ''), { structuredContent: { edition: out.edition, date: out.date } })
    }
    default:
      return fail(`No tool called ${name}.`)
  }
}
