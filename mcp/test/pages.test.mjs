// The two demo pages the connector serves beside /mcp, as Brainstorm's
// Observer tab will show them: /setup (connect Claude, sign in, schedule the
// daily print with your topics) and /observer (your papers, the week). The
// pages read three small JSON routes; these tests hold those routes and the
// pages' promises, not their pixels.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { createConnector, tokenAuth } from '../server.mjs'
import { memoryStore } from '../store.mjs'
import { callTool } from '../observer.mjs'
import { toNpub } from '../../.claude/skills/nostr-observer/scripts/nostr.mjs'

const READER = 'aa'.repeat(32)
const STRANGER = 'dd'.repeat(32)
const store = memoryStore()
store.putEdition(READER, { date: '2026-09-27', code: 'ABC123', html: '<div class="folio"><span>Vol. I · No. 3</span><span>Sunday, September 27, 2026</span><span>24h to 1:42 a.m. CDT</span></div><article class="story"><p class="kicker">The Lead · Spending</p><h2 class="lead-head">Ice Cream &amp; a <em>Grill</em>, Paid in Sats</h2></article>', living: '<!doctype html><title>Living</title><p>the living copy</p>', printedAt: 1790500000, until: 1790490000, topics: ['nostr'], fullness: { sections: 9, pictures: 8, desks: 13, shortlist: 49 } })
const deps = {
  store,
  readiness: async (reader) => (reader === READER ? { ready: true, state: 'ready', say: 'Ready.', do: '' } : { ready: false, state: 'no-score-list', say: 'No lens yet.', do: 'Ask Brainstorm.' }),
  pull: async () => ({ observer: READER, observerNpub: 'npub1reader', relay: 'wss://relay.test', floor: 20, since: 1790222949, until: 1790309349, code: 'PROG01', control: [], overlap: 0, profiles: {}, art: [], paper: null, wires: null, issue: null, desks: { notes: [{ id: '1'.repeat(64), kind: 1, pubkey: 'bb'.repeat(32), created_at: 1790300000, content: 'Noon bread.', tags: [] }] } }),
  paperUrl: (reader, date, code) => `http://paper.test/${date}-${code}`,
  now: () => 1790309349, // 2026-09-25 04:09 UTC
  geocode: async (q) => (q === '60614' ? [{ label: 'Chicago, Illinois, United States', place: 'Chicago, Illinois', units: 'us' }] : []),
  findTeams: async (q) => (/cubs/i.test(q) ? [{ label: 'Chicago Cubs (Baseball)', league: 'Major League Baseball' }] : []),
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
  for (const words of ['Set up your daily paper', 'Connect your Claude', 'Nostr sign-in', 'Daily print', 'What your Claude does each morning']) assert.ok(html.includes(words), words)
  assert.match(html, /\/mcp/, 'the address to paste into Claude')
  assert.match(html, /Print today's Nostr Observer with the Brainstorm connector\./, 'the prompt the topics box completes')
  assert.doesNotMatch(html, /<script\b[^>]*src=/, 'self-contained: nothing loaded from elsewhere')
})

test('the setup page wears the paper\'s own header: its date line, nameplate and motto, and a section bar of the three steps', async () => {
  const html = await (await get('/setup')).text()
  assert.match(html, /class="folio[^"]*"[\s\S]*id="papers"[^>]*>Your papers/, 'the date line, with the way to your papers')
  assert.match(html, /<header class="masthead">[\s\S]*<h1>News and Other Stuff<\/h1>[\s\S]*class="motto"/, 'the paper\'s nameplate and motto')
  assert.match(html, /<nav class="index mono"[^>]*>[\s\S]*id="p1"[^>]*href="#part-paper"[\s\S]*id="p2"[^>]*href="#connect"[\s\S]*id="p3"[^>]*href="#schedule"/, 'the steps as the paper\'s section bar, each a way to its part')
  assert.doesNotMatch(html, /class="sections|class="oxford"|id="progress"/, 'no tab row, no separate progress line')
})

test('the setup page says only the basics; the specifics are one "learn more" away', async () => {
  const html = await (await get('/setup')).text()
  assert.match(html, /Three steps, about five minutes\. Then your Claude prints your paper every morning\./, 'what you get, in one line')
  assert.doesNotMatch(html, /Getting started|About two minutes|Three questions\. Change any of it later/, 'no framing that repeats the title')
  assert.match(html, /One more thing: finish setting up on Brainstorm, so your paper knows who you follow\./, 'the one thing to do, in everyday words')
  const fold = (summary) => new RegExp(`<details class="learn"[^>]*>\\s*<summary>${summary}</summary>([\\s\\S]*?)</details>`).exec(html)
  assert.match((fold('Why\\?') || [])[1] || '', /relay list/, 'the relay-list detail is behind "Why?"')
  assert.match((fold('More options') || [])[1] || '', /data-page="recipe"[\s\S]*Rather talk than type/, 'which pages, and telling your Claude, behind "More options"')
  assert.match((fold('Other ways to connect') || [])[1] || '', /id="mcp"[\s\S]*id="cmd"/, 'the address by hand and Claude Code, behind "Other ways to connect"')
  const when = (fold('Where can I schedule it\\?') || [])[1] || ''
  assert.match(when, /scheduled task/, 'where to schedule, behind its question')
  assert.match(when, /24 hours up to when it runs, so any time works/, 'no ready time is claimed: the paper reads the day up to when it runs')
  assert.doesNotMatch(when, /around 6|6 a\.m\./, 'one time on the page, not two')
  assert.match(when, /every day at <span class="at-time">7:00 AM<\/span>/, 'the schedule tip names the time picked above')
  assert.match(html, /<label for="remind-time"[^>]*>Your paper's time<\/label>/, 'one time, named for what it is')
  assert.doesNotMatch(html, /half past six/, 'nothing unfounded about when posts are ready')
  assert.match(html, /id="remind-time" value="07:00"/, 'a reminder needs someone awake: seven')
  assert.match((fold('How it works') || [])[1] || '', /Brainstorm never sees your Claude login/, 'how it works and the promises, at the foot')
  assert.match(html, /id="p3"[^>]*>[\s\S]*?Daily print<\/a>/, 'step three is the daily print')
  assert.match(html, /<script type="module">[\s\S]*from '\/assets\/setup\.js'/, 'the page runs on its tested decisions')
  const script = await get('/assets/setup.js')
  assert.equal(script.status, 200)
  assert.match(await script.text(), /export function openStep/)
})

test('the trust-network note is Brainstorm\'s, wearing its mark; only the two Brainstorm marks are served', async () => {
  const html = await (await get('/setup')).text()
  assert.match(html, /<div class="gate brainstorm"[^>]*>[\s\S]*role="img" aria-label="Brainstorm"[\s\S]*finish setting up on Brainstorm/, 'the note carries the Brainstorm wordmark')
  const note = /<div class="gate brainstorm"[\s\S]*?<details/.exec(html)[0]
  assert.doesNotMatch(note, /Nostr|trust network/i, 'no jargon up front: that is what "Why?" is for')
  for (const name of ['mark', 'wordmark']) {
    const res = await get(`/assets/brainstorm/${name}.svg`)
    assert.equal(res.status, 200, name)
    assert.equal(res.headers.get('content-type'), 'image/svg+xml')
  }
  assert.equal((await get('/assets/brainstorm/brand.css')).status, 404, 'the marks, nothing else from the brand folder')
  assert.equal((await get('/assets/brainstorm/..%2Fbrainstorm%2Fmark.svg')).status, 404)
})

test('the setup page offers more private ways, says plainly who sees what, and lets a reader delete it all', async () => {
  const html = await (await get('/setup')).text()
  const fold = (summary) => (new RegExp(`<details class="learn"[^>]*>\\s*<summary>${summary}</summary>([\\s\\S]*?)</details>`).exec(html) || [])[1] || ''
  const ways = fold('More private ways')
  assert.match(ways, /Run it on your own computer/, 'the most private path: the skill, on your own machine')
  assert.match(ways, /settings and papers stay on your computer/i)
  assert.match(ways, /Run your own connector/, 'or this same connector, on your own machine')
  const how = fold('How it works')
  assert.match(how, /Your Claude reads your settings and the day's posts/, 'who sees what, plainly')
  assert.match(how, /kept for 30 days/, 'how long papers are kept')
  assert.match(how, /saved as the city/i, 'and that a ZIP is never kept')
  assert.match(html, /<button[^>]*id="forget"[^>]*>Delete my paper and settings<\/button>/, 'one button deletes it all')
})

test('a reader can delete everything kept for them: settings, papers and history; nobody else\'s, and only on purpose', async () => {
  const ME = 'ee'.repeat(32); const OTHER = 'ff'.repeat(32)
  const kept = memoryStore()
  for (const r of [ME, OTHER]) {
    kept.savePaper(r, { place: 'Chicago, Illinois', teams: ['Chicago Cubs (Baseball)'], founded: '2026-09-25' })
    kept.putEdition(r, { date: '2026-09-27', code: 'ABC123', html: '<p>page</p>', living: '<p>living</p>', printedAt: 1790500000 })
    kept.touch(r, 1790500000); kept.record(r, { tool: 'get_paper' })
  }
  const mine = createConnector({ authenticate: tokenAuth(new Map()), deps: { ...deps, store: kept }, readers: new Set([ME, OTHER]) })
  await new Promise((resolve) => mine.listen(0, '127.0.0.1', resolve))
  try {
    const at = (path, init) => fetch(`http://127.0.0.1:${mine.address().port}${path}`, init)
    assert.equal((await at(`/api/forget?npub=${toNpub(ME)}`)).status, 405, 'never by just visiting an address')
    const asked = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    assert.equal((await at(`/api/forget?npub=${toNpub(STRANGER)}`, asked)).status, 404, 'only for a reader this connector serves')
    const gone = await at(`/api/forget?npub=${toNpub(ME)}`, asked)
    assert.equal(gone.status, 200)
    assert.deepEqual(await (await at(`/api/paper?npub=${toNpub(ME)}`)).json(), {}, 'settings gone')
    assert.deepEqual(await (await at(`/api/editions?npub=${toNpub(ME)}`)).json(), [], 'papers gone')
    assert.equal((await (await at(`/api/status?npub=${toNpub(ME)}`)).json()).connected, false, 'history gone')
    assert.equal((await (await at(`/api/editions?npub=${toNpub(OTHER)}`)).json()).length, 1, 'another reader keeps theirs')
    assert.equal((await (await at(`/api/paper?npub=${toNpub(OTHER)}`)).json()).place, 'Chicago, Illinois')
  } finally { mine.close() }
})

test('another site cannot change or delete a reader\'s paper, nor reach this connector by a borrowed name', async () => {
  const ME = 'ee'.repeat(32)
  const kept = memoryStore()
  kept.savePaper(ME, { place: 'Chicago, Illinois', founded: '2026-09-25' })
  const mine = createConnector({ authenticate: tokenAuth(new Map()), deps: { ...deps, store: kept }, readers: new Set([ME]) })
  await new Promise((resolve) => mine.listen(0, '127.0.0.1', resolve))
  const port = mine.address().port
  const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    r.on('error', reject); if (body) r.write(body); r.end()
  })
  const json = { 'Content-Type': 'application/json' }
  const here = `http://127.0.0.1:${port}`
  try {
    const paper = `/api/paper?npub=${toNpub(ME)}`; const forget = `/api/forget?npub=${toNpub(ME)}`
    assert.equal(await raw(paper, { method: 'POST', headers: { ...json, Origin: 'https://evil.example' }, body: '{"name":"Taken"}' }), 403, 'a save from another site')
    assert.equal(await raw(forget, { method: 'POST', headers: { ...json, Origin: 'https://evil.example' }, body: '{}' }), 403, 'a delete from another site')
    assert.equal(await raw(paper, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: here }, body: '{"name":"Taken"}' }), 415, 'a save that is not JSON, as a plain form could send')
    assert.equal(await raw(forget, { method: 'POST', headers: { Origin: here } }), 415, 'a delete that is not JSON')
    assert.equal(await raw(paper, { headers: { Host: 'evil.example' } }), 421, 'a request under a borrowed name (DNS rebinding) is turned away')
    assert.equal(kept.paperOf(ME).place, 'Chicago, Illinois', 'nothing above changed the paper')
    assert.equal(await raw(paper, { method: 'POST', headers: { ...json, Origin: here }, body: '{"name":"Mine"}' }), 200, 'the page\'s own save still works')
    assert.equal(await raw(forget, { method: 'POST', headers: { ...json, Origin: here }, body: '{}' }), 200, 'and its own delete')
  } finally { mine.close() }
})

test('the house stamp is served for the nameplate when the house has one, and only that one file', async () => {
  assert.equal((await get('/assets/stamp.webp')).status, 404, 'no house stamp: none served, and the page leaves the cut out')
  const house = createConnector({ authenticate: tokenAuth(new Map()), deps: { ...deps, paperDefaults: { stamp: 'ostrich-profile' } }, readers: new Set() })
  await new Promise((resolve) => house.listen(0, '127.0.0.1', resolve))
  try {
    const at = `http://127.0.0.1:${house.address().port}`
    const res = await fetch(at + '/assets/stamp.webp')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/webp')
    assert.equal((await fetch(at + '/assets/../stamp.webp')).status, 404)
  } finally { house.close() }
  const odd = createConnector({ authenticate: tokenAuth(new Map()), deps: { ...deps, paperDefaults: { stamp: '../../package' } }, readers: new Set() })
  await new Promise((resolve) => odd.listen(0, '127.0.0.1', resolve))
  try { assert.equal((await fetch(`http://127.0.0.1:${odd.address().port}/assets/stamp.webp`)).status, 404, 'a stamp name is a name, never a path') } finally { odd.close() }
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
  assert.equal(list[0].issue, 'Vol. I · No. 3', 'each paper names its issue, as its folio printed it')
  assert.equal(list[0].lead, 'Ice Cream & a Grill, Paid in Sats', 'and its lead headline, as plain words')
  const paper = await get(list[0].url)
  assert.equal(paper.status, 200)
  assert.match(await paper.text(), /the living copy/)
  assert.equal((await get(`/api/editions?npub=${toNpub(STRANGER)}`)).status, 404, 'only the readers this connector serves')
  assert.equal((await get(`/observer/${toNpub(READER)}/..%2F..%2Fpackage`)).status, 404)
  assert.equal((await get(`/observer/${toNpub(READER)}/2026-09-27-ZZZ999`)).status, 404)
  const page = await get(`/observer?npub=${toNpub(READER)}`)
  assert.equal(page.status, 200)
  const html = await page.text()
  // The paper has the whole window: no column beside it, one drawer for the issues.
  assert.doesNotMatch(html, /class="layout|class="week"/, 'no week column squeezing the paper')
  assert.match(html, /id="issues-btn"[^>]*aria-expanded="false"[^>]*aria-controls="issues"/, 'one Issues button, closed at first')
  assert.match(html, /<aside[^>]*id="issues"[^>]*hidden/, 'the drawer starts closed')
  assert.match(html, /<aside[^>]*id="issues"[\s\S]*id="issue-list"/, 'one list of issues, a row a day')
  assert.doesNotMatch(html, /This week|Every paper/, 'not two lists of the same papers')
  assert.match(html, /id="prev"[^>]*aria-label="Previous issue"/)
  assert.match(html, /id="next"[^>]*aria-label="Next issue"/)
  assert.match(html, /id="full-btn"[^>]*>Full screen</, 'full screen, one press')
  assert.match(html, /id="more-btn"[^>]*aria-expanded="false"/)
  for (const item of ['Print a fresh edition', 'Open in new tab', 'Publish to my Blossom']) assert.match(html, new RegExp(item), item + ' is under More')
  // The paper's own header is the header: the page adds no name, no tabs and no date line of its own.
  assert.doesNotMatch(html, /class="folio|class="oxford"|brandrow|class="sections/, 'nothing above the paper says what the paper says')
  assert.match(html, /class="[^"]*\bbar\b[\s\S]*id="facts"/, 'once the paper\'s header has scrolled away, the bar carries its issue and window')
  assert.match(html, /id="aa-btn"[^>]*aria-label="Reading settings[^"]*"[^>]*>Aa</, 'Aa in the bar')
  assert.match(html, /id="more-menu"[\s\S]*Set up your paper/, 'set-up lives under More')
  assert.match(html, /id="more-dot"[^>]*hidden/, '"not in yet" is a dot on More, shown only when true')
  assert.match(html, /id="more-menu"[^>]*>\s*<button[^>]*id="fresh-item"/, 'and printing is the first thing inside, so a missing paper is one step from being printed')
  assert.match(html, /<section class="none" id="none"[^>]*hidden>[\s\S]*Your first paper will appear here[\s\S]*Finish setting up →[\s\S]*Print one now/,
    'a reader with no paper yet gets a proper welcome and the two ways forward, not a blank page')
  assert.match(html, /<script type="module">[\s\S]*from '\/assets\/observer\.js'/, 'the page runs on its tested decisions')
  const script = await get('/assets/observer.js')
  assert.equal(script.status, 200)
  assert.match(script.headers.get('content-type'), /javascript/)
  assert.match(await script.text(), /export function headState/)
  assert.equal((await get('/assets/observer.js.map')).status, 404, 'that one file, nothing beside it')
})

test('the setup page can tell when the reader\'s Claude has connected: the first tool call marks it', async () => {
  assert.equal((await (await get(`/api/status?npub=${toNpub(READER)}`)).json()).connected, false)
  await callTool('get_readiness', {}, READER, deps)
  const status = await (await get(`/api/status?npub=${toNpub(READER)}`)).json()
  assert.equal(status.connected, true)
  assert.ok(status.lastCall > 0)
})

test('the status follows the reader\'s Claude step by step, ending on the paper\'s link', async () => {
  const status = async () => (await (await get(`/api/status?npub=${toNpub(READER)}`)).json()).step
  await callTool('get_digest', {}, READER, deps)
  assert.deepEqual(await status(), { tool: 'get_digest', part: 1, parts: 1 })
  const page = (quote) => '<!doctype html><html><head><title>The Nostr Observer — Friday</title></head><body><main class="sheet"><section class="fold"><article><h2 class="lead-head">Bread</h2>'
    + `<p><q>${quote}</q> <a href="https://brainstorm.world/e/${'1'.repeat(64)}">Read</a></p></article></section></main></body></html>`
  await callTool('submit_edition', { code: 'PROG01', html: page('Best bread in town.') }, READER, deps)
  assert.deepEqual(await status(), { tool: 'submit_edition', outcome: 'refused', problems: 1 })
  await callTool('submit_edition', { code: 'PROG01', html: page('Noon bread.') }, READER, deps)
  assert.deepEqual(await status(), { tool: 'submit_edition', outcome: 'accepted', edition: 'PROG01', url: 'http://paper.test/2026-09-25-PROG01' })
})

test('the papers list says whether today\'s paper is in', async () => {
  deps.now = () => 1790395749 // a day of its own: 2026-09-26 04:09 UTC
  const today = '2026-09-26'
  const res = await (await get(`/api/editions?npub=${toNpub(READER)}`)).json()
  assert.ok(Array.isArray(res))
  const head = await get(`/api/today?npub=${toNpub(READER)}`)
  assert.deepEqual(await head.json(), { date: today, in: false })
  store.putEdition(READER, { date: today, code: 'TODAY1', html: '<p></p>', living: '<p></p>' })
  const now = await (await get(`/api/today?npub=${toNpub(READER)}`)).json()
  assert.equal(now.in, true)
  assert.equal(now.code, 'TODAY1')
})

test('the form finds a place from a city or a ZIP, and a team by name, to confirm before saving', async () => {
  assert.deepEqual(await (await get('/api/place?q=60614')).json(), [{ label: 'Chicago, Illinois, United States', place: 'Chicago, Illinois', units: 'us' }], 'the place to keep is the city, not the ZIP typed')
  assert.deepEqual(await (await get('/api/place?q=Nowhere%20Town')).json(), [])
  assert.equal((await get('/api/place?q=a')).status, 400, 'too short to look up')
  assert.deepEqual(await (await get('/api/team?q=cubs')).json(), [{ label: 'Chicago Cubs (Baseball)', league: 'Major League Baseball' }])
})

test('the form saves the reader\'s paper the same way their Claude would, and reads it back', async () => {
  deps.now = () => 1790395749 // 2026-09-26
  const url = `/api/paper?npub=${toNpub(READER)}`
  const post = (body, path = url) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const saved = await post(JSON.stringify({ place: '60614', teams: ['Chicago Cubs (Baseball)'], culture: true, topics: ['Nostr'] }))
  assert.equal(saved.status, 200)
  const back = await (await get(url)).json()
  assert.deepEqual([back.place, back.teams, back.topics, back.founded, back.culture], ['Chicago, Illinois', ['Chicago Cubs (Baseball)'], ['nostr'], '2026-09-26', true])
  assert.equal((await post('{not json')).status, 400)
  assert.equal((await post(JSON.stringify({ stamp: 'x' }))).status, 400, 'nothing a reader may set')
  assert.equal((await post('{}', `/api/paper?npub=${toNpub(STRANGER)}`)).status, 404, 'only the readers this connector serves')
})

test('a daily reminder for any calendar: at the reader\'s own time and time zone, with the instructions in it', async () => {
  deps.now = () => 1790309349 // 2026-09-25 04:09 UTC, which is 11:09 p.m. on the 24th in Chicago
  const res = await get(`/reminder.ics?time=07:00&tz=America%2FChicago&npub=${toNpub(READER)}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/calendar/)
  assert.match(res.headers.get('content-disposition'), /attachment; filename="print-my-paper\.ics"/)
  const ics = (await res.text()).replace(/\r\n /g, '') // unfold the long lines, as a calendar does
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
  assert.match(ics, /\r\nDTSTART;TZID=America\/Chicago:20260925T070000\r\n/, 'the next seven o\'clock, in Chicago')
  assert.match(ics, /\r\nRRULE:FREQ=DAILY\r\n/)
  assert.match(ics, /\r\nSUMMARY:Print today's paper\r\n/)
  assert.match(ics, /DESCRIPTION:Paste this into Claude: Print today's Nostr Observer with the Brainstorm connector\. If my trust network isn't ready\\, stop and tell me why\./, 'commas escaped, as the format asks')
  assert.match(ics, /BEGIN:VALARM/)
  assert.equal((await get('/reminder.ics?time=25:00&tz=America%2FChicago')).status, 400)
  assert.equal((await get('/reminder.ics?time=07:00&tz=Not%2FA_Zone')).status, 400)
})
