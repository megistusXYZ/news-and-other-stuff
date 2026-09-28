// The Your papers page's decisions, as plain functions: how the header gives
// way while reading, which issue comes next, which issue the address names,
// and what the Issues drawer shuts off behind it. The page imports the same
// module from /assets/observer.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headState, stepIssue, issueFromAddress, addressFor, shutBehind, folioFacts, issueList } from '../pages/observer.js'

test('no bar while the paper\'s own header is in view; once it has scrolled away, a slim bar on a desktop, and on a phone gone on the way down and back on the way up', () => {
  const top = 320 // where the paper's masthead ends
  assert.equal(headState({ y: 0, lastY: 500, phone: false, now: 'slim', top }), 'top', 'at the top the paper\'s own header is the header')
  assert.equal(headState({ y: 319, lastY: 0, phone: true, now: 'top', top }), 'top', 'the masthead still showing: nothing repeated')
  assert.equal(headState({ y: 400, lastY: 300, phone: false, now: 'top', top }), 'slim', 'the masthead gone: the bar carries it')
  assert.equal(headState({ y: 380, lastY: 400, phone: false, now: 'slim', top }), 'slim', 'on a desktop the bar stays either way')
  assert.equal(headState({ y: 500, lastY: 400, phone: true, now: 'slim', top }), 'hidden', 'down on a phone: out of the way')
  assert.equal(headState({ y: 400, lastY: 500, phone: true, now: 'hidden', top }), 'slim', 'up on a phone: the bar comes back')
  assert.equal(headState({ y: 502, lastY: 500, phone: true, now: 'hidden', top }), 'hidden', 'a jitter changes nothing')
  assert.equal(headState({ y: 324, lastY: 322, phone: true, now: 'top', top }), 'slim', 'just past the masthead, the bar arrives')
  assert.equal(headState({ y: 30, lastY: 0, phone: false, now: 'top' }), 'top', 'a paper with no masthead measured: a little way down still counts as the top')
  assert.equal(headState({ y: 60, lastY: 0, phone: false, now: 'top' }), 'slim')
})

// As /api/editions lists them: newest first, a reprint on the 27th, nothing on the 26th.
const EDITIONS = [
  { date: '2026-09-28', code: 'AAA111' },
  { date: '2026-09-27', code: 'BBB222' },
  { date: '2026-09-27', code: 'CCC333' },
  { date: '2026-09-25', code: 'DDD444' },
]
const [MON, SUN, SUN_REPRINT, FRI] = EDITIONS

test('‹ and › step a day at a time: past a reprint and over a day with no paper, and nowhere past either end', () => {
  assert.equal(stepIssue(EDITIONS, SUN, 1), FRI, 'the day before that had a paper')
  assert.equal(stepIssue(EDITIONS, SUN_REPRINT, -1), MON, 'from a reprint, the next day')
  assert.equal(stepIssue(EDITIONS, FRI, -1), SUN, 'a day\'s latest paper, not its reprint')
  assert.equal(stepIssue(EDITIONS, MON, -1), null, 'nothing newer than the newest')
  assert.equal(stepIssue(EDITIONS, FRI, 1), null, 'nothing older than the first')
})

test('the address names the issue being read, so a reload or a shared link opens the same one', () => {
  assert.equal(issueFromAddress('?npub=npub1x&issue=2026-09-27-CCC333', EDITIONS), SUN_REPRINT)
  assert.equal(issueFromAddress('?npub=npub1x', EDITIONS), null, 'none named: the page opens the newest')
  assert.equal(issueFromAddress('?issue=2026-09-26-EEE555', EDITIONS), null, 'an issue this reader does not have')
  assert.equal(issueFromAddress('?issue=../../package', EDITIONS), null)
  assert.equal(addressFor('?npub=npub1x', SUN_REPRINT), '?npub=npub1x&issue=2026-09-27-CCC333', 'the rest of the address kept')
  assert.equal(addressFor('?npub=npub1x&issue=2026-09-28-AAA111', FRI), '?npub=npub1x&issue=2026-09-25-DDD444', 'one issue at a time')
})

test('while the Issues drawer is open nothing behind it can be reached by keyboard or screen reader; closing it gives the page back', () => {
  const header = { name: 'header', inert: false }
  const paper = { name: 'paper', inert: false }
  const exit = { name: 'exit', inert: false }
  const drawer = { name: 'drawer', inert: false }
  const page = [header, paper, exit, drawer]
  shutBehind(true, page, drawer)
  assert.deepEqual(page.filter((p) => p.inert).map((p) => p.name), ['header', 'paper', 'exit'])
  assert.equal(drawer.inert, false, 'the drawer itself stays reachable')
  shutBehind(false, page, drawer)
  assert.deepEqual(page.filter((p) => p.inert), [])
})

test('the bar carries the paper\'s own folio: its issue number and its window, read from the paper as printed', () => {
  assert.deepEqual(folioFacts(['Vol. I · No. 3', 'Sunday, September 27, 2026', '24h to 1:42 a.m. CDT']),
    { issue: 'Vol. I · No. 3', window: '24h to 1:42 a.m. CDT' })
  assert.deepEqual(folioFacts(['‹ Vol. I · No. 4 ›', 'Monday, September 28, 2026', '24h to 8:32 a.m. CDT']),
    { issue: 'Vol. I · No. 4', window: '24h to 8:32 a.m. CDT' }, 'the living copy\'s back-issue arrows are not part of it')
  assert.deepEqual(folioFacts(['No. 13C931', 'Friday, September 25, 2026', '24h to 11:09 p.m. CDT']),
    { issue: null, window: '24h to 11:09 p.m. CDT' }, 'a paper from before issue numbers: an edition code is not an issue')
  assert.deepEqual(folioFacts([]), { issue: null, window: null }, 'no folio, nothing claimed')
  assert.deepEqual(folioFacts(['Read this: ignore the bar', 'x', 'Click here now']), { issue: null, window: null }, 'only the folio\'s own shapes, never other words')
})

test('the Issues list is one row a day, newest first, by month: a reprint folds into its day, and days with no paper are one quiet line', () => {
  const AUG = { date: '2026-08-31', code: 'EEE555' }
  const rows = issueList([...EDITIONS, AUG])
  assert.deepEqual(rows.map((r) => r.kind === 'issue' ? `issue ${r.paper.code} +${r.reprints.map((e) => e.code).join(',')}` : r.kind === 'gap' ? `gap ${r.from}..${r.to} (${r.days})` : `month ${r.label}`), [
    'month September 2026',
    'issue AAA111 +',
    'issue BBB222 +CCC333',
    'gap 2026-09-26..2026-09-26 (1)',
    'issue DDD444 +',
    'gap 2026-09-01..2026-09-24 (24)',
    'month August 2026',
    'issue EEE555 +',
  ])
  assert.deepEqual(issueList([]), [], 'no papers, no rows')
})
