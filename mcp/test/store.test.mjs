// What the connector keeps, and for how long: a reader's papers are kept for
// thirty days, not forever, on disk as in memory.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { memoryStore, fileStore } from '../store.mjs'

const READER = 'aa'.repeat(32)
const NOW = Date.UTC(2026, 9, 1, 12) / 1000 // 2026-10-01
const paper = (date, code) => ({ date, code, html: '<p>page</p>', living: '<p>living</p>', printedAt: NOW })

test('papers are kept for thirty days: a new one sweeps out any older than that, from memory and from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-store-'))
  try {
    for (const store of [memoryStore({ keepDays: 30, now: () => NOW }), fileStore(dir, { keepDays: 30, now: () => NOW })]) {
      store.putEdition(READER, paper('2026-08-15', 'AAA111')) // 47 days old
      store.putEdition(READER, paper('2026-09-01', 'BBB222')) // 30 days old: still kept
      store.putEdition(READER, paper('2026-10-01', 'CCC333'))
      assert.deepEqual(store.editions(READER).map((e) => e.code), ['CCC333', 'BBB222'])
    }
    assert.deepEqual(readdirSync(join(dir, READER.slice(0, 16))).filter((n) => n.startsWith('2026-08-15')), [], 'nothing of the old paper left on disk')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
