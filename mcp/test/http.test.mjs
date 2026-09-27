// The connector over the wire, spoken to by the MCP SDK's own client, the way
// Claude speaks to it: initialize, list the tools, call them. No token, no
// connector; and a reader's token reads that reader's paper and nobody else's.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createConnector, tokenAuth } from '../server.mjs'
import { memoryStore } from '../store.mjs'

const READER = 'aa'.repeat(32)
const OTHER = 'cc'.repeat(32)
const corpus = { observer: READER, observerNpub: 'npub1reader', relay: 'wss://relay.test', floor: 20, since: 1790222949, until: 1790309349, code: 'HTTP01', control: [], overlap: 0, profiles: {}, art: [], paper: null, wires: null, issue: null, desks: { notes: [] } }
const deps = {
  store: memoryStore(),
  readiness: async () => ({ ready: true, state: 'ready', say: 'Your lens is ready.', do: '' }),
  pull: async () => corpus,
}
const server = createConnector({ authenticate: tokenAuth(new Map([['token-a', READER], ['token-b', OTHER]])), deps })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`)
after(() => server.close())

async function connect (token) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

test('without a token there is no connector: 401, with a Bearer challenge', async () => {
  for (const headers of [{}, { Authorization: 'Bearer nope' }]) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) })
    assert.equal(res.status, 401)
    assert.match(res.headers.get('www-authenticate') || '', /^Bearer/)
  }
})

test('a signed-in Claude sees the four tools and can call them', async () => {
  const client = await connect('token-a')
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name), ['get_readiness', 'get_paper', 'set_paper', 'get_brief', 'get_digest', 'submit_edition'])
  assert.deepEqual(tools.find((t) => t.name === 'submit_edition').inputSchema.required, ['code', 'html'])
  const ready = await client.callTool({ name: 'get_readiness', arguments: {} })
  assert.match(ready.content[0].text, /^READY/)
  const part = await client.callTool({ name: 'get_digest', arguments: { topics: ['sourdough'] } })
  assert.match(part.content[0].text, /^Part 1 of 1 · edition code HTTP01 · topics: sourdough/)
  await client.close()
})

test('one reader\'s token cannot read another reader\'s digest', async () => {
  const a = await connect('token-a')
  await a.callTool({ name: 'get_digest', arguments: {} })
  await a.close()
  const b = await connect('token-b')
  const theirs = await b.callTool({ name: 'get_digest', arguments: { code: 'HTTP01', part: 1 } })
  assert.equal(theirs.isError, true)
  assert.match(theirs.content[0].text, /No digest with that code for you/)
  await b.close()
})

test('on connecting, Claude is told the whole routine, so a short prompt is enough', async () => {
  const client = await connect('token-a')
  const how = client.getInstructions() || ''
  const order = ['get_readiness', 'get_brief', 'get_digest', 'submit_edition'].map((tool) => how.indexOf(tool))
  assert.ok(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1])), `the four tools, in the order to call them: ${order}`)
  assert.match(how, /every part/i)
  assert.match(how, /refused/i, 'what to do when a page is refused')
  assert.match(how, /link/i, 'end by giving the reader the paper\'s link')
  assert.ok(how.length < 2000, 'short enough to always be read')
  await client.close()
})
