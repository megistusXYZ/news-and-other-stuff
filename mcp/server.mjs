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
import { TOOLS, INSTRUCTIONS, callTool, paperFacts } from './observer.mjs'
import { memoryStore, fileStore } from './store.mjs'
import { toHex, toNpub } from '../.claude/skills/nostr-observer/scripts/nostr.mjs'
import { gather } from '../.claude/skills/nostr-observer/scripts/readiness.mjs'
import { assess, REMEDY } from '../.claude/skills/nostr-observer/scripts/chain.mjs'
import { pullCorpus, DEFAULT_RELAY } from '../.claude/skills/nostr-observer/scripts/corpus.mjs'

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
const STAMPS = new URL('../.claude/skills/nostr-observer/reference/stamps/', import.meta.url)
const FONTS = new URL('../.claude/skills/nostr-observer/reference/fonts/', import.meta.url)

const send = (res, status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body) }
const json = (res, status, value) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value))
const DAILY_PROMPT = "Print today's Nostr Observer with the Brainstorm connector. If my trust network isn't ready, stop and tell me why."

/**
 * A daily reminder any calendar can take (RFC 5545): at the reader's own time
 * in their own time zone, from the next such time on, with the instructions
 * to paste in its notes. For readers whose Claude cannot schedule yet.
 */
export function reminder ({ time, tz, now, papers = null }) {
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''))
  if (!t || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(String(tz || ''))) return null
  let parts
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(now * 1000)).map((p) => [p.type, p.value]))
  } catch { return null }
  const later = Number(parts.hour) * 60 + Number(parts.minute) >= Number(t[1]) * 60 + Number(t[2])
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + (later ? 1 : 0)))
  const ymd = day.toISOString().slice(0, 10).replace(/-/g, '')
  const stamp = new Date(now * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const text = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const fold = (line) => { const out = []; for (let i = 0; i < line.length; i += 73) out.push((i ? ' ' : '') + line.slice(i, i + 73)); return out.join('\r\n') }
  const notes = `Paste this into Claude: ${DAILY_PROMPT}` + (papers ? `\nYour papers: ${papers}` : '')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//News and Other Stuff//Observer//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:print-my-paper-${ymd}-${t[1]}${t[2]}@news-and-other-stuff`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${tz}:${ymd}T${t[1]}${t[2]}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
    "SUMMARY:Print today's paper", fold(`DESCRIPTION:${text(notes)}`),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', "DESCRIPTION:Print today's paper", 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')
}

async function readBody (req, max = 20_000) {
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > max) throw new Error('too large') }
  return body
}
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
  // The house's stamp, for the setup page's nameplate as the paper wears it.
  // A stamp is a name in reference/stamps/, never a path.
  if (path === '/assets/stamp.webp') {
    const name = deps.paperDefaults && deps.paperDefaults.stamp
    const file = typeof name === 'string' && /^[a-z0-9-]+$/.test(name) ? new URL(`${name}.webp`, STAMPS) : null
    if (!file || !existsSync(file)) return send(res, 404, 'text/plain', 'not found')
    return send(res, 200, 'image/webp', readFileSync(file))
  }
  // The Your papers page's tested decisions, and nothing else from pages/.
  if (path === '/assets/observer.js') return send(res, 200, 'text/javascript; charset=utf-8', readFileSync(new URL('./observer.js', PAGES)))
  if (path.startsWith('/assets/fonts/')) {
    const name = path.slice('/assets/fonts/'.length)
    if (!/^[a-z0-9-]+\.woff2$/.test(name)) return send(res, 404, 'text/plain', 'not found')
    return send(res, 200, 'font/woff2', readFileSync(new URL(name, FONTS)))
  }
  if (path === '/api/place' || path === '/api/team') {
    const q = String(url.searchParams.get('q') || '').trim()
    if (q.length < 2 || q.length > 80) return json(res, 400, { error: 'type at least two letters' })
    return json(res, 200, await (path === '/api/place' ? deps.geocode(q) : deps.findTeams(q)))
  }
  const reader = readerOf(url.searchParams.get('npub'))
  if (path === '/reminder.ics') {
    const ics = reminder({ time: url.searchParams.get('time'), tz: url.searchParams.get('tz'), now: deps.now ? deps.now() : Math.floor(Date.now() / 1000), papers: reader && deps.publicUrl ? `${deps.publicUrl}/observer?npub=${toNpub(reader)}` : null })
    if (!ics) return send(res, 400, 'text/plain', 'give a time as HH:MM and a time zone such as America/Chicago')
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="print-my-paper.ics"', 'Cache-Control': 'no-store' })
    return res.end(ics)
  }
  if (path === '/api/paper') {
    if (!reader || !readers.has(reader)) return json(res, 404, { error: 'no paper for that npub here' })
    if (req.method !== 'POST') return json(res, 200, (deps.store.paperOf && deps.store.paperOf(reader)) || {})
    // The form saves exactly as the reader's Claude would, through set_paper.
    let body
    try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: 'send the settings as JSON' }) }
    const out = await callTool('set_paper', body, reader, deps)
    if (out.isError) return json(res, 400, { error: out.content[0].text })
    return json(res, 200, out.structuredContent)
  }
  if (path === '/api/readiness') {
    if (!reader) return json(res, 400, { error: 'give an npub' })
    return json(res, 200, await deps.readiness(reader))
  }
  if (path === '/api/status') {
    if (!reader) return json(res, 400, { error: 'give an npub' })
    const lastCall = deps.store.lastCall ? deps.store.lastCall(reader) : null
    return json(res, 200, { connected: !!lastCall, lastCall, step: deps.store.lastStep ? deps.store.lastStep(reader) : null })
  }
  if (path === '/api/today') {
    if (!reader || !readers.has(reader)) return json(res, 404, { error: 'no papers for that npub here' })
    const date = new Date((deps.now ? deps.now() : Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10)
    const e = deps.store.editions(reader).find((x) => x.date === date)
    return json(res, 200, e ? { date, in: true, code: e.code, printedAt: e.printedAt, url: `/observer/${toNpub(reader)}/${date}-${e.code}` } : { date, in: false })
  }
  if (path === '/api/editions') {
    if (!reader || !readers.has(reader)) return json(res, 404, { error: 'no papers for that npub here' })
    const npub = toNpub(reader)
    return json(res, 200, deps.store.editions(reader).map((e) => ({
      date: e.date, code: e.code, printedAt: e.printedAt, until: e.until, topics: e.topics, fullness: e.fullness,
      ...paperFacts(e.html), url: `/observer/${npub}/${e.date}-${e.code}`,
    })))
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
      if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/api/paper')) return send(res, 405, 'text/plain', 'method not allowed')
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
export function relayDeps ({ relay = DEFAULT_RELAY, store = memoryStore(), publicUrl = null, paperDefaults = {} } = {}) {
  return {
    store,
    // The house's own marks (brand, stamps, imprint), beneath every reader's settings.
    paperDefaults,
    publicUrl,
    // Where the reader reads an accepted paper: this service's Observer page.
    paperUrl: publicUrl ? (reader, date, code) => `${publicUrl}/observer/${toNpub(reader)}/${date}-${code}` : null,
    readiness: async (reader) => {
      const until = Math.floor(Date.now() / 1000)
      const verdict = assess(await gather(reader, relay, until - 86400))
      const remedy = REMEDY[verdict.state] || { say: verdict.state, do: null }
      return { ready: verdict.ready, state: verdict.state, say: remedy.say, do: remedy.do || '' }
    },
    // For the setup form: a city or ZIP to a place the weather will find, and
    // a team name to the teams TheSportsDB knows, both keyless.
    geocode: async (q) => {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`)
      const found = r.ok ? ((await r.json()).results || []) : []
      return found.map((p) => ({ label: [p.name, p.admin1, p.country].filter(Boolean).join(', '), place: q, units: p.country_code === 'US' ? 'us' : 'metric', country: p.country_code || null }))
    },
    findTeams: async (q) => {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(q)}`)
      const found = r.ok ? ((await r.json()).teams || []) : []
      return found.slice(0, 6).map((t) => ({ label: `${t.strTeam} (${t.strSport})`, league: t.strLeague || null }))
    },
    pull: (reader, { topics, paper }) => pullCorpus(reader, { relay, topics, paper }),
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
  // Only the host's marks come from observer.config.json, beneath every
  // reader's own settings. The file's place, teams and topics are the host's
  // own paper and never reach another reader: each reader's settings are
  // their own, saved with set_paper.
  const config = process.env.OBSERVER_CONFIG || 'observer.config.json'
  const raw = existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')) : {}
  const paperDefaults = Object.fromEntries(['brand', 'stamp', 'stampDark', 'imprint'].filter((k) => raw[k] != null).map((k) => [k, raw[k]]))
  const port = Number(process.env.PORT || 8787)
  // Accepted editions are also written under OBSERVER_EDITIONS, if set, so a
  // local reader can open them.
  const store = process.env.OBSERVER_EDITIONS ? fileStore(process.env.OBSERVER_EDITIONS) : memoryStore()
  createConnector({ authenticate: tokenAuth(tokens), deps: relayDeps({ store, paperDefaults, publicUrl: (process.env.OBSERVER_PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '') }), readers: new Set(tokens.values()) })
    .listen(port, '127.0.0.1', () => console.log(`Brainstorm Observer connector on http://127.0.0.1:${port}/mcp, with /setup and /observer, for ${tokens.size} reader(s)`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
