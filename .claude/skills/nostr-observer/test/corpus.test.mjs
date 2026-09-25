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
    cartoon: false, puzzle: false, recipe: false, serial: null, picture: false, markets: false, world: false, sky: false, culture: false, tabloid: false, five: false, country: null,
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
    sports: { source: 'TheSportsDB', teams: [{ team: 'Arsenal', league: 'English Premier League',
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
  assert.match(text, /^- Arsenal \(English Premier League\): last Arsenal 2–1 Chelsea \(2026-09-21\); next Leeds United v Arsenal, 2026-09-28 14:00 UTC, Elland Road\.$/m)
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
  writeFileSync(file, JSON.stringify({ place: 'Chicago', cartoon: true, puzzle: true, recipe: true, serial: 1342, picture: true, markets: true, world: true, sky: true, country: 'US', tabloid: true, five: true }))
  const w = readPaper(file).wires
  assert.deepEqual({ cartoon: w.cartoon, puzzle: w.puzzle, recipe: w.recipe, serial: w.serial, picture: w.picture, markets: w.markets, world: w.world, sky: w.sky, country: w.country, tabloid: w.tabloid, five: w.five },
    { cartoon: true, puzzle: true, recipe: true, serial: 1342, picture: true, markets: true, world: true, sky: true, country: 'US', tabloid: true, five: true })
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
