// The two demo pages the connector serves beside /mcp, as Brainstorm's
// Observer tab will show them: /setup (connect Claude, sign in, schedule the
// daily print with your topics) and /observer (your papers, the week). The
// pages read three small JSON routes; these tests hold those routes and the
// pages' promises, not their pixels.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createConnector, tokenAuth } from '../server.mjs'
import { memoryStore } from '../store.mjs'
import { callTool } from '../observer.mjs'
import { toNpub } from '../../.claude/skills/nostr-observer/scripts/nostr.mjs'

const READER = 'aa'.repeat(32)
const STRANGER = 'dd'.repeat(32)
const store = memoryStore()
store.putEdition(READER, { date: '2026-09-27', code: 'ABC123', html: '<p>page</p>', living: '<!doctype html><title>Living</title><p>the living copy</p>', printedAt: 1790500000, until: 1790490000, topics: ['nostr'], fullness: { sections: 9, pictures: 8, desks: 13, shortlist: 49 } })
const deps = {
  store,
  readiness: async (reader) => (reader === READER ? { ready: true, state: 'ready', say: 'Ready.', do: '' } : { ready: false, state: 'no-score-list', say: 'No lens yet.', do: 'Ask Brainstorm.' }),
  pull: async () => { throw new Error('not in these tests') },
}
const server = createConnector({ authenticate: tokenAuth(new Map([['t', READER]])), deps, readers: new Set([READER]) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
after(() => server.close())
const get = (path) => fetch(base + path)

test('the setup page walks the three steps, with this connector\'s address and a prompt made from the reader\'s topics', async () => {
  const res = await get('/setup')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  const html = await res.text()
  for (const words of ['Set up your daily paper', 'Connect your Claude', 'Sign in with Nostr', 'Schedule the daily print', 'What your Claude does each morning']) assert.ok(html.includes(words), words)
  assert.match(html, /\/mcp/, 'the address to paste into Claude')
  assert.match(html, /Print today's Nostr Observer with the Brainstorm connector\./, 'the prompt the topics box completes')
  assert.doesNotMatch(html, /<script\b[^>]*src=/, 'self-contained: nothing loaded from elsewhere')
})

test('anyone may ask whether an npub\'s lens is ready; a bad npub is a 400', async () => {
  assert.deepEqual(await (await get(`/api/readiness?npub=${toNpub(READER)}`)).json(), { ready: true, state: 'ready', say: 'Ready.', do: '' })
  assert.equal((await (await get(`/api/readiness?npub=${toNpub(STRANGER)}`)).json()).state, 'no-score-list')
  assert.equal((await get('/api/readiness?npub=not-an-npub')).status, 400)
})

test('a local reader\'s papers are listed for the Observer page and each opens; nobody else\'s, and nothing outside', async () => {
  const list = await (await get(`/api/editions?npub=${toNpub(READER)}`)).json()
  assert.deepEqual(list.map((e) => [e.date, e.code, e.url]), [['2026-09-27', 'ABC123', `/observer/${toNpub(READER)}/2026-09-27-ABC123`]])
  assert.deepEqual(list[0].fullness, { sections: 9, pictures: 8, desks: 13, shortlist: 49 })
  const paper = await get(list[0].url)
  assert.equal(paper.status, 200)
  assert.match(await paper.text(), /the living copy/)
  assert.equal((await get(`/api/editions?npub=${toNpub(STRANGER)}`)).status, 404, 'only the readers this connector serves')
  assert.equal((await get(`/observer/${toNpub(READER)}/..%2F..%2Fpackage`)).status, 404)
  assert.equal((await get(`/observer/${toNpub(READER)}/2026-09-27-ZZZ999`)).status, 404)
  const page = await get(`/observer?npub=${toNpub(READER)}`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /This week/)
})

test('the setup page can tell when the reader\'s Claude has connected: the first tool call marks it', async () => {
  assert.equal((await (await get(`/api/status?npub=${toNpub(READER)}`)).json()).connected, false)
  await callTool('get_readiness', {}, READER, deps)
  const status = await (await get(`/api/status?npub=${toNpub(READER)}`)).json()
  assert.equal(status.connected, true)
  assert.ok(status.lastCall > 0)
})
