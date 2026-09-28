// The page's layout, as the brief asks for it: advice for the writer, never a
// reason to refuse a page. validate.mjs is the boundary and stays about what
// can hurt a reader; this is about what looks unedited.

// The agate's text cells, which should end together. The Tape and Conditions
// are tables and may run shorter, so they are not counted.
const TEXT_CELLS = new Set(['Headlines', 'Broadcasting', 'Classifieds', 'What\'s On'])
const MOST_STATIONS = 6
// Items either side of the others before a column reads as running on.
const SPREAD = 2

const decode = (t) => t.replace(/&amp;/g, '&').replace(/&#39;|&apos;|’/g, '\'').trim()

/** The Wire's text cells and how many items each carries. */
function wireCells (html) {
  const at = html.search(/<div class="agate">/)
  if (at < 0) return []
  const end = html.indexOf('</section>', at)
  const agate = html.slice(at, end < 0 ? undefined : end)
  return agate.split(/<div class="cell">/).slice(1).map((body) => {
    const head = /<p class="box-head">([\s\S]*?)<\/p>/.exec(body)
    return { name: head ? decode(head[1]) : '', items: (body.match(/class="wire-item"/g) || []).length }
  }).filter((c) => TEXT_CELLS.has(c.name))
}

/** Notes on a Wire whose text cells do not end together. Empty when they do. */
export function wireBalance (html) {
  const cells = wireCells(html)
  const notes = []
  for (const c of cells) {
    if (c.name === 'Broadcasting' && c.items > MOST_STATIONS) {
      notes.push(`Broadcasting carries ${c.items} stations; six at most, the ones with something to say.`)
    }
  }
  const longest = Math.max(0, ...cells.map((c) => c.items))
  for (const c of cells) {
    if (longest - c.items > SPREAD) {
      notes.push(`${c.name} carries ${c.items} items beside ${longest}; fill it or cut its neighbour so the columns end together.`)
    }
  }
  return notes
}
