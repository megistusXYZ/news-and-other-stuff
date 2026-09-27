// Colour contrast as a rule. WCAG 2.2 AA (what the ADA is read against) asks
// 4.5:1 for body-size text and 3:1 for large text. The paper's colours are
// tokens, so the rule is checked on the tokens themselves, in light and dark,
// for the house palette and the Brainstorm brand: every pair of a text token
// and a ground it is printed on. The formula is the standard's; the pairs are
// the ones the stylesheets actually use.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// The declarations inside the first block whose selector matches exactly.
function tokens (css, selector) {
  const at = css.indexOf(`${selector} {`)
  assert.ok(at > -1, `no block for ${selector}`)
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]))
}

function rgba (value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1)
  const fn = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (fn) {
    const [r, g, b, a = '1'] = fn[1].split(',').map((s) => s.trim())
    return [Number(r), Number(g), Number(b), Number(a)]
  }
  throw new Error(`not a colour: ${value}`)
}
const over = (top, ground) => top.slice(0, 3).map((c, i) => c * top[3] + ground[i] * (1 - top[3])).concat(1)
function luminance ([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export function ratio (text, ground) {
  const g = rgba(ground)
  const t = over(rgba(text), g)
  const [a, b] = [luminance(t), luminance(g)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

test('the contrast formula agrees with the standard\'s own worked values', () => {
  assert.equal(ratio('#000000', '#FFFFFF').toFixed(1), '21.0')
  assert.equal(ratio('#767676', '#FFFFFF').toFixed(2), '4.54', 'the lightest grey that passes on white')
  assert.equal(ratio('#777777', '#FFFFFF').toFixed(2), '4.48')
})

const brand = read('../reference/brands/brainstorm/brand.css')
const light = tokens(brand, ':root[data-brand="brainstorm"]')
const dark = { ...light, ...tokens(brand, ':root[data-brand="brainstorm"][data-theme="dark"]') }

// Text tokens and the grounds they sit on, as the stylesheets use them.
const BODY_PAIRS = [
  ['--ink', '--paper'], ['--ink', '--paper-2'],
  ['--ink-2', '--paper'], ['--ink-2', '--paper-2'],
  ['--ink-3', '--paper'], ['--ink-3', '--paper-2'],
  ['--accent', '--paper'], ['--accent', '--paper-2'],
  ['--bs-teal', '--paper'], ['--bs-teal', '--paper-2'],
  ['--reverse-ink', '--reverse-bg'], ['--reverse-ink-2', '--reverse-bg'], ['--reverse-spot', '--reverse-bg'],
]

for (const [name, palette] of [['light', light], ['dark', dark]]) {
  test(`every Brainstorm text colour reads at 4.5:1 or better on its ground, ${name}`, () => {
    const failing = BODY_PAIRS
      .map(([text, ground]) => [text, ground, ratio(palette[text], palette[ground])])
      .filter(([, , r]) => r < 4.5)
      .map(([text, ground, r]) => `${text} on ${ground}: ${r.toFixed(2)}`)
    assert.deepEqual(failing, [])
  })
}

test('the Tabloid strap reads on its bar in the dark edition, the bar\'s tint laid over the paper', () => {
  const bar = over(rgba('rgba(114, 55, 255, .15)'), rgba(dark['--paper']))
  const barHex = '#' + bar.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
  assert.ok(ratio(dark['--reverse-ink-2'], barHex) >= 4.5, `${ratio(dark['--reverse-ink-2'], barHex).toFixed(2)}`)
})

const living = read('../reference/living.css')
const highLight = { ...light, ...tokens(living, 'html:root[data-lv-contrast="high"]:not([data-theme="dark"])') }
const highDark = { ...dark, ...tokens(living, 'html:root[data-lv-contrast="high"][data-theme="dark"]') }

for (const [name, palette] of [['light', highLight], ['dark', highDark]]) {
  test(`the reader's high-contrast setting reaches 7:1 (AAA) for every text colour, ${name}`, () => {
    const failing = BODY_PAIRS.filter(([text]) => !text.startsWith('--reverse'))
      .map(([text, ground]) => [text, ground, ratio(palette[text], palette[ground])])
      .filter(([, , r]) => r < 7)
      .map(([text, ground, r]) => `${text} on ${ground}: ${r.toFixed(2)}`)
    assert.deepEqual(failing, [])
  })
}

// The house palette, for a paper printed without a brand.
const house = read('../reference/house.css')
const houseLight = tokens(house, ':root')
const houseDark = { ...houseLight, ...tokens(house, ':root[data-theme="dark"]') }
const HOUSE_PAIRS = BODY_PAIRS.filter(([text]) => text !== '--bs-teal').concat([['--spot', '--paper']])
for (const [name, palette] of [['light', houseLight], ['dark', houseDark]]) {
  test(`every house text colour reads at 4.5:1 or better on its ground, ${name}`, () => {
    const failing = HOUSE_PAIRS
      .map(([text, ground]) => [text, ground, ratio(palette[text], palette[ground])])
      .filter(([, , r]) => r < 4.5)
      .map(([text, ground, r]) => `${text} on ${ground}: ${r.toFixed(2)}`)
    assert.deepEqual(failing, [])
  })
}
