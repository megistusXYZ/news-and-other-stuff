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
