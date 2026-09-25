// The daily five-letter word: the same word for every reader of a date,
// scored the way the form has been scored since Wordle, and shareable as a
// grid that gives nothing away.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dailyWord, score, shareGrid, accepts, dayNumber, shareNote, publishNote } from '../scripts/five.mjs'

const answers = ['about', 'above', 'abuse', 'actor', 'adapt', 'admit', 'adopt']
const guesses = ['about', 'above', 'abuse', 'actor', 'adapt', 'admit', 'adopt', 'bhara', 'crine']
const day = (n) => Date.UTC(2026, 0, 1 + n, 12) / 1000

test('one word a day, the same all day, every word once before any repeats', () => {
  assert.equal(dailyWord(day(3), answers), dailyWord(day(3) + 40_000, answers), 'the same at breakfast and at night')
  const seen = new Set(Array.from({ length: answers.length }, (_, n) => dailyWord(day(n), answers)))
  assert.equal(seen.size, answers.length, 'a run through the whole list, no word twice')
  assert.ok(answers.includes(dailyWord(day(11), answers)))
  assert.equal(dayNumber(day(0)), 1, 'the first day of 2026 is #1')
  assert.equal(dayNumber(day(267)), 268)
})

test('scoring: repeated letters are counted the way Wordle counts them', () => {
  assert.deepEqual(score('level', 'level'), ['hit', 'hit', 'hit', 'hit', 'hit'])
  assert.deepEqual(score('alley', 'level'), ['miss', 'near', 'near', 'hit', 'miss'])
  assert.deepEqual(score('babes', 'abbey'), ['near', 'near', 'hit', 'hit', 'miss'])
  assert.deepEqual(score('bobby', 'abbey'), ['near', 'miss', 'hit', 'miss', 'hit'], 'a second B has no B left to match')
  assert.deepEqual(score('speed', 'abide'), ['miss', 'miss', 'near', 'miss', 'near'])
  assert.deepEqual(score('ABIDE', 'abide'), ['hit', 'hit', 'hit', 'hit', 'hit'], 'case does not matter')
})

test('a guess must be a word; the answers are words too', () => {
  assert.equal(accepts('crine', guesses), true)
  assert.equal(accepts('zzzzz', guesses), false)
  assert.equal(accepts('abou', guesses), false)
})

test('the share grid names the game and the day, and shows only the pattern', () => {
  const rows = [score('speed', 'abide'), score('abide', 'abide')]
  assert.equal(shareGrid({ name: 'Five', day: 268, rows, won: true }), 'Five #268 2/6\n⬛⬛🟨⬛🟨\n🟩🟩🟩🟩🟩')
  assert.equal(shareGrid({ name: 'Five', day: 268, rows: [rows[0]], won: false }), 'Five #268 X/6\n⬛⬛🟨⬛🟨')
})

// --- sharing, 2026-09-25 ---------------------------------------------------------

test('the note a reader posts is the grid and a hashtag: never the word, never anything of the page', () => {
  const rows = [score('speed', 'abide'), score('abide', 'abide')]
  const note = shareNote({ name: 'Five', day: 268, rows, won: true }, 1790309349)
  assert.deepEqual(note, {
    kind: 1,
    created_at: 1790309349,
    tags: [['t', 'five']],
    content: 'Five #268 2/6\n⬛⬛🟨⬛🟨\n🟩🟩🟩🟩🟩\n\n#five',
  })
  assert.doesNotMatch(note.content, /abide|speed/i)
})

// A relay that says OK, one that refuses, one that never answers, and one that
// cannot be reached at all. Only the first counts as posted.
function fakeSockets (behaviour) {
  const sent = []
  class Socket {
    constructor (url) {
      if (behaviour[url] === 'unreachable') throw new Error('bad url')
      this.url = url
      setTimeout(() => this.onopen?.(), 0)
    }

    send (text) {
      sent.push([this.url, JSON.parse(text)])
      const [, event] = JSON.parse(text)
      const reply = behaviour[this.url]
      if (reply === 'silent') return
      setTimeout(() => {
        this.onmessage?.({ data: JSON.stringify(['OK', 'not-this-one', true, '']) })
        this.onmessage?.({ data: JSON.stringify(['OK', event.id, reply === 'ok', reply === 'ok' ? '' : reply]) })
      }, 0)
    }

    close () { this.closed = true }
  }
  return { Socket, sent }
}

test('posting sends the signed note to each relay and counts only the ones that say OK', async () => {
  const signed = { id: 'e'.repeat(64), kind: 1, content: 'Five #268 2/6', tags: [['t', 'five']], created_at: 1, pubkey: 'f'.repeat(64), sig: '0'.repeat(128) }
  const { Socket, sent } = fakeSockets({
    'wss://a': 'ok', 'wss://b': 'blocked: not on the allow list', 'wss://c': 'silent', 'wss://d': 'unreachable',
  })
  const result = await publishNote(['wss://a', 'wss://b', 'wss://c', 'wss://d'], signed, { WebSocket: Socket, timeout: 30 })
  assert.deepEqual(result.accepted, ['wss://a'])
  assert.deepEqual(result.refused, [
    { url: 'wss://b', reason: 'blocked: not on the allow list' },
    { url: 'wss://c', reason: 'no answer' },
    { url: 'wss://d', reason: 'unreachable' },
  ])
  assert.deepEqual(sent.map(([url, message]) => [url, message[0], message[1].id]), [
    ['wss://a', 'EVENT', signed.id], ['wss://b', 'EVENT', signed.id], ['wss://c', 'EVENT', signed.id],
  ], 'the same signed event, and nothing else, goes to every relay')
})

test('the living copy carries these functions byte for byte, so the page plays what is tested here', () => {
  const living = readFileSync(new URL('../reference/living.js', import.meta.url), 'utf8')
  for (const fn of [shareGrid, shareNote, publishNote]) assert.ok(living.includes(fn.toString()), `${fn.name} matches five.mjs`)
  assert.ok(living.includes("const TILE = { hit: '🟩', near: '🟨', miss: '⬛' }"))
})
