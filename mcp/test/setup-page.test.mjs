// The setup page's decisions, as plain functions: which of the three steps is
// open, and the one line a finished step folds down to. The page imports the
// same module from /assets/setup.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStep, paperLine } from '../pages/setup.js'

test('one step is open at a time: the first not yet done, or the one the reader chose; none once all three are done', () => {
  const none = { paper: false, connect: false, print: false }
  assert.equal(openStep({ done: none }), 'paper', 'a new reader starts at the beginning')
  assert.equal(openStep({ done: { ...none, paper: true } }), 'connect')
  assert.equal(openStep({ done: { paper: true, connect: true, print: false } }), 'print')
  assert.equal(openStep({ done: { paper: true, connect: true, print: true } }), null, 'all done: every step folded, the paper one tap away')
  assert.equal(openStep({ done: { paper: true, connect: true, print: true }, chosen: 'paper' }), 'paper', 'Edit opens a finished step')
  assert.equal(openStep({ done: none, chosen: 'print' }), 'print', 'a reader may look ahead; nothing is locked')
  assert.equal(openStep({ done: none, chosen: 'nonsense' }), 'paper', 'only a real step can be chosen')
})

test('a finished step folds to one line of what was chosen', () => {
  assert.equal(paperLine({ place: 'Chicago, Illinois, United States', teams: ['Chicago Cubs (Baseball)', 'Chicago Bulls (Basketball)'], topics: ['food', 'music', 'architecture', 'jazz'] }),
    'Chicago, Illinois, United States · 2 teams · 4 topics')
  assert.equal(paperLine({ place: null, teams: ['Chicago Cubs (Baseball)'], topics: ['jazz'] }), '1 team · 1 topic', 'what is missing is simply not said')
  assert.equal(paperLine({ place: null, teams: [], topics: [] }), 'The whole paper, no extras yet')
})
