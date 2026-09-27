// The Brainstorm Observer connector's work, as plain functions: no MCP, no
// HTTP, no auth. The reader's Claude writes the page; this checks it exactly
// as the skill does and keeps it. Everything here is the skill's own code.

import { readFileSync } from 'node:fs'
import { resolve } from '../.claude/skills/nostr-observer/scripts/resolve.mjs'
import { check } from '../.claude/skills/nostr-observer/scripts/validate.mjs'
import { dress, loadAssets } from '../.claude/skills/nostr-observer/scripts/dress.mjs'

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
