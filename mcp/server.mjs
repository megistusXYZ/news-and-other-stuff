// The Brainstorm Observer connector over HTTP: MCP's Streamable HTTP, one
// stateless server per request, behind an authenticate(req) -> reader hook.
// Locally the hook is a token map from the environment; Brainstorm replaces it
// with OAuth and its NIP-98 sign-in, and nothing else here changes.
//
//   OBSERVER_TOKENS="<token>:<npub>[,<token>:<npub>…]" node server.mjs
//
// then, in Claude Code:
//   claude mcp add --transport http observer http://127.0.0.1:8787/mcp \
//     --header "Authorization: Bearer <token>"

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOLS, INSTRUCTIONS, callTool } from './observer.mjs'
import { memoryStore, fileStore } from './store.mjs'
import { toHex, toNpub } from '../.claude/skills/nostr-observer/scripts/nostr.mjs'
import { gather } from '../.claude/skills/nostr-observer/scripts/readiness.mjs'
import { assess, REMEDY } from '../.claude/skills/nostr-observer/scripts/chain.mjs'
import { pullCorpus, readPaper, DEFAULT_RELAY } from '../.claude/skills/nostr-observer/scripts/corpus.mjs'

/** A fixed map of bearer tokens to readers: for local use only. */
export function tokenAuth (tokens) {
  return (req) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')
    return (m && tokens.get(m[1])) || null
  }
}

function mcpServer (reader, deps) {
  const server = new Server({ name: 'brainstorm-observer', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(request.params.name, request.params.arguments || {}, reader, deps))
  return server
}

const PAGES = new URL('./pages/', import.meta.url)
const FONTS = new URL('../.claude/skills/nostr-observer/reference/fonts/', import.meta.url)

const send = (res, status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body) }
const json = (res, status, value) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value))
const readerOf = (npub) => { try { return toHex(String(npub || '')) } catch { return null } }

/**
 * The demo pages beside /mcp: /setup and /observer, and the small JSON they
 * read. Readiness is public (anyone may ask whether an npub's lens is ready);
 * a reader's papers are listed only for the readers this connector serves.
 * On Brainstorm these sit behind its own sign-in; here, `readers` stands in.
 */
async function page (req, res, url, deps, readers) {
  const path = url.pathname
  if (path === '/setup' || path === '/observer') return send(res, 200, 'text/html; charset=utf-8', readFileSync(new URL(`.${path}.html`, PAGES)))
  if (path.startsWith('/assets/fonts/')) {
    const name = path.slice('/assets/fonts/'.length)
    if (!/^[a-z0-9-]+\.woff2$/.test(name)) return send(res, 404, 'text/plain', 'not found')
    return send(res, 200, 'font/woff2', readFileSync(new URL(name, FONTS)))
  }
  const reader = readerOf(url.searchParams.get('npub'))
  if (path === '/api/readiness') {
    if (!reader) return json(res, 400, { error: 'give an npub' })
    return json(res, 200, await deps.readiness(reader))
  }
  if (path === '/api/status') {
    if (!reader) return json(res, 400, { error: 'give an npub' })
    const lastCall = deps.store.lastCall ? deps.store.lastCall(reader) : null
    return json(res, 200, { connected: !!lastCall, lastCall })
  }
  if (path === '/api/editions') {
    if (!reader || !readers.has(reader)) return json(res, 404, { error: 'no papers for that npub here' })
    const npub = toNpub(reader)
    return json(res, 200, deps.store.editions(reader).map(({ date, code, printedAt, until, topics, fullness }) => ({ date, code, printedAt, until, topics, fullness, url: `/observer/${npub}/${date}-${code}` })))
  }
  const m = /^\/observer\/(npub1[0-9a-z]+)\/(\d{4}-\d{2}-\d{2})-([0-9A-F]{6})$/.exec(path)
  if (m) {
    const owner = readerOf(m[1])
    const entry = owner && readers.has(owner) ? deps.store.edition(owner, m[2], m[3]) : null
    if (!entry) return send(res, 404, 'text/plain', 'no such paper')
    return send(res, 200, 'text/html; charset=utf-8', entry.living)
  }
  return send(res, 404, 'text/plain', 'not found')
}

export function createConnector ({ authenticate, deps, readers = new Set() }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/mcp') {
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'method not allowed')
      try { return await page(req, res, url, deps, readers) } catch (error) { console.error(error); return send(res, 500, 'text/plain', 'error') }
    }
    const reader = authenticate(req)
    if (!reader) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="brainstorm-observer"', 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'sign in to Brainstorm to use this connector' }))
      return
    }
    const server = mcpServer(reader, deps)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }))
      console.error(error)
    }
  })
}

// The real thing: the lens check and the pull against the ranked relay.
export function relayDeps ({ relay = DEFAULT_RELAY, store = memoryStore(), paperFor = () => null, publicUrl = null } = {}) {
  return {
    store,
    // Where the reader reads an accepted paper: this service's Observer page.
    paperUrl: publicUrl ? (reader, date, code) => `${publicUrl}/observer/${toNpub(reader)}/${date}-${code}` : null,
    readiness: async (reader) => {
      const until = Math.floor(Date.now() / 1000)
      const verdict = assess(await gather(reader, relay, until - 86400))
      const remedy = REMEDY[verdict.state] || { say: verdict.state, do: null }
      return { ready: verdict.ready, state: verdict.state, say: remedy.say, do: remedy.do || '' }
    },
    pull: (reader, { topics }) => pullCorpus(reader, { relay, topics, paper: paperFor(reader) }),
  }
}

function main () {
  const tokens = new Map((process.env.OBSERVER_TOKENS || '').split(',').filter(Boolean).map((pair) => {
    const [token, npub] = pair.split(':')
    return [token, toHex(npub)]
  }))
  if (!tokens.size) {
    console.error('Set OBSERVER_TOKENS="<token>:<npub>" to say who may use this local connector.')
    process.exit(2)
  }
  // A local reader may keep their own paper settings (place, feeds, the back
  // page) in observer.config.json, as the skill does.
  const config = process.env.OBSERVER_CONFIG || 'observer.config.json'
  const paper = existsSync(config) ? readPaper(config) : null
  const port = Number(process.env.PORT || 8787)
  // Accepted editions are also written under OBSERVER_EDITIONS, if set, so a
  // local reader can open them.
  const store = process.env.OBSERVER_EDITIONS ? fileStore(process.env.OBSERVER_EDITIONS) : memoryStore()
  createConnector({ authenticate: tokenAuth(tokens), deps: relayDeps({ store, paperFor: () => paper, publicUrl: (process.env.OBSERVER_PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '') }), readers: new Set(tokens.values()) })
    .listen(port, '127.0.0.1', () => console.log(`Brainstorm Observer connector on http://127.0.0.1:${port}/mcp, with /setup and /observer, for ${tokens.size} reader(s)`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
