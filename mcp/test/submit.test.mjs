// Handing in a front page: the reader's Claude writes it, the printer checks
// it exactly as the skill does (quotes, pictures, links, markup), adds the
// one check the connector exists to prove (the reader's topics were used),
// sets the house style, dresses the living copy and keeps both for the
// reader's Observer page. A refusal comes back with the checker's reasons, so
// the writer can fix the page and hand it in again.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submitEdition } from '../observer.mjs'
import { memoryStore } from '../store.mjs'

const READER = 'aa'.repeat(32)
const OTHER = 'cc'.repeat(32)
const ADA = 'bb'.repeat(32)
const note = { id: '1'.repeat(64), kind: 1, pubkey: ADA, created_at: 1790300000, content: 'The bread came out of the oven at noon.', tags: [] }
const bread = { id: '2'.repeat(64), kind: 1, pubkey: ADA, created_at: 1790300100, content: 'My sourdough finally rose.', tags: [] }
const corpusWith = (topics) => ({
  observer: READER, observerNpub: 'npub1reader', relay: 'wss://relay.test', floor: 20,
  since: 1790222949, until: 1790309349, code: 'ABC123', control: [], overlap: 0,
  profiles: { [ADA]: { name: 'Ada' } }, art: [], paper: null, wires: null, issue: null,
  desks: { notes: [note], ...(topics ? { topics: topics.flatMap((t) => t.events) } : {}) },
  ...(topics ? { topics } : {}),
})
const band = (id) => `<section class="your-topics"><h2>Your topics</h2><p>Sourdough: <q>My sourdough finally rose.</q> <a href="https://brainstorm.world/e/${id}">Read</a></p></section>`
const page = ({ quote = 'The bread came out of the oven at noon.', extra = '' } = {}) => '<!doctype html><html><head><title>The Nostr Observer — Sunday, September 27, 2026</title></head><body><main class="sheet">'
  + `<section class="fold"><article><h2 class="lead-head">Noon bread</h2><p>Ada: <q>${quote}</q> <a href="https://brainstorm.world/e/${note.id}">Read</a></p></article></section>${extra}</main></body></html>`

function given (topics) {
  const store = memoryStore()
  store.keepCorpus(READER, corpusWith(topics))
  return store
}

test('a clean page is accepted, set in the house style, dressed and kept for the reader\'s Observer page', async () => {
  const store = given(null)
  const out = await submitEdition({ reader: READER, code: 'ABC123', html: page() }, { store })
  assert.equal(out.accepted, true, JSON.stringify(out.violations))
  assert.equal(out.edition, 'ABC123')
  assert.equal(out.date, '2026-09-25')
  const kept = store.edition(READER, '2026-09-25')
  assert.match(kept.html, /<style>[\s\S]*--paper/, 'the house style, set by the printer, not typed by the writer')
  assert.match(kept.html, /href="https:\/\/brainstorm\.world\/e\/nevent1/, 'citations resolved, as the skill does')
  assert.match(kept.living, /id="observer-data"/, 'the living copy, dressed')
})

test('a quote nobody said is refused with the checker\'s reason, and nothing is kept', async () => {
  const store = given(null)
  const out = await submitEdition({ reader: READER, code: 'ABC123', html: page({ quote: 'The bread was the best in Europe.' }) }, { store })
  assert.equal(out.accepted, false)
  assert.deepEqual(out.violations.map((v) => v.kind), ['QUOTE'])
  assert.equal(store.edition(READER, '2026-09-25'), null)
})

test('given topics with posts, the page must carry a "Your topics" band citing one of them', async () => {
  const topics = [{ topic: 'sourdough', events: [bread] }, { topic: 'formula one', events: [] }]
  const missing = await submitEdition({ reader: READER, code: 'ABC123', html: page() }, { store: given(topics) })
  assert.deepEqual(missing.violations.map((v) => v.kind), ['TOPICS'])

  const citesTheWrongPost = await submitEdition({ reader: READER, code: 'ABC123', html: page({ extra: band(note.id).replace('<q>My sourdough finally rose.</q> ', '') }) }, { store: given(topics) })
  assert.deepEqual(citesTheWrongPost.violations.map((v) => v.kind), ['TOPICS'], 'a band that cites no topic post is not the band')

  const ok = await submitEdition({ reader: READER, code: 'ABC123', html: page({ extra: band(bread.id) }) }, { store: given(topics) })
  assert.equal(ok.accepted, true, JSON.stringify(ok.violations))
})

test('topics that were all quiet need no band', async () => {
  const out = await submitEdition({ reader: READER, code: 'ABC123', html: page() }, { store: given([{ topic: 'formula one', events: [] }]) })
  assert.equal(out.accepted, true, JSON.stringify(out.violations))
})

test('a reader can hand in a page only for a digest they were given', async () => {
  const store = given(null)
  const theirs = await submitEdition({ reader: OTHER, code: 'ABC123', html: page() }, { store })
  assert.deepEqual(theirs.violations.map((v) => v.kind), ['CODE'])
  const unknown = await submitEdition({ reader: READER, code: 'ZZZ999', html: page() }, { store })
  assert.deepEqual(unknown.violations.map((v) => v.kind), ['CODE'])
})

test('a file store keeps each accepted edition and its living copy on disk, by reader and date', async () => {
  const { fileStore } = await import('../store.mjs')
  const { mkdtempSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'editions-'))
  const store = fileStore(dir)
  store.keepCorpus(READER, corpusWith(null))
  const out = await submitEdition({ reader: READER, code: 'ABC123', html: page() }, { store })
  assert.equal(out.accepted, true)
  assert.deepEqual(readdirSync(join(dir, READER.slice(0, 16))).sort(), ['2026-09-25-ABC123.html', '2026-09-25-ABC123.json', '2026-09-25-ABC123.living.html'])
  assert.equal(store.edition(READER, '2026-09-25').code, 'ABC123')
  const restarted = fileStore(dir)
  assert.match(restarted.edition(READER, '2026-09-25', 'ABC123').living, /id="observer-data"/, 'what is on disk survives a restart')
})
