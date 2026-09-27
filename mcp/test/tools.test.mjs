// The connector's tools, as the reader's Claude sees them: get_readiness,
// get_brief, get_digest and submit_edition. Everything a tool says fits in
// one tool result (claude.ai cuts at 100,000 characters); the reader is always
// the signed-in one, never an argument; and no digest is ever pulled through a
// lens that is not ready.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { callTool, TOOLS } from '../observer.mjs'
import { memoryStore } from '../store.mjs'
import { digest } from '../../.claude/skills/nostr-observer/scripts/corpus.mjs'

const READER = 'aa'.repeat(32)
const ADA = 'bb'.repeat(32)
const LIMIT = 100_000

// A busy day: enough notes that the digest runs past one tool result.
function busyCorpus (topics) {
  const notes = Array.from({ length: 420 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), kind: 1, pubkey: ADA, created_at: 1790300000 - i, content: `Note ${i}: ` + 'a thought worth reading, '.repeat(24), tags: [] }))
  return { observer: READER, observerNpub: 'npub1reader', relay: 'wss://relay.test', floor: 20, since: 1790222949, until: 1790309349, code: 'BUSY01', control: [], overlap: 0, profiles: { [ADA]: { name: 'Ada' } }, art: [], paper: null, wires: null, issue: null, desks: { notes }, ...(topics ? { topics: topics.map((topic) => ({ topic, events: [] })) } : {}) }
}

function deps ({ ready = true } = {}) {
  const calls = { pull: [] }
  return {
    calls,
    store: memoryStore(),
    readiness: async () => (ready ? { ready: true, state: 'ready', say: 'Your lens is ready.', do: '' } : { ready: false, state: 'no-score-list', say: 'You have not chosen who works out your web of trust.', do: 'Lenses are set up by the Brainstorm team for now.' }),
    pull: async (reader, { topics }) => { calls.pull.push({ reader, topics }); return busyCorpus(topics) },
  }
}

const text = (result) => result.content.map((c) => c.text).join('')

test('four tools, each saying what it is for', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['get_readiness', 'get_brief', 'get_digest', 'submit_edition'])
  for (const t of TOOLS) assert.ok(t.description.length > 40 && t.inputSchema.type === 'object', t.name)
})

test('readiness is the lens check\'s own verdict, and a lens that is not ready stops the digest before anything is pulled', async () => {
  const d = deps({ ready: false })
  const verdict = await callTool('get_readiness', {}, READER, d)
  assert.match(text(verdict), /NOT READY: no-score-list/)
  assert.match(text(verdict), /Lenses are set up by the Brainstorm team for now\./)
  const refused = await callTool('get_digest', { topics: ['sourdough'] }, READER, d)
  assert.equal(refused.isError, true)
  assert.match(text(refused), /not ready/i)
  assert.deepEqual(d.calls.pull, [], 'never a paper through a lens that is not there')
})

test('the digest comes in parts that fit a tool result and put back together exactly', async () => {
  const d = deps()
  const first = await callTool('get_digest', { topics: ['sourdough', 'formula one'] }, READER, d)
  const { code, parts } = first.structuredContent
  assert.equal(code, 'BUSY01')
  assert.ok(parts > 1, `a busy day needs more than one part (${parts})`)
  assert.deepEqual(d.calls.pull, [{ reader: READER, topics: ['sourdough', 'formula one'] }])

  const bodies = [text(first)]
  for (let part = 2; part <= parts; part++) bodies.push(text(await callTool('get_digest', { code, part }, READER, d)))
  for (const b of bodies) assert.ok(b.length <= LIMIT, `a part of ${b.length} characters`)
  assert.equal(d.calls.pull.length, 1, 'later parts come from the same pull, not a new one')

  const unwrap = (b) => b.slice(b.indexOf('\n\n') + 2, b.lastIndexOf('\n\n'))
  assert.equal(bodies.map(unwrap).join(''), digest(busyCorpus(['sourdough', 'formula one'])), 'nothing lost, nothing twice')
  assert.match(bodies[0].split('\n')[0], /^Part 1 of \d+ · edition code BUSY01/)
  assert.match(bodies[0].split('\n').at(-1), /get_digest with code "BUSY01" and part 2/)
})

test('the brief is the house\'s editorial, with the connector\'s few differences, in one result', async () => {
  const brief = text(await callTool('get_brief', {}, READER, deps()))
  const editorial = readFileSync(new URL('../../.claude/skills/nostr-observer/reference/editorial.md', import.meta.url), 'utf8')
  assert.ok(brief.includes(editorial.trim().split('\n').slice(0, 5).join('\n')), 'the synced brief, not a paraphrase of it')
  assert.match(brief, /do not inline house\.css/i)
  assert.match(brief, /submit_edition/)
  assert.ok(brief.length <= LIMIT, `${brief.length}`)
})

test('the reader is who signed in, whatever the arguments say', async () => {
  const d = deps()
  await callTool('get_digest', { reader: 'cc'.repeat(32), topics: [] }, READER, d)
  assert.equal(d.calls.pull[0].reader, READER)
  const other = await callTool('submit_edition', { code: 'BUSY01', html: '<p>x</p>' }, 'cc'.repeat(32), d)
  assert.equal(other.isError, true)
  assert.match(text(other), /CODE/)
  assert.equal((await callTool('drop_tables', {}, READER, d)).isError, true)
})

test('an accepted page says only what the reader should know: a link it unwrapped, not the routine encodings', async () => {
  const d = deps()
  const note = { id: '1'.repeat(64), kind: 1, pubkey: ADA, created_at: 1790300000, content: 'Noon bread.', tags: [] }
  d.store.keepCorpus(READER, { ...busyCorpus(), code: 'LINK01', desks: { notes: [note] } })
  const html = '<!doctype html><html><head><title>The Nostr Observer — Sunday</title></head><body><main class="sheet"><section class="fold"><article><h2 class="lead-head">Bread</h2>'
    + `<p><q>Noon bread.</q> <a href="https://brainstorm.world/e/${note.id}">Read</a> and <a href="https://evil.example/x">this</a></p></article></section></main></body></html>`
  const out = text(await callTool('submit_edition', { code: 'LINK01', html }, READER, d))
  assert.match(out, /^Accepted/)
  assert.match(out, /unwrapped/i)
  assert.doesNotMatch(out, /nevent1|npub1/, 'resolving a citation is the job, not news')
})

test('the brief asks for the whole paper, and an accepted page says how full it is against what the digest held', async () => {
  const brief = text(await callTool('get_brief', {}, READER, deps()))
  assert.match(brief, /the full paper/i)
  assert.match(brief, /not a summary/i)

  const d = deps()
  const note = { id: '1'.repeat(64), kind: 1, pubkey: ADA, created_at: 1790300000, content: 'Noon bread.', tags: [] }
  const talk = { id: '2'.repeat(64), kind: 1, pubkey: ADA, created_at: 1790300001, content: 'Evening talk.', tags: [] }
  const art = [{ id: 'art-1', url: 'https://img.test/a.jpg', eventId: note.id }, { id: 'art-2', url: 'https://img.test/b.jpg', eventId: talk.id }]
  d.store.keepCorpus(READER, { ...busyCorpus(), code: 'FULL01', art, desks: { notes: [note, talk], articles: [talk] } })
  const html = '<!doctype html><html><head><title>The Nostr Observer — Sunday</title></head><body><main class="sheet"><section class="fold"><article><h2 class="lead-head">Bread</h2>'
    + `<p><q>Noon bread.</q> <a href="https://brainstorm.world/e/${note.id}">Read</a></p><figure><img src="art-1" alt="bread"><figcaption>Bread</figcaption></figure></article></section>`
    + '<section class="band"><div class="band-head"><h2>Long Reads</h2></div><p>Soon.</p></section></main></body></html>'
  const out = text(await callTool('submit_edition', { code: 'FULL01', html }, READER, d))
  assert.match(out, /^Accepted/)
  assert.match(out, /The page has 2 sections and 1 picture; the digest held 2 desks with posts and 2 pictures on the shortlist\./,
    'the front page and one band, against the notes and long-form it was given')
})
