import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Where the connector keeps what it needs between calls: the corpus behind
// each digest it handed out (submit checks a page against exactly what its
// writer was given), and each reader's accepted editions for their Observer
// page. In memory here; a host swaps in its own store with the same methods.

export function memoryStore () {
  const corpora = new Map()
  const digests = new Map()
  const editions = new Map()
  return {
    keepCorpus (reader, corpus) { corpora.set(corpus.code, { reader, corpus }) },
    corpusFor (code) { return corpora.get(code) || null },
    keepDigest (code, parts) { digests.set(code, parts) },
    digestParts (code) { return digests.get(code) || null },
    putEdition (reader, entry) {
      const mine = editions.get(reader) || new Map()
      mine.set(entry.date, entry)
      editions.set(reader, mine)
    },
    edition (reader, date) { return editions.get(reader)?.get(date) || null },
    editions (reader) { return [...(editions.get(reader)?.values() || [])].sort((a, b) => b.date.localeCompare(a.date)) },
  }
}

// The same, with each accepted edition also written to disk: the page and its
// living copy, under the reader's key and the edition's date and code.
export function fileStore (dir) {
  const store = memoryStore()
  return {
    ...store,
    putEdition (reader, entry) {
      store.putEdition(reader, entry)
      const folder = join(dir, reader.slice(0, 16))
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, `${entry.date}-${entry.code}.html`), entry.html)
      writeFileSync(join(folder, `${entry.date}-${entry.code}.living.html`), entry.living)
    },
  }
}
