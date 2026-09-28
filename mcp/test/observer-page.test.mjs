// The Your papers page's decisions, as plain functions: how the header gives
// way while reading, which issue comes next, which issue the address names,
// and what the Issues drawer shuts off behind it. The page imports the same
// module from /assets/observer.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headState, stepIssue, issueFromAddress, addressFor, shutBehind } from '../pages/observer.js'

test('the header is whole at the top, a slim bar while reading on a desktop, and on a phone gone on the way down and back on the way up', () => {
  assert.equal(headState({ y: 0, lastY: 500, phone: false, now: 'slim' }), 'full', 'back at the top, the whole header')
  assert.equal(headState({ y: 39, lastY: 0, phone: true, now: 'full' }), 'full', 'a nudge is not reading yet')
  assert.equal(headState({ y: 400, lastY: 300, phone: false, now: 'full' }), 'slim')
  assert.equal(headState({ y: 300, lastY: 400, phone: false, now: 'slim' }), 'slim', 'on a desktop the bar stays either way')
  assert.equal(headState({ y: 400, lastY: 300, phone: true, now: 'slim' }), 'hidden', 'down on a phone: out of the way')
  assert.equal(headState({ y: 300, lastY: 400, phone: true, now: 'hidden' }), 'slim', 'up on a phone: the bar comes back')
  assert.equal(headState({ y: 402, lastY: 400, phone: true, now: 'hidden' }), 'hidden', 'a jitter changes nothing')
  assert.equal(headState({ y: 398, lastY: 400, phone: true, now: 'slim' }), 'slim')
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
