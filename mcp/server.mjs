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
import { TOOLS, callTool } from './observer.mjs'
import { memoryStore } from './store.mjs'
import { toHex } from '../.claude/skills/nostr-observer/scripts/nostr.mjs'
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
  const server = new Server({ name: 'brainstorm-observer', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(request.params.name, request.params.arguments || {}, reader, deps))
  return server
}

export function createConnector ({ authenticate, deps }) {
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (path !== '/mcp') { res.writeHead(404).end(); return }
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
export function relayDeps ({ relay = DEFAULT_RELAY, store = memoryStore(), paperFor = () => null } = {}) {
  return {
    store,
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
  createConnector({ authenticate: tokenAuth(tokens), deps: relayDeps({ paperFor: () => paper }) })
    .listen(port, '127.0.0.1', () => console.log(`Brainstorm Observer connector on http://127.0.0.1:${port}/mcp for ${tokens.size} reader(s)`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
