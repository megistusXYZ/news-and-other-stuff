// Query construction and the two rules a filter cannot express.
//
// The search string is the entire product: `observer:<pk> sort:rank` with a
// floor is the paper, and bare `sort:rank` is the control. Getting either
// wrong produces a page that looks completely normal and is not the product.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DESKS, DEFAULT_TRUST_FLOOR, filterFor, belongs, parseImeta, shortlist } from '../scripts/corpus.mjs'

const OBSERVER = 'aa'.repeat(32)
const SOMEBODY = 'bb'.repeat(32)
const SINCE = 1_786_800_000
const UNTIL = 1_786_886_400

test('the observed query carries the observer, the sort and the floor', () => {
  const filter = filterFor([1], SINCE, UNTIL, 400, OBSERVER, 20)
  assert.equal(filter.search, `observer:${OBSERVER} sort:rank filter:rank:gte:20`)
})

test('the control run has NO observer and NO floor', () => {
  // Filtering the anonymous read would destroy the only comparison this
  // project makes. `include:spam` is the relay's auth-gate token, not a
  // filter: without it a bare `sort:rank` is CLOSED outright, and with it the
  // query is still the anonymous ranking (measured 2026-08-30).
  const filter = filterFor([1], SINCE, UNTIL, 400, null, 20)
  assert.equal(filter.search, 'include:spam sort:rank')
  assert.doesNotMatch(filter.search, /observer:|filter:rank/)
})

test('the window has BOTH ends', () => {
  // `until` was once carried all the way through and never put into a filter,
  // so a backdated run asked for "the 24 hours ending last Tuesday" and got
  // everything from last Monday to now instead.
  const filter = filterFor([1], SINCE, UNTIL, 400, OBSERVER, 20)
  assert.equal(filter.since, SINCE)
  assert.equal(filter.until, UNTIL)
})

test('the trust floor is 20, and it is not the same lever as limit', () => {
  assert.equal(DEFAULT_TRUST_FLOOR, 20)
  const tight = filterFor([1], SINCE, UNTIL, 10, OBSERVER, 50)
  assert.match(tight.search, /filter:rank:gte:50/)
  assert.equal(tight.limit, 10)
})

test('a live stream that has already ended is not a listing', () => {
  // Measured: of 18 in a 24-hour window, 11 were live and 7 had ended. A
  // filter cannot express "and the status tag says live".
  const live = DESKS.find((d) => d.key === 'live')
  const running = { id: '1', pubkey: SOMEBODY, tags: [['status', 'live']] }
  const finished = { id: '2', pubkey: SOMEBODY, tags: [['status', 'ended']] }
  assert.deepEqual(belongs(live, OBSERVER, [running, finished]).map((e) => e.id), ['1'])
})

test('the reader\'s own posts are not the news', () => {
  const notes = DESKS.find((d) => d.key === 'notes')
  const mine = { id: '1', pubkey: OBSERVER, tags: [] }
  const theirs = { id: '2', pubkey: SOMEBODY, tags: [] }
  assert.deepEqual(belongs(notes, OBSERVER, [mine, theirs]).map((e) => e.id), ['2'])
})

test('video asks for the deprecated kinds too, because that is where the video is', () => {
  // Measured on one 24-hour window at floor 20: kind 21 -> 0, kind 34235 -> 6;
  // kind 22 -> 0, kind 34236 -> 37. Asking only the current kinds prints none.
  assert.deepEqual(DESKS.find((d) => d.key === 'videos').kinds, [21, 34235])
  assert.deepEqual(DESKS.find((d) => d.key === 'shorts').kinds, [22, 34236])
  // Both halves of NIP-52: 31922 is all-day, 31923 is timed.
  assert.deepEqual(DESKS.find((d) => d.key === 'calendar').kinds, [31922, 31923])
})

test('no two desks share a kind', () => {
  // While the desks shared one REQ, two desks claiming the same kind collided
  // and the anonymous control run was filed as news.
  const seen = new Map()
  for (const desk of DESKS) {
    for (const kind of desk.kinds) {
      assert.equal(seen.has(kind), false, `kind ${kind} is on both ${seen.get(kind)} and ${desk.key}`)
      seen.set(kind, desk.key)
    }
  }
})

test('imeta is parsed as space-separated key/value inside each tag element', () => {
  const meta = parseImeta(['imeta', 'url https://ex.example/a.jpg', 'm image/jpeg', 'dim 1200x800', 'alt a cat'])
  assert.equal(meta.url, 'https://ex.example/a.jpg')
  assert.equal(meta.m, 'image/jpeg')
  assert.equal(meta.dim, '1200x800')
  assert.equal(meta.alt, 'a cat')
})

test('the shortlist filters on the declared MIME, not the URL suffix', () => {
  // imeta carries VIDEO as often as stills, and plenty of `.jpg` in a URL is a
  // redirect to something else.
  const events = {
    pictures: [
      { id: 'p1', kind: 20, pubkey: SOMEBODY, content: 'a still', tags: [['imeta', 'url https://ex.example/still.jpg', 'm image/jpeg', 'alt a still']] },
      { id: 'p2', kind: 20, pubkey: SOMEBODY, content: 'a clip', tags: [['imeta', 'url https://ex.example/clip.jpg', 'm video/mp4']] },
      { id: 'p3', kind: 20, pubkey: SOMEBODY, content: 'insecure', tags: [['imeta', 'url http://ex.example/plain.jpg', 'm image/jpeg']] },
    ],
  }
  const art = shortlist(events, {})
  assert.deepEqual(art.map((a) => a.url), ['https://ex.example/still.jpg'])
  assert.equal(art[0].id, 'art-1', 'ids are what the writer cites')
  assert.equal(art[0].alt, 'a still', 'alt is the difference between a caption and a gap')
})

test('the same URL is shortlisted once', () => {
  const tag = ['imeta', 'url https://ex.example/a.jpg', 'm image/jpeg']
  const art = shortlist({ pictures: [
    { id: 'p1', kind: 20, pubkey: SOMEBODY, content: '', tags: [tag] },
    { id: 'p2', kind: 20, pubkey: SOMEBODY, content: '', tags: [tag] },
  ] }, {})
  assert.equal(art.length, 1)
})

// --- the digest is the reader's context, and they pay for it every run -----

test('the digest is bounded, and says what it held back', async () => {
  const { fit, digest, DEFAULT_DIGEST_BUDGET } = await import('../scripts/corpus.mjs')
  const mk = (n, kind, len) => Array.from({ length: n }, (_, i) => ({
    id: String(i).padStart(64, '0'), pubkey: 'aa'.repeat(32), kind, created_at: 1_786_900_000, content: 'x'.repeat(len), tags: [],
  }))
  const desks = { notes: mk(400, 1, 280), articles: mk(100, 30023, 5000), calendar: mk(100, 31923, 300) }
  const { kept, trimmed } = fit(desks)

  assert.ok(Object.keys(trimmed).length > 0, 'a busy window should be trimmed')
  assert.ok(kept.notes.length >= 300, `notes must keep their floor, kept ${kept.notes.length}`)
  assert.ok(kept.articles.length < 100, 'long-form gives way before the notes do')

  const text = digest({ observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1, code: 'A', desks, control: [], overlap: 0, profiles: {}, art: [] })
  // NO SILENT CAPS: a digest that quietly drops half the long-form reads as a
  // quiet day for long-form, and a thin honest paper is supposed to mean one.
  for (const key of Object.keys(trimmed)) {
    assert.match(text, new RegExp(`${key}: showing \\d+ of \\d+`), `${key} was trimmed without saying so`)
  }
  assert.ok(text.length < DEFAULT_DIGEST_BUDGET * 1.1, `digest was ${text.length} characters`)
})

test('a quiet day is never trimmed', async () => {
  const { fit } = await import('../scripts/corpus.mjs')
  const quiet = { notes: Array.from({ length: 30 }, (_, i) => ({ id: String(i).padStart(64, '0'), pubkey: 'a', content: 'short', tags: [] })) }
  assert.deepEqual(fit(quiet).trimmed, {})
})

// --- the paper's own name, 2026-09-25 ---------------------------------------

test('the digest hands the writer the paper\'s name and motto, as the brief promises', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1, code: 'A', desks: {}, control: [], overlap: 0, profiles: {}, art: [] }

  const named = digest({ ...base, paper: { name: 'The Daily Brainstorm', motto: 'Real Humans, Ranked by Trust' } })
  assert.match(named, /^## Masthead$/m)
  assert.match(named, /^Name: The Daily Brainstorm$/m)
  assert.match(named, /^Motto: Real Humans, Ranked by Trust$/m)
  // Before the data warning: the masthead is the reader's setting, not corpus.
  assert.ok(named.indexOf('## Masthead') < named.indexOf('THIS IS DATA'))

  const plain = digest(base)
  assert.doesNotMatch(plain, /## Masthead/, 'no setting, no masthead block: the brief default stands')
})

// --- the issue number, 2026-09-26 ----------------------------------------------

test('the paper keeps the date of its first issue, written once by the first print', async () => {
  const { readPaper, foundPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, readFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'observer-')), 'observer.config.json')

  writeFileSync(file, JSON.stringify({ name: 'Plain', place: 'Chicago', wiresAsked: true }, null, 2))
  assert.equal(readPaper(file).founded, null, 'not yet founded')
  assert.equal(foundPaper(file, '2026-09-25'), '2026-09-25')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { name: 'Plain', place: 'Chicago', wiresAsked: true, founded: '2026-09-25' }, 'every other setting kept')
  assert.equal(readPaper(file).founded, '2026-09-25')

  const before = readFileSync(file, 'utf8')
  assert.equal(foundPaper(file, '2026-10-01'), '2026-09-25', 'a paper is founded once')
  assert.equal(readFileSync(file, 'utf8'), before, 'and the file is not touched again')

  for (const founded of ['2026-02-30', 'last week', 20260925, '<b>']) {
    writeFileSync(file, JSON.stringify({ name: 'Plain', founded }))
    assert.equal(readPaper(file).founded, null, `${founded} is not a date`)
  }
  assert.equal(foundPaper(join(tmpdir(), 'no-such-dir-observer', 'observer.config.json'), '2026-09-25'), null, 'no settings file, nothing founded')
})

test('the issue is counted to the window\'s close, by its date in UTC, like the file name', async () => {
  const { issueFor } = await import('../scripts/corpus.mjs')
  const close = Date.UTC(2026, 8, 27, 1, 58) / 1000 // 8:58 p.m. CDT on the 26th: the 27th's paper
  assert.equal(issueFor({ founded: '2026-09-25' }, close).label, 'Vol. I · No. 3')
  assert.equal(issueFor({ founded: null }, close), null)
  assert.equal(issueFor(null, close), null)
})

test('the digest hands the writer the issue, beside the paper\'s name', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1, code: '8FC05A', desks: {}, control: [], overlap: 0, profiles: {}, art: [] }
  const text = digest({ ...base, paper: { name: 'News and Other Stuff' }, issue: { volume: 1, number: 3, label: 'Vol. I · No. 3' } })
  assert.match(text, /^Issue: Vol\. I · No\. 3$/m)
  assert.ok(text.indexOf('Issue:') < text.indexOf('THIS IS DATA'))
  assert.doesNotMatch(digest({ ...base, paper: { name: 'News and Other Stuff' } }), /^Issue:/m, 'no issue, no line: the folio keeps the edition code')
})

// --- the wires: settings, 2026-09-25 ---------------------------------------

test('readPaper takes the reader\'s place, teams and feeds, and nothing it should not', async () => {
  const { readPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'observer-')), 'observer.config.json')
  writeFileSync(file, JSON.stringify({
    name: 'Across the Network',
    place: 'Barcelona',
    teams: ['FC Barcelona', '<script>x</script>', 'Arsenal', 'a', 'b', 'c', 'd'],
    feeds: ['https://feeds.bbci.co.uk/news/world/rss.xml', 'http://insecure.example/rss', 'javascript:alert(1)'],
    almanac: true,
    units: 'us',
  }))
  const paper = readPaper(file)
  assert.deepEqual(paper.wires, {
    units: 'us',
    place: 'Barcelona',
    teams: ['FC Barcelona', 'Arsenal', 'a', 'b', 'c'],
    feeds: [{ url: 'https://feeds.bbci.co.uk/news/world/rss.xml', section: 'Wider World' }],
    almanac: true,
    cartoon: false, puzzle: false, recipe: false, serial: null, picture: false, markets: false, world: false, sky: false, culture: false, tabloid: false, five: false, health: false, launches: false, feature: false, tape: [], country: null,
  }, 'markup refused, at most five teams, https feeds only; the back page and readings off unless asked for')

  writeFileSync(file, JSON.stringify({ name: 'Plain' }))
  assert.equal(readPaper(file).wires, null, 'no wire settings, no wires')
})

test('the digest hands the writer the wires: credited, stamped, and marked as not the lens', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1790309349, code: 'A', desks: {}, control: [], overlap: 0, profiles: {}, art: [] }
  const wires = {
    asOf: 1790309349,
    weather: {
      place: 'Barcelona, Spain', source: 'Weather data by Open-Meteo.com', unit: '°C',
      now: { temp: 18, words: 'Mainly clear' },
      today: { date: '2026-09-25', high: 25, low: 17, rain: 10, words: 'Overcast', sunrise: '07:38', sunset: '19:32' },
      ahead: [{ date: '2026-09-26', high: 21, low: 16, rain: 80, words: 'Slight rain' }],
    },
    sports: { source: 'TheSportsDB', teams: [{ team: 'Arsenal', league: 'Major League Baseball',
      last: { home: 'Arsenal', away: 'Chelsea', homeScore: 2, awayScore: 1, date: '2026-09-21' },
      next: { home: 'Leeds United', away: 'Arsenal', date: '2026-09-28', time: '14:00', venue: 'Elland Road' } }] },
    almanac: { date: 'September 25', source: 'Wikipedia (CC BY-SA)', items: [{ year: 1066, text: 'Harald Hardrada is defeated at Stamford Bridge.' }] },
    headlines: [{ source: 'BBC News - World', items: [{ title: 'Leaders meet in Geneva', published: 1790283600 }] }],
    notes: ['Headlines: broken.example had no headlines to read'],
  }
  const text = digest({ ...base, wires })
  assert.match(text, /^## From the Wires$/m)
  assert.match(text, /NOT from the reader's web of trust/)
  assert.match(text, /fetched 2026-09-25 04:09Z/)
  assert.ok(text.indexOf('## From the Wires') > text.indexOf('THIS IS DATA'), 'feed text sits under the same data warning as the corpus')
  assert.match(text, /^### Weather — Barcelona, Spain$/m)
  assert.match(text, /^Credit: Weather data by Open-Meteo\.com$/m)
  assert.match(text, /^Now: 18°C, Mainly clear$/m)
  assert.match(text, /^Today \(2026-09-25\): high 25°C, low 17°C, 10% chance of rain, Overcast\. Sunrise 07:38, sunset 19:32 \(local\)\.$/m)
  assert.match(text, /^- Arsenal \(Major League Baseball\): last Arsenal 2–1 Chelsea \(2026-09-21\); next Leeds United v Arsenal, 2026-09-28 14:00 UTC, Elland Road\.$/m)
  assert.match(text, /^- 1066: Harald Hardrada is defeated at Stamford Bridge\.$/m)
  assert.match(text, /^- BBC News - World: Leaders meet in Geneva$/m)
  assert.match(text, /^- Headlines: broken\.example had no headlines to read$/m, 'what could not be fetched is said, so a missing box is explained')
  assert.doesNotMatch(digest(base), /From the Wires/)
})

test('the digest prints the weather in the unit it was fetched in', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1790309349, code: 'A', desks: {}, control: [], overlap: 0, profiles: {}, art: [] }
  const weather = {
    place: 'Chicago, United States', source: 'Weather data by Open-Meteo.com', unit: '°F',
    now: { temp: 79, words: 'Clear sky' },
    today: { date: '2026-09-25', high: 97, low: 79, rain: 2, words: 'Overcast', sunrise: '07:21', sunset: '19:23' },
    ahead: [{ date: '2026-09-26', high: 95, low: 73, rain: 2, words: 'Overcast' }],
  }
  const text = digest({ ...base, wires: { asOf: 1790309349, weather, sports: null, almanac: null, headlines: [], notes: [] } })
  assert.match(text, /^Now: 79°F, Clear sky$/m)
  assert.match(text, /^Today \(2026-09-25\): high 97°F, low 79°F,/m)
  assert.match(text, /^2026-09-26: high 95°F, low 73°F,/m)
})

test('the digest hands the writer the back page and the readings: credited, and pictures only as art ids', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1790309349, code: 'A', desks: {}, control: [], overlap: 0, profiles: {}, art: [] }
  const wires = {
    asOf: 1790309349, sports: null, almanac: null, headlines: [], notes: [], art: [],
    weather: { place: 'Chicago, United States', country: 'US', source: 'Weather data by Open-Meteo.com', unit: '°F',
      now: { temp: 80, words: 'Clear sky' }, today: { date: '2026-09-25', high: 97, low: 78, rain: 2, words: 'Overcast', sunrise: '07:21', sunset: '19:23' }, ahead: [],
      air: { index: 55, scale: 'US AQI', words: 'Moderate' }, moon: { words: 'Full moon', illumination: 100 } },
    cartoon: { title: 'Voyager Instruments', caption: 'Convincing him to turn off the instruments.', number: 3302, art: 'art-41', source: 'xkcd.com, CC BY-NC 2.5' },
    puzzle: { givens: [[5, 3, 0, 0, 7, 0, 0, 0, 0], ...Array.from({ length: 8 }, () => [0, 0, 0, 0, 0, 0, 0, 0, 0])], solution: [] },
    recipe: { name: 'Thai-style steamed fish', kind: 'Thai · Seafood', ingredients: [{ item: 'Fish fillets', measure: '2' }, { item: 'Ginger', measure: '1 thumb' }], method: 'Steam for 12 minutes.', art: 'art-43', source: 'TheMealDB' },
    serial: { title: 'Pride and Prejudice', author: 'Jane Austen', id: 1342, instalment: 12, of: 210, text: 'It is a truth universally acknowledged.', source: 'Project Gutenberg, public domain' },
    picture: { caption: 'Lake Bab Louta, Morocco.', artist: 'Timothy A. Gonsalves', licence: 'CC BY-SA 4.0', art: 'art-42', source: 'Wikimedia Commons' },
    markets: { bitcoin: { usd: 84065, eur: 73709, gbp: 63349 }, fees: { fastest: 2, hour: 1 }, height: 968554, fx: { base: 'USD', date: '2026-09-24', rates: { EUR: 0.8797, GBP: 0.7565, JPY: 158.85, CHF: 0.8278 } }, source: 'mempool.space; ECB via Frankfurter' },
    world: { quakes: { count: 3, strongest: { magnitude: 6.3, place: '45 km SW of Ovalle, Chile' }, source: 'USGS' }, holiday: { date: '2026-10-12', name: 'Columbus Day', country: 'US', source: 'Nager.Date' } },
  }
  const text = digest({ ...base, wires })
  assert.match(text, /^Air: 55 on the US AQI, Moderate\. Moon: Full moon, 100% lit\.$/m)
  assert.match(text, /^### The Back Page$/m)
  assert.match(text, /^Cartoon \(art-41\): Voyager Instruments — Convincing him to turn off the instruments\. Credit: xkcd\.com, CC BY-NC 2\.5$/m)
  assert.match(text, /^Puzzle: a sudoku from this edition's code\. Print it as <pre class="sudoku"> with these nine lines exactly \(\. is empty\):$/m)
  assert.match(text, /^53\.\.7\.\.\.\.$/m)
  assert.match(text, /^Recipe \(art-43\): Thai-style steamed fish — Thai · Seafood\. Credit: TheMealDB$/m)
  assert.match(text, /^Ingredients: 2 Fish fillets; 1 thumb Ginger$/m)
  assert.match(text, /^Serial: Pride and Prejudice, by Jane Austen — instalment 12 of 210\. Credit: Project Gutenberg, public domain$/m)
  assert.match(text, /^It is a truth universally acknowledged\.$/m)
  assert.match(text, /^Picture of the day \(art-42\): Lake Bab Louta, Morocco\. Credit: Timothy A\. Gonsalves, CC BY-SA 4\.0, Wikimedia Commons$/m)
  assert.match(text, /^Bitcoin \$84,065 · €73,709 · £63,349\. Next-block fee 2 sat\/vB, 1 within the hour\. Block height 968,554\.$/m)
  assert.match(text, /^USD, ECB 2026-09-24: EUR 0\.8797 · GBP 0\.7565 · JPY 158\.85 · CHF 0\.8278$/m)
  assert.match(text, /^Earthquakes, magnitude 4\.5\+, past day: 3; strongest 6\.3, 45 km SW of Ovalle, Chile\.$/m)
  assert.match(text, /^Next public holiday \(US\): Columbus Day, 2026-10-12\.$/m)
  assert.doesNotMatch(text, /https?:\/\//, 'no URL reaches the writer from the wires: pictures are ids')
})

test('readPaper takes the back page and the readings as switches, and the serial as a Gutenberg number', async () => {
  const { readPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'observer-')), 'observer.config.json')
  writeFileSync(file, JSON.stringify({ place: 'Chicago', cartoon: true, puzzle: true, recipe: true, serial: 1342, picture: true, markets: true, world: true, sky: true, country: 'US', tabloid: true, five: true, health: true, launches: true, feature: true }))
  const w = readPaper(file).wires
  assert.deepEqual({ cartoon: w.cartoon, puzzle: w.puzzle, recipe: w.recipe, serial: w.serial, picture: w.picture, markets: w.markets, world: w.world, sky: w.sky, country: w.country, tabloid: w.tabloid, five: w.five, health: w.health, launches: w.launches, feature: w.feature },
    { cartoon: true, puzzle: true, recipe: true, serial: 1342, picture: true, markets: true, world: true, sky: true, country: 'US', tabloid: true, five: true, health: true, launches: true, feature: true })
  writeFileSync(file, JSON.stringify({ place: 'Chicago', serial: 'https://evil.example/book.txt', country: 'united states' }))
  const bad = readPaper(file).wires
  assert.equal(bad.serial, null, 'a serial is a Gutenberg number, never an address')
  assert.equal(bad.country, null, 'a country is a two-letter code')
})

test('a feed may name its section, so entertainment lands under Culture and not among the world news', async () => {
  const { readPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'observer-')), 'observer.config.json')
  writeFileSync(file, JSON.stringify({ feeds: [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    { url: 'https://variety.com/feed/', section: 'Culture' },
    { url: 'https://pitchfork.com/rss/news/', section: '<b>Music</b>' },
    { url: 'http://insecure.example/feed', section: 'Culture' },
    { section: 'Culture' },
  ], culture: true }))
  const w = readPaper(file).wires
  assert.deepEqual(w.feeds, [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', section: 'Wider World' },
    { url: 'https://variety.com/feed/', section: 'Culture' },
    { url: 'https://pitchfork.com/rss/news/', section: 'Wider World' },
  ], 'a plain address is world news; a section with markup falls back; no address, no feed')
  assert.equal(w.culture, true)
})

test('the digest groups the outside headlines by section, and prints what the world looked up', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1790309349, code: 'A', desks: {}, control: [], overlap: 0, profiles: {}, art: [] }
  const wires = { asOf: 1790309349, weather: null, sports: null, almanac: null, notes: [], art: [],
    headlines: [
      { source: 'BBC News', section: 'Wider World', items: [{ title: 'Leaders meet in Geneva', published: null }] },
      { source: 'Variety', section: 'Culture', items: [{ title: 'A sequel nobody asked for tops the box office', published: null }] },
      { source: 'NPR', section: 'Wider World', items: [{ title: 'Storms in the south', published: null }] },
    ],
    lookedUp: { date: '2026-09-24', items: [{ title: 'Lizzie Borden', views: 479143, about: 'American woman acquitted of murder' }, { title: 'Elizabeth Holmes', views: 220098, about: null }], source: 'Wikipedia' },
  }
  const text = digest({ ...base, wires })
  const at = (h) => text.indexOf(h)
  assert.ok(at('### Wider World') > -1 && at('### Culture') > -1 && at('### Looked up') > -1)
  assert.match(text, /^- BBC News: Leaders meet in Geneva$/m)
  assert.match(text, /^- Variety: A sequel nobody asked for tops the box office$/m)
  assert.ok(at('- Variety:') > at('### Culture') && at('- Variety:') < at('### Looked up'), 'under Culture')
  assert.ok(at('- NPR:') > at('### Wider World') && at('- NPR:') < at('### Culture'), 'under Wider World, whatever the order of the feeds')
  assert.match(text, /^Credit: Wikipedia, most-read pages of 2026-09-24$/m)
  assert.match(text, /^- Lizzie Borden \(479,143 views\): American woman acquitted of murder$/m)
  assert.match(text, /^- Elizabeth Holmes \(220,098 views\)$/m)
})

test('the digest prints the tabloid apart, loud about what it is not', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1790309349, code: 'A', desks: {}, control: [], overlap: 0, profiles: {}, art: [] }
  const wires = { asOf: 1790309349, weather: null, sports: null, almanac: null, headlines: [], notes: [], art: [],
    tabloid: {
      searching: { geo: 'US', source: 'Google Trends', items: [{ term: 'Angela Bassett', traffic: '1,000+', story: 'David Jonsson Shares First Look' }, { term: 'F1 Qualifying', traffic: '200,000+', story: null }] },
      saying: { source: 'Bluesky', items: [{ topic: 'U2 announces new album', about: 'The album features guests.', category: 'entertainment', posts: 221 }] },
    } }
  const text = digest({ ...base, wires })
  assert.match(text, /^### The Tabloid$/m)
  assert.match(text, /not ranked by anyone the reader trusts/i)
  assert.match(text, /^Searching \(Google Trends, US\):$/m)
  assert.match(text, /^1\. Angela Bassett — 1,000\+ searches — David Jonsson Shares First Look$/m)
  assert.match(text, /^2\. F1 Qualifying — 200,000\+ searches$/m)
  assert.match(text, /^Saying \(Bluesky\):$/m)
  assert.match(text, /^1\. U2 announces new album — The album features guests\. \(entertainment, 221 posts\)$/m)
})

// --- kick-offs in the reader's own time, 2026-09-25 ------------------------------

test('a kick-off is printed in the reader\'s time zone: 12-hour for a US paper, 24-hour elsewhere', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { code: 'ABC123', since: 1790222949, until: 1790309349, desks: {}, control: [], profiles: {}, art: [] }
  const team = (name, date, time, venue) => ({ team: name, league: null, last: null, next: { home: name, away: 'Visitors', date, time, venue } })
  const sports = { source: 'TheSportsDB', teams: [
    team('Northwestern Wildcats', '2026-09-26', '16:00', 'Neyland Stadium'),
    team('Chicago Fire', '2026-09-27', '00:30', 'Soldier Field'),
  ] }
  const chicago = { place: 'Chicago, United States', unit: '°F', timezone: 'America/Chicago', source: 'x', now: { temp: 97, words: 'Clear' }, today: { date: '2026-09-25', high: 97, low: 78, rain: 0, words: 'Clear', sunrise: '07:21', sunset: '19:23' }, ahead: [] }
  const us = digest({ ...base, wires: { asOf: 1790309349, weather: chicago, sports, almanac: null, headlines: [], notes: [] } })
  assert.match(us, /next Northwestern Wildcats v Visitors, Saturday, September 26, 11:00 a\.m\. CDT, Neyland Stadium\./)
  assert.match(us, /next Chicago Fire v Visitors, Saturday, September 26, 7:30 p\.m\. CDT, Soldier Field\./, 'a late kick-off in UTC is the evening before in Chicago')

  const london = { ...chicago, place: 'London, United Kingdom', unit: '°C', timezone: 'Europe/London' }
  const gb = digest({ ...base, wires: { asOf: 1790309349, weather: london, sports, almanac: null, headlines: [], notes: [] } })
  assert.match(gb, /next Northwestern Wildcats v Visitors, Saturday 26 September, 17:00 BST, Neyland Stadium\./)
})

// --- the digest's clock is the reader's, 2026-09-25 ---------------------------------

test('with the reader\'s time zone known, every time in the digest is theirs, labelled; without it, UTC as before', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const note = { id: 'e'.repeat(64), kind: 1, pubkey: 'f'.repeat(64), created_at: 1790262780, tags: [], content: 'hello' }
  const base = { code: 'ABC123', since: 1790222949, until: 1790309349, desks: { notes: [note] }, control: [], profiles: {}, art: [] }
  const chicago = { place: 'Chicago', unit: '°F', timezone: 'America/Chicago', source: 'x', now: { temp: 1, words: 'x' }, today: { date: '2026-09-25', high: 1, low: 1, rain: 0, words: 'x', sunrise: '07:21', sunset: '19:23' }, ahead: [] }
  const wires = { asOf: 1790342880, weather: chicago, sports: null, almanac: null, headlines: [], notes: [] }

  const us = digest({ ...base, wires })
  assert.match(us, /^Window: 2026-09-23 11:09 p\.m\. CDT to 2026-09-24 11:09 p\.m\. CDT \(24 hours, fixed\)\.$/m)
  assert.match(us, /· 2026-09-24 10:13 a\.m\. CDT$/m, 'a post\'s time')
  assert.match(us, /fetched 2026-09-25 8:28 a\.m\. CDT/)

  const gb = digest({ ...base, wires: { ...wires, weather: { ...chicago, unit: '°C', timezone: 'Europe/London' } } })
  assert.match(gb, /^Window: 2026-09-24 05:09 BST to 2026-09-25 05:09 BST/m)

  const none = digest(base)
  assert.match(none, /^Window: 2026-09-24 04:09Z to 2026-09-25 04:09Z/m, 'no wires, no zone: UTC as before')
})

test('a paper can carry a stamp beside its nameplate, named like its brand', async () => {
  const { readPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'paper-')), 'observer.config.json')
  writeFileSync(file, JSON.stringify({ name: 'News and Other Stuff', stamp: 'ostrich' }))
  assert.equal(readPaper(file).stamp, 'ostrich')
  writeFileSync(file, JSON.stringify({ name: 'News and Other Stuff', stamp: '../../etc/passwd' }))
  assert.equal(readPaper(file).stamp, null, 'a stamp is a name, never a path')
})

test('a paper can name a second stamp for its dark edition, a name like the first', async () => {
  const { readPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'paper-')), 'observer.config.json')
  writeFileSync(file, JSON.stringify({ name: 'N', stamp: 'ostrich-portrait', stampDark: 'ostrich-profile' }))
  assert.equal(readPaper(file).stampDark, 'ostrich-profile')
  writeFileSync(file, JSON.stringify({ name: 'N', stamp: 'ostrich-portrait', stampDark: '/tmp/x.webp' }))
  assert.equal(readPaper(file).stampDark, null, 'a name, never a path')
})

test('a paper can carry its publisher\'s imprint: a name, an https address and a logo by name', async () => {
  const { readPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'paper-')), 'observer.config.json')
  writeFileSync(file, JSON.stringify({ name: 'N', imprint: { name: 'Megistus', url: 'https://www.megistus.xyz', logo: 'megistus' } }))
  assert.deepEqual(readPaper(file).imprint, { name: 'Megistus', url: 'https://www.megistus.xyz', logo: 'megistus' })
  writeFileSync(file, JSON.stringify({ name: 'N', imprint: { name: 'X', url: 'javascript:alert(1)', logo: '../x' } }))
  assert.equal(readPaper(file).imprint, null, 'an https address and a logo name, or no imprint at all')
})

test('the digest hands the writer a health box and the launches, in the reader\'s clock, credited; none fetched, none printed', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const base = { code: 'ABC123', since: 1790222949, until: 1790309349, desks: { notes: [] }, control: [], profiles: {}, art: [] }
  const chicago = { place: 'Chicago', unit: '°F', timezone: 'America/Chicago', source: 'x', now: { temp: 1, words: 'x' }, today: { date: '2026-09-25', high: 1, low: 1, rain: 0, words: 'x', sunrise: '07:21', sunset: '19:23' }, ahead: [] }
  const health = {
    place: 'Chicago',
    uv: { max: 9, level: 'very high', from: '11:00', to: '16:00' },
    alerts: [{ event: 'Heat Advisory', headline: 'Heat Advisory issued September 25 at 3:12AM CDT until September 25 at 8:00PM CDT by NWS Chicago IL' }],
    foodRecalls: [{ product: 'Frozen spinach, 12 oz bags', firm: 'Green Acre Foods', date: '2026-09-23', reason: 'Listeria monocytogenes' }],
    productRecalls: [{ title: 'Acme Space Heaters Recalled Due to Fire Hazard', date: '2026-09-24' }],
    source: 'Open-Meteo · National Weather Service · openFDA · CPSC',
  }
  const launches = { source: 'The Space Devs, Launch Library 2', next: [{ rocket: 'Falcon 9 Block 5', mission: 'Starlink Group 10-12', provider: 'SpaceX', place: 'Cape Canaveral, FL, USA', at: 1790383140, status: 'Go' }] }
  const wires = { asOf: 1790342880, weather: chicago, sports: null, almanac: null, headlines: [], notes: [], health, launches }

  const out = digest({ ...base, wires })
  assert.match(out, /^### Health & Safety — Chicago$/m)
  assert.match(out, /^Credit: Open-Meteo · National Weather Service · openFDA · CPSC$/m)
  assert.match(out, /^UV index: 9, very high; highest from 11 a\.m\. to 4 p\.m\.$/m, 'hours in the reader\'s 12-hour clock')
  assert.match(out, /^Weather alert: Heat Advisory — Heat Advisory issued September 25/m)
  assert.match(out, /^Food recall \(FDA Class I, 2026-09-23\): Frozen spinach, 12 oz bags — Green Acre Foods\. Listeria monocytogenes\.$/m)
  assert.match(out, /^Product recall \(CPSC, 2026-09-24\): Acme Space Heaters Recalled Due to Fire Hazard\.$/m)
  assert.match(out, /^### Launches$/m)
  assert.match(out, /^- Falcon 9 Block 5, Starlink Group 10-12 \(SpaceX\), from Cape Canaveral, FL, USA: 2026-09-25 7:39 p\.m\. CDT, Go\.$/m)

  const quiet = digest({ ...base, wires: { ...wires, health: { ...health, uv: { max: 1, level: 'low', from: null, to: null }, alerts: [], foodRecalls: [], productRecalls: [] } } })
  assert.match(quiet, /^UV index: 1, low\.$/m)
  assert.match(quiet, /^No weather alerts in force\.$/m, 'said outright, so a quiet day is not read as missing data')

  const gb = digest({ ...base, wires: { ...wires, weather: { ...chicago, unit: '°C', timezone: 'Europe/London' }, health: { ...health, source: 'Open-Meteo', alerts: [], foodRecalls: [], productRecalls: [] } } })
  assert.match(gb, /^UV index: 9, very high; highest from 11:00 to 16:00$/m, '24-hour clock outside the US')
  assert.doesNotMatch(gb, /weather alerts/, 'no US alert service, nothing said about alerts')

  const none = digest({ ...base, wires: { ...wires, health: null, launches: null } })
  assert.doesNotMatch(none, /Health & Safety|### Launches/)
})

test('the digest tells the writer how long each article is, its own summary, and its picture, for the Long Reads', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
  const long = { id: '3'.repeat(64), kind: 30023, pubkey: '4'.repeat(64), created_at: 1790262780, content: words(2300),
    tags: [['d', 'unknown-difficulty'], ['title', 'The Unknown Difficulty'], ['summary', 'Why the hardest part of mining is the part nobody measures.'], ['image', 'https://img.example/a.jpg']] }
  const short = { id: '5'.repeat(64), kind: 30023, pubkey: '4'.repeat(64), created_at: 1790262790, content: words(120), tags: [['d', 'note'], ['title', 'A Short One']] }
  const corpus = { code: 'ABC123', since: 1790222949, until: 1790309349, desks: { articles: [long, short] }, control: [], profiles: { ['4'.repeat(64)]: { name: 'Roger' } },
    art: [{ id: 'art-7', url: 'https://img.example/a.jpg', eventId: long.id, byline: 'Roger' }] }
  const out = digest(corpus)
  assert.match(out, /title: The Unknown Difficulty\n  read: 10 min · picture: art-7\n  summary: Why the hardest part of mining is the part nobody measures\./)
  assert.match(out, /title: A Short One\n  read: 1 min\n/, 'no summary or picture, none claimed')
})

test('an article\'s cover picture is shortlisted for the Long Reads, beyond the cap, up to six', async () => {
  const { shortlist } = await import('../scripts/corpus.mjs')
  const pic = (i) => ({ id: `p${i}`.padEnd(64, '0'), kind: 20, pubkey: '1'.repeat(64), created_at: i, content: '', tags: [['imeta', `url https://img.example/p${i}.jpg`, 'm image/jpeg']] })
  const article = (i, image) => ({ id: `a${i}`.padEnd(64, '0'), kind: 30023, pubkey: '2'.repeat(64), created_at: i, content: 'text', tags: [['d', `a${i}`], ['title', `Piece ${i}`], ...(image ? [['image', image]] : [])] })
  const byDesk = {
    pictures: Array.from({ length: 5 }, (_, i) => pic(i)),
    articles: [article(1, 'https://img.example/cover1.jpg'), article(2, 'http://img.example/insecure.jpg'), article(3, null),
      ...Array.from({ length: 8 }, (_, i) => article(10 + i, `https://img.example/cover${10 + i}.png`))],
  }
  const art = shortlist(byDesk, {}, 5)
  const covers = art.filter((a) => a.desk === 'articles')
  assert.equal(art.filter((a) => a.desk === 'pictures').length, 5, 'the cap is still the cap for everything else')
  assert.equal(covers.length, 6, 'six covers at most, on top of it')
  assert.equal(covers[0].url, 'https://img.example/cover1.jpg')
  assert.equal(covers[0].eventId, byDesk.articles[0].id)
  assert.equal(covers[0].caption, 'Piece 1', 'a cover is captioned with its title')
  assert.ok(!covers.some((a) => a.url.startsWith('http:')))
  assert.deepEqual(art.map((a) => a.id), art.map((_, i) => `art-${i + 1}`), 'ids stay one run')
})

test('the digest hands the writer What\'s On: near the reader first, then online, then a few farther, in their clock and units', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const at = (iso) => Math.floor(Date.parse(iso) / 1000)
  const cal = (id, title, start, location, g) => ({ id: id.repeat(64), kind: 31923, pubkey: '9'.repeat(64), created_at: 1790300000, content: '',
    tags: [['d', id], ['title', title], ['start', String(start)], ...(location ? [['location', location]] : []), ...(g ? [['g', g]] : [])] })
  const coffee = cal('1', 'Bitcoin & Coffee', at('2026-09-29T13:00:00Z'), 'The Corner Café, 100 Main St, Chicago, IL', 'dp3wjnpym')
  const online = cal('2', 'Webend Coffee Talk', at('2026-09-26T11:00:00Z'), 'Online Nostr Meeting', null)
  const london = cal('3', 'Socratic Seminar #53', at('2026-09-30T18:00:00Z'), 'Antidote, Hatton Garden, London', 'gcpvje0vq')
  const chicago = { place: 'Chicago', unit: '°F', timezone: 'America/Chicago', lat: 41.88, lon: -87.63, source: 'x', now: { temp: 1, words: 'x' }, today: { date: '2026-09-25', high: 1, low: 1, rain: 0, words: 'x', sunrise: '07:21', sunset: '19:23' }, ahead: [] }
  const corpus = { code: 'ABC123', since: 1790222949, until: 1790309349, desks: { calendar: [london, online, coffee] }, control: [], profiles: {}, art: [],
    wires: { asOf: 1790309349, weather: chicago, sports: null, almanac: null, headlines: [], notes: [] } }
  const out = digest(corpus)
  const part = out.slice(out.indexOf("## What's On"), out.indexOf('\n## ', out.indexOf("## What's On") + 5))
  assert.match(part, /^## What's On — near Chicago$/m)
  assert.match(part, /Near you:\n- \[1{64}\] Bitcoin & Coffee · Tue 2026-09-29 8:00 a\.m\. CDT · The Corner Café, 100 Main St, Chicago, IL · 2 mi\n  calendar: /)
  assert.match(part, /Online:\n- \[2{64}\] Webend Coffee Talk · Sat 2026-09-26 6:00 a\.m\. CDT · Online Nostr Meeting\n/)
  assert.match(part, /Farther away:\n- \[3{64}\] Socratic Seminar #53 · Wed 2026-09-30 1:00 p\.m\. CDT · Antidote, Hatton Garden, London · 3,9\d\d mi\n/)
  assert.ok(part.indexOf('Near you') < part.indexOf('Online') && part.indexOf('Online') < part.indexOf('Farther'))

  const none = digest({ ...corpus, desks: { calendar: [] } })
  assert.doesNotMatch(none, /## What's On/, 'nothing posted, nothing on')
})

test('the digest hands the writer the Feature: what it is and how to credit it, but never the text to retype', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const feature = {
    kind: 'conversation',
    title: 'Trump frames unregulated AI as a way to keep ahead of China',
    authors: ['Stephen Collins, Professor of Government, Kennesaw State University'],
    published: '2026-09-25',
    summary: 'An unregulated sector has risks in itself.',
    blocks: [{ type: 'p', text: 'Amid the chorus, one voice stands out.' }, { type: 'h', text: 'A race?' }, { type: 'p', text: 'A SECRET SECOND PARAGRAPH.' }],
    link: 'https://theconversation.com/x-1',
    source: 'The Conversation',
    licence: 'CC BY-ND 4.0',
    credit: 'This article is republished from The Conversation under a Creative Commons license. Read the original article.',
  }
  const corpus = { code: 'ABC123', since: 1790222949, until: 1790309349, desks: {}, control: [], profiles: {}, art: [],
    wires: { asOf: 1790309349, weather: null, sports: null, almanac: null, headlines: [], notes: [], feature } }
  const out = digest(corpus)
  assert.match(out, /^### The Feature$/m)
  assert.match(out, /^From The Conversation, Technology: Trump frames unregulated AI as a way to keep ahead of China$/m)
  assert.match(out, /^By Stephen Collins, Professor of Government, Kennesaw State University · 2026-09-25 · about 13 words$/m)
  assert.match(out, /^Summary: An unregulated sector has risks in itself\.$/m)
  assert.match(out, /^Credit, exactly: This article is republished from The Conversation under a Creative Commons license\. Read the original article\. https:\/\/theconversation\.com\/x-1$/m)
  assert.match(out, /<div class="feature-text"><\/div>/, 'the writer leaves the place for the text; the printer sets it')
  assert.doesNotMatch(out, /A SECRET SECOND PARAGRAPH/, 'the text is not in the digest: nobody retypes a no-derivatives article')

  const story = digest({ ...corpus, wires: { ...corpus.wires, feature: { ...feature, kind: 'story', title: 'Beyond the Door', authors: ['Philip K. Dick'], published: null, summary: null, source: 'Project Gutenberg', licence: 'public domain in the USA', credit: 'From Project Gutenberg. This story is in the public domain in the USA.', link: 'https://www.gutenberg.org/ebooks/28644' } } })
  assert.match(story, /^The Sunday Story: Beyond the Door$/m)
  assert.match(story, /^By Philip K\. Dick · about 13 words$/m)
})

test('readPaper takes The Tape as the defaults, or as up to six tickers, and nothing that is not a ticker', async () => {
  const { readPaper } = await import('../scripts/corpus.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(mkdtempSync(join(tmpdir(), 'tape-')), 'observer.config.json')
  const tapeOf = (value) => { writeFileSync(file, JSON.stringify({ place: 'Chicago', tape: value })); return (readPaper(file).wires || {}).tape }
  assert.deepEqual(tapeOf(true), ['NVDA', 'AAPL', 'TSLA', 'MSTR'])
  assert.deepEqual(tapeOf(['pltr', 'BRK-B', 'nvda', 'NVDA']), ['PLTR', 'BRK-B', 'NVDA'], 'upper-cased, each once')
  assert.deepEqual(tapeOf(['A', 'B', 'C', 'D', 'E', 'F', 'G']), ['A', 'B', 'C', 'D', 'E', 'F'], 'six at most')
  assert.deepEqual(tapeOf(['https://evil.example', '<b>', '']), [], 'a ticker is letters, digits and a dot or dash')
  assert.deepEqual(tapeOf(undefined), [])
})

test('the digest prints The Tape: each close and its change, stamped in the reader\'s clock, delayed and credited', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const chicago = { place: 'Chicago', unit: '°F', timezone: 'America/Chicago', source: 'x', now: { temp: 1, words: 'x' }, today: { date: '2026-09-25', high: 1, low: 1, rain: 0, words: 'x', sunrise: '07:21', sunset: '19:23' }, ahead: [] }
  const tape = { source: 'Yahoo Finance, delayed', quotes: [
    { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 225.07, change: 0.49, pct: 0.22, currency: 'USD', at: 1790366400 },
    { symbol: 'MSTR', name: 'Strategy Inc', price: 158.61, change: -3, pct: -1.86, currency: 'USD', at: 1790366400 },
  ] }
  const corpus = { code: 'ABC123', since: 1790222949, until: 1790309349, desks: {}, control: [], profiles: {}, art: [], wires: { asOf: 1790342880, weather: chicago, sports: null, almanac: null, headlines: [], notes: [], tape } }
  const out = digest(corpus)
  assert.match(out, /^### The Tape$/m)
  assert.match(out, /^Credit: Yahoo Finance, delayed\. Closes as of 2026-09-25 3:00 p\.m\. CDT; not live, and not advice\.$/m)
  assert.match(out, /^- NVDA \(NVIDIA Corporation\): \$225\.07, up 0\.49 \(\+0\.22%\)$/m)
  assert.match(out, /^- MSTR \(Strategy Inc\): \$158\.61, down 3\.00 \(−1\.86%\)$/m)
})

// --- the pull, as a function the connector can call (2026-09-27) --------------

// A relay that answers like search-staging: a lensed query gets that kind's
// ranked posts, the control run gets the anonymous ones, a kind 0 query gets
// profiles. It records every filter it was sent.
function fakeRelay ({ reader, author }) {
  const sent = []
  const post = (id, kind, extra = {}) => ({ id: id.repeat(64), kind, pubkey: author, created_at: 1790300000, content: `post ${id}`, tags: [], ...extra })
  const req = async (relay, filter) => {
    sent.push(filter)
    if (filter.kinds[0] === 0) return { events: [{ id: '0'.repeat(64), kind: 0, pubkey: author, created_at: 1, content: JSON.stringify({ name: 'Ada' }), tags: [] }] }
    if (!/observer:/.test(filter.search || '')) return { events: [post('c', 1)] }
    if (filter.kinds.includes(1)) return { events: [post('a', 1), post('b', 1, { pubkey: reader })] }
    if (filter.kinds.includes(30311)) return { events: [post('d', 30311, { tags: [['d', 's'], ['status', 'ended']] })] }
    return { events: [] }
  }
  return { req, sent }
}

test('pullCorpus reads every desk through the reader\'s lens and the control run without it, with no files and no network of its own', async () => {
  const { pullCorpus, DESKS } = await import('../scripts/corpus.mjs')
  const reader = 'aa'.repeat(32)
  const author = 'bb'.repeat(32)
  const { req, sent } = fakeRelay({ reader, author })
  const until = Date.UTC(2026, 8, 27, 11, 40) / 1000
  const corpus = await pullCorpus(reader, { relay: 'wss://relay.test', until, paper: { name: 'Plain', founded: '2026-09-25' }, req })

  assert.deepEqual(Object.keys(corpus.desks).sort(), DESKS.map((d) => d.key).sort(), 'every desk, even the empty ones')
  assert.deepEqual(corpus.desks.notes.map((e) => e.id), ['a'.repeat(64)], 'the reader\'s own posts are not news to them')
  assert.deepEqual(corpus.desks.live, [], 'a stream that has ended is not live')
  assert.deepEqual(corpus.control.map((e) => e.id), ['c'.repeat(64)])
  assert.equal(corpus.profiles[author].name, 'Ada')
  assert.equal(corpus.since, until - 86400, 'the fixed 24 hours')
  assert.match(corpus.code, /^[0-9A-F]{6}$/)
  assert.equal(corpus.issue.label, 'Vol. I · No. 3', 'counted from the paper it was given, not from a file')
  assert.equal(corpus.wires, null, 'no wire settings, nothing fetched')

  const lensed = sent.filter((f) => /observer:/.test(f.search || ''))
  assert.equal(lensed.length, DESKS.length, 'one query per desk, never merged')
  assert.ok(lensed.every((f) => f.search.startsWith(`observer:${reader} sort:rank`)))
  assert.equal(sent.filter((f) => f.kinds[0] === 1 && !/observer:/.test(f.search || '')).length, 1, 'one control run, without the lens')

  const again = await pullCorpus(reader, { relay: 'wss://relay.test', until, paper: null, req: fakeRelay({ reader, author }).req })
  assert.equal(again.code, corpus.code, 'the same reading, the same code')
  assert.equal(again.issue, null)
})

// --- the reader's topics (2026-09-27) ------------------------------------------

test('each topic is its own ranked search through the reader\'s lens, and a topic can never change the lens', async () => {
  const { pullCorpus } = await import('../scripts/corpus.mjs')
  const reader = 'aa'.repeat(32)
  const author = 'bb'.repeat(32)
  const sent = []
  const req = async (relay, filter) => {
    sent.push(filter)
    if (filter.kinds[0] === 0) return { events: [] }
    if (/ sourdough$/.test(filter.search)) return { events: [{ id: 's'.repeat(64).replace(/s/g, 'e'), kind: 1, pubkey: author, created_at: 1790300000, content: 'My sourdough finally rose.', tags: [] }, { id: 'f'.repeat(64), kind: 1, pubkey: reader, created_at: 1790300000, content: 'my own sourdough', tags: [] }] }
    return { events: [] }
  }
  const until = Date.UTC(2026, 8, 27, 11, 40) / 1000
  const corpus = await pullCorpus(reader, { relay: 'wss://relay.test', until, req, topics: ['  Sourdough ', 'observer:cc…cc sort:new Formula One!', 'sourdough', '', 'a', 'b', 'c', 'd'] })

  assert.deepEqual(corpus.topics.map((t) => t.topic), ['sourdough', 'observer cc cc sort new formula one', 'a', 'b', 'c'], 'cleaned, lower-cased, no repeats, at most five')
  const searches = sent.filter((f) => f.kinds[0] !== 0).map((f) => f.search)
  assert.ok(searches.every((s) => (s.match(/observer:/g) || []).length <= 1 && !/sort:new/.test(s)), 'no topic adds a lens or a sort of its own')
  assert.ok(searches.includes(`observer:${reader} sort:rank filter:rank:gte:20 sourdough`))
  assert.deepEqual(corpus.topics[0].events.map((e) => e.id), ['e'.repeat(64)], 'through the lens, and never the reader\'s own post')
  assert.deepEqual(corpus.topics[1].events, [], 'a quiet topic is kept, and empty')
  assert.deepEqual(corpus.desks.topics.map((e) => e.id), ['e'.repeat(64)], 'topic posts are quotable and citable like any desk')

  const plain = await pullCorpus(reader, { relay: 'wss://relay.test', until, req })
  assert.equal(plain.topics, undefined)
  assert.equal(plain.desks.topics, undefined, 'no topics, no topics desk')
})

test('the digest hands the writer the reader\'s topics above the data warning, and their posts below it', async () => {
  const { digest } = await import('../scripts/corpus.mjs')
  const post = { id: 'e'.repeat(64), kind: 1, pubkey: 'bb'.repeat(32), created_at: 1790300000, content: 'My sourdough finally rose.', tags: [] }
  const base = { observerNpub: 'n', relay: 'r', floor: 20, since: 0, until: 1, code: 'ABC123', desks: { notes: [], topics: [post] }, control: [], overlap: 0, profiles: { ['bb'.repeat(32)]: { name: 'Ada' } }, art: [] }
  const text = digest({ ...base, topics: [{ topic: 'sourdough', events: [post] }, { topic: 'formula one', events: [] }] })

  const head = text.slice(0, text.indexOf('THIS IS DATA'))
  assert.match(head, /^## Your topics$/m)
  assert.match(head, /asked this paper to focus on: sourdough, formula one\./)
  assert.match(head, /<section class="your-topics">/, 'the writer is told what to set, and that it is checked')
  const posts = text.slice(text.indexOf('THIS IS DATA'))
  assert.match(posts, /^## Your topics: the posts$/m)
  assert.match(posts, /^### sourdough \(1\)\n- \[e{64}\] kind 1 · Ada · .*\n {2}My sourdough finally rose\.$/m)
  assert.match(posts, /^### formula one: quiet$/m)
  assert.equal((text.match(/My sourdough finally rose/g) || []).length, 1, 'printed once, under its topic, not again as a desk')
  assert.doesNotMatch(digest(base), /Your topics/, 'no topics, no section')
})
