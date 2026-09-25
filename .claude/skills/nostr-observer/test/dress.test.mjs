// The living layer adds script to a page whose whole safety story is that it
// runs none. These tests hold the line that makes that acceptable: only a
// clean page is dressed, the only code added is ours, byte for byte, and the
// corpus rides along as data that cannot become markup.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dress, islandJson, loadAssets } from '../scripts/dress.mjs'
import { toPermalink, toProfileLink } from '../scripts/validate.mjs'
import { toNpub } from '../scripts/nostr.mjs'

const NOTE_ID = 'a'.repeat(64)
const REPLY_ID = 'b'.repeat(64)
const AUTHOR = '11'.repeat(32)
const REPLIER = '22'.repeat(32)

const corpus = {
  code: 'ABC123',
  since: 1790222949,
  until: 1790309349,
  desks: {
    notes: [
      { id: NOTE_ID, kind: 1, pubkey: AUTHOR, created_at: 1790300000, tags: [], content: 'A song is not scarce. </script><script>alert(1)</script> nostr:npub1xyz' },
      { id: REPLY_ID, kind: 1, pubkey: REPLIER, created_at: 1790301000, tags: [['e', NOTE_ID], ['p', AUTHOR]], content: 'The years behind it are.' },
    ],
  },
  control: [],
  profiles: {
    [AUTHOR]: { name: 'Joe', nip05: null, picture: 'https://example.com/joe.jpg', about: 'Songs <b>for sats</b>' },
    [REPLIER]: { name: 'Max', nip05: null, picture: 'javascript:alert(1)', about: null },
  },
  art: [],
}

const assets = { fonts: '/* fonts */', css: '/* css */', js: 'console.log("living")' }

const page = '<!doctype html><html><head><title>t</title></head><body>'
  + `<article class="story"><p><a href="${toProfileLink(AUTHOR)}" target="_blank" rel="noopener">Joe</a> said <q>A song is not scarce.</q> `
  + `<a href="${toPermalink(NOTE_ID)}" target="_blank" rel="noopener">Read</a></p></article>`
  + '</body></html>'

test('only a page that passes validate is dressed', () => {
  const bad = page.replace('</article>', '</article><script>steal()</script>')
  assert.throws(() => dress(bad, corpus, assets), /has not passed validate/)
  const misquoted = page.replace('A song is not scarce.', 'A song is never scarce.')
  assert.throws(() => dress(misquoted, corpus, assets), /has not passed validate/)
})

test('the only script added is living.js, byte for byte', () => {
  const real = loadAssets()
  const { html } = dress(page, corpus, real)
  const module = /<script type="module" id="living-js">([\s\S]*?)<\/script>/.exec(html)
  assert.ok(module, 'living.js is inlined')
  assert.equal(module[1], real.js)
  const scripts = html.match(/<script\b[^>]*>/g)
  assert.deepEqual(scripts, [
    '<script type="application/json" id="observer-data">',
    '<script type="module" id="living-js">',
  ], 'a JSON island and our module — nothing else, and no 3D engine')
})

test('corpus text cannot close the data island', () => {
  const { html } = dress(page, corpus, assets)
  const island = /<script type="application\/json" id="observer-data">([\s\S]*?)<\/script>/.exec(html)[1]
  assert.doesNotMatch(island, /<\/script/i)
  assert.doesNotMatch(island, /</, 'every < is escaped')
  const data = JSON.parse(island)
  assert.match(data.events[NOTE_ID].text, /<\/script><script>alert\(1\)/, 'the words survive as data')
  assert.doesNotMatch(data.events[NOTE_ID].text, /nostr:/, 'bech32 noise is dropped from cards')
  assert.equal(islandJson({ s: ' ' }), '{"s":"\\u2028"}')
})

test('anchors are keyed by what validate accepted, not by page text', () => {
  const { html, stats } = dress(page, corpus, assets)
  assert.match(html, new RegExp(`<a data-ev="${NOTE_ID}" data-t="1790300000" data-pk="${AUTHOR}"`))
  assert.match(html, new RegExp(`<a data-pk="${AUTHOR}"`))
  assert.deepEqual(stats, { cited: 1, people: 1 })
})

test('undressing gives back the validated edition exactly', () => {
  const { html } = dress(page, corpus, assets)
  const undressed = html
    .replace(/<footer class="lv-colophon">[\s\S]*?<\/footer>\n/, '')
    .replace(/<style id="living-fonts">[\s\S]*?<\/style>\n<style id="living-css">[\s\S]*?<\/style>\n/, '')
    .replace(/<script type="application\/json" id="observer-data">[\s\S]*?<\/script>\n<script type="module" id="living-js">[\s\S]*?<\/script>\n/, '')
    .replace(/ ?data-(ev|t|pk)="[^"]*"/g, '')
    .replace(/<a +/g, '<a ')
  assert.equal(undressed, page)
})

test('a picture that is not https never reaches a card', () => {
  const both = page.replace('</article>', `<p><a href="${toProfileLink(REPLIER)}">Max</a></p></article>`)
  const data = JSON.parse(/id="observer-data">([\s\S]*?)<\/script>/.exec(dress(both, corpus, assets).html)[1])
  assert.equal(data.people[AUTHOR].picture, 'https://example.com/joe.jpg')
  assert.equal(data.people[REPLIER].picture, null)
})

test('a living copy is not dressed twice', () => {
  const { html } = dress(page, corpus, assets)
  assert.throws(() => dress(html, corpus, assets), /already dressed/)
})

// --- the Brainstorm brand, 2026-09-25 ---------------------------------------

const MARK = '<svg viewBox="0 0 41 43"><path d="M0 0L41 43" fill="url(#bs)"/></svg>'
const branded = {
  ...assets,
  brands: { brainstorm: { css: '/* brainstorm tokens */', mark: MARK } },
}
const brandCorpus = { ...corpus, paper: { name: 'The Daily Brainstorm', motto: 'Trust Over Noise', brand: 'brainstorm' } }
const brandPage = page
  .replace('<body>', '<body><main class="sheet">').replace('</body>', '</main></body>')
  .replace('<title>t</title>', '<title>The Daily Brainstorm — Friday</title>')
  .replace('<body>', '<body><header class="masthead"><h1><span class="the">The</span>Daily Brainstorm</h1></header>')

test('the nameplate stands alone: nothing beside it competes with the name', () => {
  const { html } = dress(brandPage, brandCorpus, branded)
  assert.match(html, /<header class="masthead"><h1><span class="the">The<\/span>Daily Brainstorm<\/h1><\/header>/,
    'the masthead the writer set, untouched: no ears, no plate, no mark')
  assert.doesNotMatch(html, /lv-ear|three-src/)
})

test('a paper branded brainstorm is dressed in the brand\'s tokens', () => {
  const { html } = dress(brandPage, brandCorpus, branded)
  assert.match(html, /<style id="brand-css">\n\/\* brainstorm tokens \*\/<\/style>/)
  assert.match(html, /<html data-brand="brainstorm">/)
  const data = JSON.parse(/id="observer-data">([\s\S]*?)<\/script>/.exec(html)[1])
  assert.equal(data.brand, 'brainstorm', 'living.js needs to know to keep to the palette')
})

test('the brand adds no script and still undresses to the checked edition', () => {
  const { html } = dress(brandPage, brandCorpus, branded)
  assert.equal((html.match(/<script\b/g) || []).length, 2)
  const undressed = html
    .replace(/<style id="living-fonts">[\s\S]*?<\/style>\n<style id="living-css">[\s\S]*?<\/style>\n/, '')
    .replace(/<style id="brand-css">[\s\S]*?<\/style>\n/, '')
    .replace(' data-brand="brainstorm"', '')
    .replace(/<script type="application\/json" id="observer-data">[\s\S]*?<\/script>\n<script type="module" id="living-js">[\s\S]*?<\/script>\n/, '')
    .replace(/ ?data-(ev|t|pk)="[^"]*"/g, '')
    .replace(/<a +/g, '<a ')
  assert.equal(undressed, brandPage)
})

test('no brand configured, no brand applied; an unknown brand is refused', () => {
  const { html } = dress(page, corpus, branded)
  assert.doesNotMatch(html, /brand-css|brand-mark|data-brand|Ranked by Brainstorm/)
  assert.throws(() => dress(brandPage, { ...brandCorpus, paper: { ...brandCorpus.paper, brand: 'acme' } }, branded), /Unknown brand "acme"/)
})

// --- living since the edition, 2026-09-25 -----------------------------------

test('the page carries the same lens the edition was printed with, starting where it stopped', () => {
  const lensCorpus = { ...corpus, relay: 'wss://search-staging.brainstorm.world', observer: 'ff'.repeat(32), floor: 20 }
  const data = JSON.parse(/id="observer-data">([\s\S]*?)<\/script>/.exec(dress(page, lensCorpus, assets).html)[1])
  assert.equal(data.since.relay, 'wss://search-staging.brainstorm.world')
  assert.deepEqual(data.since.filter, {
    kinds: [1],
    since: 1790309349,
    limit: 40,
    search: `observer:${'ff'.repeat(32)} sort:rank filter:rank:gte:20`,
  }, 'ranked exactly as the paper was: a live strip without the lens would be the unranked feed')
})

test('"see everything" is a Brainstorm search of the page\'s voices, newest first, since the edition day', () => {
  const both = page.replace('</article>', `<p><a href="${toProfileLink(REPLIER)}">Max</a></p></article>`)
  const data = JSON.parse(/id="observer-data">([\s\S]*?)<\/script>/.exec(dress(both, corpus, assets).html)[1])
  const url = new URL(data.since.seeAll)
  assert.equal(url.origin + url.pathname, 'https://brainstorm.world/')
  // 1790309349 is 2026-09-25 04:09 UTC.
  assert.equal(url.searchParams.get('q'), `from:${toNpub(AUTHOR)} from:${toNpub(REPLIER)} since:2026-09-25`,
    'in the order they appear on the page')
  assert.equal(url.searchParams.get('t'), 'notes')
  assert.equal(url.searchParams.get('f'), 'sort:recent')
})

test('a branded paper closes with its printer\'s colophon: who made it, and how to get your own', () => {
  const withFooter = { ...branded, brands: { brainstorm: { ...branded.brands.brainstorm, footer: '<footer class="lv-colophon">{{name}} is printed by Brainstorm. <a href="https://brainstorm.world/login">Start yours</a></footer>' } } }
  const { html } = dress(brandPage, brandCorpus, withFooter)
  assert.match(html, /<footer class="lv-colophon">The Daily Brainstorm is printed by Brainstorm\. <a href="https:\/\/brainstorm\.world\/login">Start yours<\/a><\/footer>\n<\/main>/,
    'the last thing on the sheet itself, with the paper\'s own name filled in')
  const marked = dress(brandPage, brandCorpus, { ...withFooter, brands: { brainstorm: { ...withFooter.brands.brainstorm, footer: '<footer class="lv-colophon">{{mark}}</footer>' } } }).html
  const bare = dress(brandPage.replace('<main class="sheet">', '').replace('</main>', ''), brandCorpus, withFooter).html
  assert.match(bare, /<\/footer>\n<script type="application\/json"/, 'no sheet, then the end of the page')
  assert.ok(marked.includes(`<footer class="lv-colophon">${MARK}</footer>`), 'the brand mark can sign the colophon')
  const plain = dress(page, corpus, withFooter).html
  assert.doesNotMatch(plain, /lv-colophon/, 'an unbranded paper carries nobody\'s advertising')
})

// --- the wireless and the classifieds, 2026-09-25 ---------------------------

import { toStreamLink, toListingLink } from '../scripts/validate.mjs'

const STREAM_ID = 'c'.repeat(64)
const LISTING_ID = 'd'.repeat(64)
const STATION = '33'.repeat(32)
const SELLER = '44'.repeat(32)
const stream = {
  id: STREAM_ID, kind: 30311, pubkey: STATION, created_at: 1790309000, content: '',
  tags: [['d', 'nogood'], ['title', 'NoGood Radio'], ['summary', 'A pirate station <b>from a basement</b>.'],
    ['image', 'https://img.example/cover.jpg'], ['status', 'live'], ['starts', '1739464332'],
    ['current_participants', '5'], ['t', 'music'],
    ['streaming', 'https://api.example/live.m3u8'], ['streaming', 'moq://api.example:1443/']],
}
const listing = {
  id: LISTING_ID, kind: 30402, pubkey: SELLER, created_at: 1790300500,
  content: 'Original packaging.\nNot negotiable.',
  tags: [['d', 'miner'], ['title', 'Antminer S19'], ['price', '850', 'EUR'], ['location', 'Barcelona'],
    ['image', 'https://img.example/a.jpg', '800x600'], ['image', 'http://img.example/insecure.jpg'], ['image', 'https://img.example/b.jpg'],
    ['summary', 'A miner.'], ['t', 'mining'], ['status', 'active'],
    ['r', 'http://insecure.example/buy'], ['r', 'https://market.example/?p=57'], ['r', 'https://other.example/x']],
}
const wireCorpus = {
  ...corpus,
  relay: 'wss://relay.example',
  desks: { ...corpus.desks, live: [stream], classifieds: [listing] },
  profiles: { ...corpus.profiles, [SELLER]: { name: 'Trobades', picture: null, about: null } },
}
const wirePage = page.replace('</article>', '</article>'
  + `<p><a href="${toStreamLink(stream)}">NoGood Radio</a>, on zap.stream.</p>`
  + `<p><a href="${toListingLink(listing)}">Antminer S19</a>: 850 €.</p>`)
const islandOf = (html) => JSON.parse(/id="observer-data">([\s\S]*?)<\/script>/.exec(html)[1])

test('a stream link carries its station, for the paper\'s own wireless set', () => {
  const { html } = dress(wirePage, wireCorpus, { ...assets, hls: '/* hls */' })
  assert.match(html, new RegExp(`<a data-stream="${STREAM_ID}" href=`))
  assert.deepEqual(islandOf(html).streams[STREAM_ID], {
    title: 'NoGood Radio',
    summary: 'A pirate station <b>from a basement</b>.',
    image: 'https://img.example/cover.jpg',
    status: 'live',
    starts: 1739464332,
    listeners: 5,
    tags: ['music'],
    hls: 'https://api.example/live.m3u8',
    url: toStreamLink(stream),
    address: { kind: 30311, pubkey: STATION, d: 'nogood' },
  }, 'only an https .m3u8 is a feed the page will play; the summary is data, set as text')
  assert.match(html, /<script type="text\/plain" id="hls-src">\/\* hls \*\/<\/script>/, 'the player library rides along, inert until play')
})

test('a classified link carries its listing, for the native listing sheet', () => {
  const { html } = dress(wirePage, wireCorpus, { ...assets, hls: '/* hls */' })
  assert.match(html, new RegExp(`<a data-listing="${LISTING_ID}" href=`))
  const ad = islandOf(html).listings[LISTING_ID]
  assert.deepEqual(ad, {
    title: 'Antminer S19',
    price: { amount: '850', currency: 'EUR' },
    images: ['https://img.example/a.jpg', 'https://img.example/b.jpg'],
    summary: 'A miner.',
    text: 'Original packaging.\nNot negotiable.',
    location: 'Barcelona',
    tags: ['mining'],
    status: 'active',
    seller: SELLER,
    url: toListingLink(listing),
    link: 'https://market.example/?p=57',
  }, 'http pictures never reach the page; line breaks in the description survive; the first https r tag is where the seller sells')
  assert.equal(islandOf(html).people[SELLER].name, 'Trobades', 'the seller is named on the sheet')
})

test('no stream on the page, no player library', () => {
  const { html } = dress(page, corpus, { ...assets, hls: '/* hls */' })
  assert.doesNotMatch(html, /hls-src/)
})

// --- the construction, 2026-09-25 -------------------------------------------

const frontPage = '<!doctype html><html><head><title>t</title></head><body><main class="sheet">'
  + '<div class="folio"><span>No. A</span><span>Friday</span><span>24h to 04:09 UTC</span></div>'
  + '<header class="masthead"><h1>The Paper</h1><p class="motto">m</p></header>'
  + '<section class="fold">'
  + '<div class="col span-3"><article class="story"><p class="kicker">Markets</p><h3 class="small-head">Bonds</h3></article>'
  + '<div class="box weather"><p class="box-head">Weather · Chicago</p></div></div>'
  + '<div class="col span-6"><article class="story"><p class="kicker">The Lead · Property</p><h2 class="lead-head">Who Owns a Song?</h2></article></div>'
  + '<div class="col span-3"><article class="story"><p class="kicker">Builders</p><h2 class="main-head">Releases</h2></article></div>'
  + '</section>'
  + '<section class="band seconds"><div class="cols4"><div class="cell"><p class="kicker">Privacy</p></div></div></section>'
  + '<section class="band"><div class="band-head"><h2>The Wire</h2></div></section>'
  + '<section class="band tinted"><div class="band-head"><h2>From the Wires</h2></div><div class="cols3">'
  + '<div class="cell"><p class="box-head">Sports</p></div><div class="cell"><p class="box-head">Almanac · September 25</p></div></div></section>'
  + '</main></body></html>'

test('the index row is a section bar: the front page, the headed bands, the wire pages, and the weather last', () => {
  const { html } = dress(frontPage, corpus, assets)
  const nav = '<nav class="lv-index" aria-label="Inside today"><span class="lv-sections">'
    + '<a href="#lv-section-1">Front page</a><a href="#lv-section-2">The Wire</a>'
    + '<a href="#lv-section-3">Sports</a><a href="#lv-section-4">Almanac</a><a href="#lv-section-5">Weather</a></span>'
    + '<span class="lv-since-slot"></span></nav>'
  assert.ok(html.includes('</header>' + nav), 'immediately after the masthead, one row: sections, not stories')
  assert.match(html, /<section class="fold" id="lv-section-1">/)
  assert.match(html, /<section class="band" id="lv-section-2">/)
  assert.match(html, /<div class="cell" id="lv-section-3"><p class="box-head">Sports<\/p>/)
  assert.match(html, /<div class="cell" id="lv-section-4"><p class="box-head">Almanac · September 25<\/p>/, 'a wire page is named by its first segment')
  assert.match(html, /<div class="box weather" id="lv-section-5">/)
  assert.doesNotMatch(html, /(Markets|Property|Builders|Privacy|From the Wires)<\/a>/, 'stories and the seconds are not sections; the wires band is listed by its pages')
  assert.doesNotMatch(dress(page, corpus, assets).html, /lv-index/)
})

// --- the puzzle ships as hashes, 2026-09-25 ------------------------------------

import { createHash } from 'node:crypto'

test('the living copy carries one hash per cell and no solution: a right digit verifies, a wrong one does not', () => {
  const solution = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ((r * 3 + Math.floor(r / 3) + c) % 9) + 1))
  const withPuzzle = { ...corpus, code: '13C931', wires: { asOf: 1, weather: null, sports: null, almanac: null, headlines: [], notes: [], puzzle: { givens: solution.map((row) => row.map(() => 0)), solution } } }
  const data = JSON.parse(/id="observer-data">([\s\S]*?)<\/script>/.exec(dress(page, withPuzzle, assets).html)[1])
  assert.equal(data.puzzle.solution, undefined, 'the answer is not in the page')
  assert.equal(data.puzzle.code, '13C931')
  assert.equal(data.puzzle.cells.length, 9)
  const sha = (text) => createHash('sha256').update(text).digest('hex')
  assert.equal(data.puzzle.cells[4][7], sha(`13C931:4:7:${solution[4][7]}`), 'sha-256 of code:row:col:digit')
  assert.notEqual(data.puzzle.cells[4][7], sha(`13C931:4:7:${(solution[4][7] % 9) + 1}`))
  assert.doesNotMatch(JSON.stringify(data), /"solution"/)
})

test('the word of the day rides as hashes too: one per position, one per letter occurrence, and the lists to play with', () => {
  const withFive = { ...corpus, code: 'A', until: Date.UTC(2026, 8, 25, 4, 9) / 1000, wires: { asOf: 1, weather: null, sports: null, almanac: null, headlines: [], notes: [], five: { name: 'Five', day: 268, answer: 'abbey' } } }
  const data = JSON.parse(/id="observer-data">([\s\S]*?)<\/script>/.exec(dress(page, withFive, { ...assets, fiveWords: { answers: ['abbey', 'about'], guesses: ['abbey', 'about', 'babes'] } }).html)[1])
  const sha = (text) => createHash('sha256').update(text).digest('hex')
  assert.equal(data.five.day, 268)
  assert.equal(data.five.name, 'Five')
  assert.deepEqual(data.five.positions, [0, 1, 2, 3, 4].map((i) => sha(`five:268:${i}:${'abbey'[i]}`)))
  assert.deepEqual([...data.five.letters].sort(), [sha('five:268:a:1'), sha('five:268:b:1'), sha('five:268:b:2'), sha('five:268:e:1'), sha('five:268:y:1')].sort(),
    'the multiset of letters, so a second B is a near only once')
  assert.deepEqual(data.five.answers, ['abbey', 'about'])
  assert.equal(data.five.guesses.length, 3)
  assert.doesNotMatch(JSON.stringify(data.five), /"answer"/)
})

test('the lead picture loads first; every picture after it waits until it is near the screen', () => {
  const art = { ...corpus, art: [{ url: 'https://example.com/lead.jpg' }, { url: 'https://example.com/later.jpg' }] }
  const pictures = page.replace('<article class="story">',
    '<section class="fold"><div class="col span-6"><h2 class="lead-head">Lead</h2><figure><img src="https://example.com/lead.jpg" alt="Lead"></figure></div></section>'
    + '<section class="band"><figure><img src="https://example.com/later.jpg" alt="Later"></figure></section>'
    + '<article class="story">')
  const { html } = dress(pictures, art, assets)
  const imgs = html.match(/<img\b[^>]*>/g)
  assert.equal(imgs.length, 2)
  assert.match(imgs[0], /fetchpriority="high"/, 'the lead is fetched first')
  assert.doesNotMatch(imgs[0], /loading="lazy"/, 'the lead never waits')
  assert.match(imgs[1], /loading="lazy"/)
  assert.match(imgs[1], /decoding="async"/)
  // A picture the writer already marked keeps its own attributes, once.
  const marked = pictures.replace('later.jpg" alt="Later"', 'later.jpg" alt="Later" loading="lazy"')
  const twice = dress(marked, art, assets).html.match(/<img\b[^>]*>/g)[1]
  assert.equal((twice.match(/loading=/g) || []).length, 1)
})

// --- the card's preview of an article, 2026-09-25 -------------------------------

import { toBrainstormArticle } from '../scripts/nostr.mjs'

test('an article\'s card reads as prose: no markdown, and the title is not said twice', () => {
  const ARTICLE_ID = 'c'.repeat(64)
  const article = {
    id: ARTICLE_ID, kind: 30023, pubkey: AUTHOR, created_at: 1790302000,
    tags: [['d', 'refusal'], ['title', 'A $70 Billion Refusal']],
    content: '# A $70 Billion Refusal\n\nOn **Wednesday** the [US Treasury](https://home.treasury.gov) sold '
      + '![chart](https://example.com/chart.png)$70 billion of *five-year* notes.\n\n## The auction\n\n'
      + '- cleared at `5.033%`\n- against 4.393% in August\n\n> Not the same as getting a price.',
  }
  const withArticle = { ...corpus, desks: { ...corpus.desks, articles: [article] } }
  const cited = page.replace('</p></article>',
    ` <a href="${toBrainstormArticle(article)}" target="_blank" rel="noopener">Read</a></p></article>`)
  const { html } = dress(cited, withArticle, assets)
  const data = JSON.parse(/<script type="application\/json" id="observer-data">([\s\S]*?)<\/script>/.exec(html)[1])
  const card = data.events[ARTICLE_ID]
  assert.equal(card.title, 'A $70 Billion Refusal')
  assert.equal(card.text, 'On Wednesday the US Treasury sold $70 billion of five-year notes. '
    + 'The auction cleared at 5.033% against 4.393% in August Not the same as getting a price.')
  // A note keeps its own asterisks: only articles are read as markdown.
  assert.match(data.events[NOTE_ID].text, /^A song is not scarce\./)
})

// --- the panel steps through stories, not people, 2026-09-25 --------------------

const STORY_ARTICLE = {
  id: '9'.repeat(64), kind: 30023, pubkey: REPLIER, created_at: 1790303000,
  tags: [['d', 'years'], ['title', 'The Years Behind It']], content: 'A long read.',
}
const storyCorpus = { ...wireCorpus, desks: { ...wireCorpus.desks, articles: [STORY_ARTICLE] } }
// A name, a post, a station, a listing, another name, a reply, an article, and
// the first post cited a second time — in that order on the page.
const storyPage = wirePage.replace('Antminer S19</a>: 850 €.</p>',
  'Antminer S19</a>: 850 €.</p>'
  + `<p><a href="${toProfileLink(REPLIER)}">Max</a> answered. <a href="${toPermalink(REPLY_ID)}">Read</a> `
  + `<a href="${toBrainstormArticle(STORY_ARTICLE)}">Read</a> <a href="${toPermalink(NOTE_ID)}">Read</a></p>`)

test('the reading order is the stories, each once, as the page first meets them — no people, stations or listings', () => {
  const { html } = dress(storyPage, storyCorpus, assets)
  assert.deepEqual(islandOf(html).sequence, [NOTE_ID, REPLY_ID, STORY_ARTICLE.id])
})

test('each person carries their stories on this page, in reading order, for "In today\'s paper"', () => {
  const { people } = islandOf(dress(storyPage, storyCorpus, assets).html)
  assert.deepEqual(people[AUTHOR].stories, [NOTE_ID])
  assert.deepEqual(people[REPLIER].stories, [REPLY_ID, STORY_ARTICLE.id])
  assert.deepEqual(people[SELLER].stories, [], 'a seller named only on a listing has no stories here')
})
