// The puzzle: made on the reader's machine from the edition code, so every
// reader of an edition gets the same grid and nobody fetches anything.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sudoku } from '../scripts/puzzle.mjs'

const ok = (line) => new Set(line).size === 9 && line.every((n) => n >= 1 && n <= 9)

test('sudoku(seed) is a real sudoku: the solution is complete, the givens are a subset of it', () => {
  const { givens, solution } = sudoku('13C931')
  assert.equal(solution.length, 9)
  for (let i = 0; i < 9; i++) {
    assert.ok(ok(solution[i]), `row ${i}`)
    assert.ok(ok(solution.map((r) => r[i])), `column ${i}`)
    const b = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) b.push(solution[3 * Math.floor(i / 3) + r][3 * (i % 3) + c])
    assert.ok(ok(b), `box ${i}`)
  }
  let filled = 0
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (givens[r][c] !== 0) { filled++; assert.equal(givens[r][c], solution[r][c]) }
  }
  assert.ok(filled >= 28 && filled <= 36, `${filled} givens: a newspaper puzzle, not a hint sheet or a filled grid`)
})

test('the same edition code gives the same puzzle; another code, another puzzle', () => {
  assert.deepEqual(sudoku('13C931'), sudoku('13C931'))
  assert.notDeepEqual(sudoku('13C931').solution, sudoku('A1B2C3').solution)
})
