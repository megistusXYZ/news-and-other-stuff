// The reading panel, in a real browser: what the reader sees, not what the
// markup says. Headless Chrome, driven over the DevTools protocol with Node's
// own WebSocket, so the skill still installs nothing. The network is cut:
// Brainstorm's frame never loads, and the panel shows the paper's own copy.
//
// Skipped where there is no Chrome. Set CHROME to point at one.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dress, loadAssets } from '../scripts/dress.mjs'
import { toPermalink, toProfileLink } from '../scripts/validate.mjs'

const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p))

// --- the paper: three columns, three stories each, tall enough to scroll ---

const AUTHOR = '11'.repeat(32)
const id = (n) => n.toString(16).padStart(64, '0')
const notes = Array.from({ length: 9 }, (_, i) => ({ id: id(i + 1), kind: 1, pubkey: AUTHOR, created_at: 1790300000 + i, tags: [], content: `Post number ${i + 1}.` }))
const corpus = {
  code: 'PANEL1', since: 1790222949, until: 1790309349,
  desks: { notes }, control: [], art: [],
  profiles: { [AUTHOR]: { name: 'Ada', nip05: null, picture: null, about: null } },
}
const filler = '<p>' + 'The column runs on so the page is long enough to need scrolling. '.repeat(18) + '</p>'
const story = (n) => `<article class="story"><p class="kicker">Story ${n}</p>${n === 4 ? '<h2 class="lead-head">The lead</h2>' : `<h3 class="small-head">Headline ${n}</h3>`}`
  + `<p><a href="${toProfileLink(AUTHOR)}">Ada</a> wrote <q>Post number ${n}.</q> <a href="${toPermalink(id(n))}">Read</a></p>${filler}</article>`
const column = (span, from) => `<div class="col ${span}">${[from, from + 1, from + 2].map(story).join('')}</div>`
const house = readFileSync(new URL('../reference/house.css', import.meta.url), 'utf8')
const page = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>News — Monday</title><style>${house}</style></head>`
  + '<body><main class="sheet"><div class="folio"><span>Vol. I · No. 1</span><span>Monday</span><span>24h</span></div>'
  + '<header class="masthead"><h1>News</h1></header>'
  + `<section class="fold">${column('span-3', 1)}${column('span-6', 4)}${column('span-3', 7)}</section></main></body></html>`

// --- a browser -------------------------------------------------------------

let chrome, ws, dir, file
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++seq
  pending.set(n, { resolve, reject })
  ws.send(JSON.stringify({ id: n, method, params }))
})
/** Run `fn` in the page and return its result. */
const inPage = async (fn, ...args) => {
  const out = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true })
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text)
  return out.result.value
}

before(async () => {
  if (!CHROME) return
  dir = mkdtempSync(join(tmpdir(), 'panel-'))
  file = join(dir, 'paper.living.html')
  writeFileSync(file, dress(page, corpus, loadAssets()).html)
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(dir, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    let err = ''
    chrome.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) resolve(m[1]) })
    chrome.on('exit', () => reject(new Error('Chrome exited: ' + err.slice(0, 400))))
  })
  const port = new URL(endpoint).port
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    } else if (msg.method === 'Fetch.requestPaused') {
      // Only the paper itself is read; everything on the network is refused.
      const local = msg.params.request.url.startsWith('file:')
      send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: msg.params.requestId } : { requestId: msg.params.requestId, errorReason: 'BlockedByClient' })
    }
  }
  await new Promise((resolve) => { ws.onopen = resolve })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await send('Page.enable')
})

after(async () => {
  try { ws && ws.close() } catch {}
  if (chrome && chrome.exitCode === null) {
    const gone = new Promise((resolve) => chrome.once('exit', resolve))
    chrome.kill()
    await gone
  }
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A fresh copy of the paper, its script running and the panel built. */
async function openPaper () {
  await send('Page.navigate', { url: pathToFileURL(file).href })
  await inPage(() => new Promise((resolve, reject) => {
    const t0 = Date.now()
    const wait = () => document.querySelector('.lv-panel') ? resolve() : Date.now() - t0 > 5000 ? reject(new Error('the living layer never started')) : setTimeout(wait, 50)
    wait()
  }))
}

const skip = CHROME ? false : 'no Chrome on this machine (set CHROME)'

test('stepping through the stories leaves every story where the paper set it', { skip }, async () => {
  await openPaper()
  const moved = await inPage(async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms))
    const stories = [...document.querySelectorAll('.story')]
    // Against its own column, and in offsets, which ignore the sheet's
    // dimming transform: the page may shift as a whole when the panel takes
    // the scrollbar away, but a story must not move within its column, nor
    // be pushed down by a neighbour rewrapping under the reader's eye.
    const where = (s) => { const c = s.parentElement; return [s.offsetLeft - c.offsetLeft, s.offsetTop - c.offsetTop, s.offsetWidth].join(',') }
    const placed = new Map(stories.map((s) => [s, where(s)]))
    document.querySelector('a[data-ev]').click()
    await pause(300)
    const next = document.querySelector('.lv-panel-step[aria-label="Next"]')
    const out = []
    for (let i = 0; i < 8; i++) {
      next.click()
      await pause(250)
      for (const s of stories) if (where(s) !== placed.get(s)) out.push(`${s.querySelector('.kicker').textContent}: ${placed.get(s)} -> ${where(s)}`)
    }
    return out
  })
  assert.deepEqual(moved, [], 'a story being read keeps its place in its column')
})

test('closing the panel leaves the reader at the last story read, not the first one opened', { skip }, async () => {
  await openPaper()
  const at = await inPage(async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms))
    scrollTo(0, 0)
    document.querySelector('a[data-ev]').click()
    await pause(300)
    const next = document.querySelector('.lv-panel-step[aria-label="Next"]')
    for (let i = 0; i < 8; i++) { next.click(); await pause(250) }
    const last = [...document.querySelectorAll('a[data-ev]')].pop()
    document.querySelector('.lv-panel-close').click()
    await pause(600)
    const r = last.getBoundingClientRect()
    return { open: document.body.classList.contains('lv-reading-open'), top: r.top, bottom: r.bottom, height: innerHeight, focused: document.activeElement === last }
  })
  assert.equal(at.open, false, 'the panel closed')
  assert.ok(at.top >= 0 && at.bottom <= at.height, `the last story's link is on screen (top ${at.top}, screen ${at.height})`)
  assert.ok(at.focused, 'and focus is on it, for the keyboard')
})
