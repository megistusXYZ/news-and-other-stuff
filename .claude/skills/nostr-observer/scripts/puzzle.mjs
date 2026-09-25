// The puzzle page, made here: a sudoku from the edition code.
//
// No service, no key, nothing fetched. The grid is a function of the edition
// code, so every reader of an edition gets the same puzzle, and the solution
// travels with it for the living copy to reveal on request. Uniqueness of the
// solution is not proved — this is a newspaper puzzle, not a competition —
// but every given is true and every line of the solution is complete.

/** A small seeded generator (mulberry32) so the same code gives the same grid. */
function rng (seed) {
  let h = 2166136261
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  let a = h >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffle = (list, random) => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `{ givens, solution }`, each 9×9, with 0 for an empty cell in the givens. */
export function sudoku (seed, givenCount = 32) {
  const random = rng(seed)
  // A valid base grid, then symmetry-preserving shuffles of it: rows within
  // bands, bands, columns within stacks, stacks, and the digits themselves.
  const base = (r, c) => (3 * (r % 3) + Math.floor(r / 3) + c) % 9
  const groups = () => shuffle([0, 1, 2], random).flatMap((g) => shuffle([0, 1, 2], random).map((i) => g * 3 + i))
  const rows = groups()
  const cols = groups()
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], random)
  const solution = rows.map((r) => cols.map((c) => digits[base(r, c)]))

  const givens = solution.map((row) => row.map(() => 0))
  const cells = shuffle(Array.from({ length: 81 }, (_, i) => i), random).slice(0, givenCount)
  for (const i of cells) givens[Math.floor(i / 9)][i % 9] = solution[Math.floor(i / 9)][i % 9]
  return { givens, solution }
}
