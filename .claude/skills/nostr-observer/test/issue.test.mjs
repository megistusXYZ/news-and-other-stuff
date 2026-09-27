// The issue number: Vol. and No., counted from the reader's own first issue,
// the way a paper numbers itself. It comes from two dates and nothing else, so
// No. 3 always means the same morning, and a missed morning leaves a gap.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issueOf } from '../scripts/issue.mjs'

test('the first issue is Vol. I, No. 1, and each day after is one more', () => {
  assert.deepEqual(issueOf('2026-09-25', '2026-09-25'), { volume: 1, number: 1, label: 'Vol. I · No. 1' })
  assert.deepEqual(issueOf('2026-09-25', '2026-09-27'), { volume: 1, number: 3, label: 'Vol. I · No. 3' })
  assert.equal(issueOf('2026-09-25', '2026-10-25').number, 31, 'across a month')
  assert.equal(issueOf('2026-10-20', '2026-11-05').number, 17, 'across the clocks going back: days, not hours')
})

test('the volume turns on the anniversary of the first issue', () => {
  assert.equal(issueOf('2026-09-25', '2027-09-24').label, 'Vol. I · No. 365')
  assert.equal(issueOf('2026-09-25', '2027-09-25').label, 'Vol. II · No. 366')
  assert.equal(issueOf('2026-09-25', '2030-01-01').volume, 4)
  assert.equal(issueOf('2028-02-29', '2029-02-28').volume, 1, 'a leap-day paper waits for March')
  assert.equal(issueOf('2028-02-29', '2029-03-01').volume, 2)
  assert.equal(issueOf('2000-01-01', '2013-06-01').label.split(' · ')[0], 'Vol. XIV')
})

test('no issue from a date that is not one, or one before the paper began', () => {
  for (const [founded, date] of [['2026-09-25', '2026-09-24'], ['2026-02-30', '2026-03-01'], ['yesterday', '2026-09-25'], [null, '2026-09-25'], ['2026-09-25', undefined], ['2026-9-25', '2026-09-26']]) {
    assert.equal(issueOf(founded, date), null, `${founded} → ${date}`)
  }
})

// --- the arrows: yesterday's paper and tomorrow's -------------------------------

import { neighbours } from '../scripts/issue.mjs'

const file = (date, code, title = `News and Other Stuff — ${date}`) => ({ name: `observer-${date}-${code}.living.html`, title })

test('the issues either side are the nearest living copies of the same paper, by date', () => {
  const files = [
    file('2026-09-20', 'AAAAAA'), file('2026-09-25', '13C931', 'News and Other Stuff — Friday, September 25, 2026'),
    file('2026-09-27', '8FC05A'), file('2026-09-29', 'BBBBBB', 'News and Other Stuff — Tuesday, September 29, 2026'), file('2026-10-02', 'CCCCCC'),
  ]
  assert.deepEqual(neighbours(files, 'observer-2026-09-27-8FC05A.living.html', 'News and Other Stuff — Sunday, September 27, 2026'), {
    prev: { href: 'observer-2026-09-25-13C931.living.html', when: 'Friday, September 25, 2026' },
    next: { href: 'observer-2026-09-29-BBBBBB.living.html', when: 'Tuesday, September 29, 2026' },
  })
})

test('another paper in the same folder, a proof or a stray file is never a neighbour', () => {
  const files = [
    file('2026-09-26', 'DDDDDD', 'The Nostr Observer — Saturday, September 26, 2026'),
    { name: 'observer-2026-09-26-EEEEEE.html', title: 'News and Other Stuff — Saturday' },
    { name: 'observer-2026-09-26-FFFFFF.artifact.html', title: 'News and Other Stuff — Saturday' },
    { name: 'notes.living.html', title: 'News and Other Stuff — Saturday' },
    file('2026-09-27', '8FC05A'), file('2026-09-27', '999999'),
  ]
  assert.deepEqual(neighbours(files, 'observer-2026-09-27-8FC05A.living.html', 'News and Other Stuff — Sunday, September 27, 2026'), { prev: null, next: null },
    'a reprint of the same day is not the day before')
  assert.deepEqual(neighbours([], 'observer-2026-09-27-8FC05A.living.html', 'News and Other Stuff — Sunday'), { prev: null, next: null })
})
