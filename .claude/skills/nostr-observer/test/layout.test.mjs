// The Wire's balance: the agate's text cells end together. Not part of the
// boundary — a page is never refused for its layout — but the writer hears
// about a column that runs on while its neighbours stop.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { wireBalance } from '../scripts/layout.mjs'

const items = (n, what) => Array.from({ length: n }, (_, i) => `<div class="wire-item"><p>${what} ${i + 1}</p></div>`).join('\n')
const cell = (head, body) => `<div class="cell">\n<p class="box-head">${head}</p>\n${body}\n</div>`
const tape = cell('The Tape', '<table><tr><th>Share</th></tr><tr><td>NVDA</td></tr></table>')
const wire = (...cells) => `<section class="band">\n<div class="band-head"><h2>The Wire</h2></div>\n<div class="agate">\n${cells.join('\n')}\n</div>\n</section>`

test('eight stations beside five headlines and four listings is a Wire out of balance', () => {
  const page = wire(cell('Headlines', items(5, 'headline')), cell('Broadcasting', items(8, 'station')), cell('What\'s On', items(4, 'event')), tape)
  const notes = wireBalance(page)
  assert.ok(notes.some((n) => /Broadcasting/.test(n) && /8/.test(n) && /six/.test(n)), notes.join('\n'))
  assert.ok(notes.some((n) => /What's On/.test(n) && /4/.test(n)), notes.join('\n'))
})

test('five headlines, six stations and five listings end together, and the short Tape is no fault', () => {
  const page = wire(cell('Headlines', items(5, 'headline')), cell('Broadcasting', items(6, 'station')), cell('What&#39;s On', items(5, 'event')), tape)
  assert.deepEqual(wireBalance(page), [])
})

test('validate tells the writer about the Wire, and still passes a page whose quotes are clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'layout-'))
  const page = join(dir, 'page.html')
  const corpus = join(dir, 'corpus.json')
  writeFileSync(page, `<!doctype html><html><head><title>A paper</title></head><body><main class="sheet">${wire(cell('Headlines', items(5, 'headline')), cell('Broadcasting', items(8, 'station')))}</main></body></html>`)
  writeFileSync(corpus, JSON.stringify({ desks: { notes: [] }, art: [] }))
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url)), page, '--corpus', corpus], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /CLEAN/)
  assert.match(run.stdout, /LAYOUT[^\n]*not blocking[\s\S]*Broadcasting carries 8 stations/)
})

test('a paper with no Wire, or no Classifieds that day, has nothing to balance', () => {
  assert.deepEqual(wireBalance('<main class="sheet"><section class="fold"></section></main>'), [])
  assert.deepEqual(wireBalance(wire(cell('Headlines', items(5, 'headline')), tape)), [])
})
