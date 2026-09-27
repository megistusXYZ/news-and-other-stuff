// Reading settings: text size, contrast and motion, chosen by the reader and
// kept on their device. What was saved is untrusted (another tab, an old
// version, a hand edit), so the function takes only what it recognises; what
// the reader has not chosen follows the device's own preferences. The page
// runs this function byte for byte.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readingSettings, READING_SIZES } from '../scripts/settings.mjs'

const plainDevice = { moreContrast: false, reducedMotion: false }

test('nothing saved: normal size, and contrast and motion as the device asks', () => {
  assert.deepEqual(readingSettings(null, plainDevice), { size: 100, contrast: 'standard', motion: 'full' })
  assert.deepEqual(readingSettings(undefined, { moreContrast: true, reducedMotion: true }), { size: 100, contrast: 'high', motion: 'reduced' })
})

test('what the reader chose wins over the device, both ways', () => {
  assert.deepEqual(readingSettings({ size: 125, contrast: 'high', motion: 'reduced' }, plainDevice), { size: 125, contrast: 'high', motion: 'reduced' })
  assert.deepEqual(readingSettings({ contrast: 'standard', motion: 'full' }, { moreContrast: true, reducedMotion: true }), { size: 100, contrast: 'standard', motion: 'full' },
    'a reader may turn the extra contrast or the stillness off again')
})

test('the sizes are four steps; anything else is the normal size', () => {
  assert.deepEqual(READING_SIZES, [100, 112, 125, 150])
  for (const size of [112, 150]) assert.equal(readingSettings({ size }, plainDevice).size, size)
  for (const size of [0, 99, 113, 400, '125', 'huge', -1, null]) assert.equal(readingSettings({ size }, plainDevice).size, 100, `${size}`)
})

test('a saved value that is not one of ours is ignored, and nothing else is taken from it', () => {
  const junk = { size: 112, contrast: 'neon', motion: 'wobbly', script: '<b>', __proto__: { size: 150 } }
  assert.deepEqual(readingSettings(junk, plainDevice), { size: 112, contrast: 'standard', motion: 'full' })
  assert.deepEqual(readingSettings('a string', plainDevice), { size: 100, contrast: 'standard', motion: 'full' })
  assert.deepEqual(readingSettings([150], plainDevice), { size: 100, contrast: 'standard', motion: 'full' })
})

test('the living copy carries the function byte for byte', () => {
  const living = readFileSync(new URL('../reference/living.js', import.meta.url), 'utf8')
  assert.ok(living.includes(readingSettings.toString()), 'readingSettings matches settings.mjs')
  assert.ok(living.includes('const READING_SIZES = [100, 112, 125, 150]'))
})
