// Where the connector keeps what it needs between calls: the corpus behind
// each digest it handed out (submit checks a page against exactly what its
// writer was given), each reader's accepted editions for their Observer page,
// and when each reader's Claude last called a tool. In memory here; a host
// swaps in its own store with the same methods.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const newestFirst = (a, b) => b.date.localeCompare(a.date) || (b.printedAt || 0) - (a.printedAt || 0)

export function memoryStore () {
  const corpora = new Map()
  const digests = new Map()
  const editions = new Map()
  const calls = new Map()
  return {
    keepCorpus (reader, corpus) { corpora.set(corpus.code, { reader, corpus }) },
    corpusFor (code) { return corpora.get(code) || null },
    keepDigest (code, parts) { digests.set(code, parts) },
    digestParts (code) { return digests.get(code) || null },
    putEdition (reader, entry) {
      const mine = (editions.get(reader) || []).filter((e) => e.code !== entry.code)
      editions.set(reader, [...mine, { printedAt: Math.floor(Date.now() / 1000), ...entry }])
    },
    editions (reader) { return [...(editions.get(reader) || [])].sort(newestFirst) },
    edition (reader, date, code) { return this.editions(reader).find((e) => e.date === date && (!code || e.code === code)) || null },
    touch (reader) { calls.set(reader, { ...(calls.get(reader) || {}), at: Math.floor(Date.now() / 1000) }) },
    lastCall (reader) { return calls.get(reader)?.at || null },
    // The last step the reader's Claude took, for the setup page's progress.
    record (reader, step) { calls.set(reader, { at: Math.floor(Date.now() / 1000), step }) },
    lastStep (reader) { return calls.get(reader)?.step || null },
  }
}

// The same, with each accepted edition written to disk and read back from it:
// the page, its living copy and a small record, under the reader's key. What
// is on disk survives a restart; corpora and calls do not need to.
export function fileStore (dir) {
  const store = memoryStore()
  const folder = (reader) => join(dir, reader.slice(0, 16))
  const read = (reader, name) => readFileSync(join(folder(reader), name), 'utf8')
  return {
    ...store,
    putEdition (reader, entry) {
      const record = { printedAt: Math.floor(Date.now() / 1000), ...entry }
      mkdirSync(folder(reader), { recursive: true })
      const base = `${record.date}-${record.code}`
      writeFileSync(join(folder(reader), `${base}.html`), record.html)
      writeFileSync(join(folder(reader), `${base}.living.html`), record.living)
      const { html, living, ...meta } = record
      writeFileSync(join(folder(reader), `${base}.json`), JSON.stringify(meta, null, 2))
    },
    editions (reader) {
      if (!existsSync(folder(reader))) return []
      return readdirSync(folder(reader)).filter((n) => /^\d{4}-\d{2}-\d{2}-[0-9A-F]{6}\.living\.html$/.test(n)).map((n) => {
        const base = n.replace('.living.html', '')
        let meta = { date: base.slice(0, 10), code: base.slice(11), printedAt: Math.floor(statSync(join(folder(reader), n)).mtimeMs / 1000) }
        try { meta = { ...meta, ...JSON.parse(read(reader, `${base}.json`)) } } catch { /* an edition kept before records were */ }
        return { ...meta, get living () { return read(reader, n) }, get html () { return read(reader, `${base}.html`) } }
      }).sort(newestFirst)
    },
    edition (reader, date, code) { return this.editions(reader).find((e) => e.date === date && (!code || e.code === code)) || null },
  }
}
