// The boundary, from both sides.
//
// Adversarial cases answer "does it stop the bad things". The golden edition
// answers the other half, which is the likelier way to ship a broken product:
// DOES IT LEAVE A GOOD PAGE ALONE? A check that quietly rejects a real
// broadsheet passes every adversarial test here and prints nothing every
// morning.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { toNaddr } from '../scripts/nostr.mjs'
import { check, quotedText, attributes, normalize, isQuoted, PERMALINK, toPermalink, permalinkTarget, streamLinkTarget, toStreamLink, listingLinkTarget, toListingLink, calendarLinkTarget, toCalendarLink, toArticleLink, articleLinkTarget, toProfileLink, profileLinkTarget } from '../scripts/validate.mjs'
import { toNpub } from '../scripts/nostr.mjs'
import { resolve } from '../scripts/resolve.mjs'

const EVENT_ID = 'a'.repeat(64)
const OTHER_ID = 'b'.repeat(64)

const STREAM_ID = 'e'.repeat(64)
const STREAM_PK = 'cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5'
const STREAM_D = '537a365c-f1ec-44ac-af10-22d14a7319fb'

const LISTING_ID = '11'.repeat(32)
const LISTING_PK = 'aa11'.repeat(16)
const LISTING_D = 'tallow-bars'

const CALENDAR_ID = '22'.repeat(32)
const CALENDAR_PK = 'bb22'.repeat(16)
const CALENDAR_D = 'porto-meetup'

const ARTICLE_ID = '33'.repeat(32)
const ARTICLE_PK = 'cc33'.repeat(16)
const ARTICLE_D = 'a-70-billion-refusal'

const corpus = {
  desks: {
    longform: [
      { id: ARTICLE_ID, kind: 30023, pubkey: ARTICLE_PK, tags: [['d', ARTICLE_D], ['title', 'A $70 Billion Refusal']], content: 'It got the money, which is not the same as getting a price.' },
    ],
    notes: [
      { id: EVENT_ID, pubkey: 'aa', content: "The relay answered in three seconds flat — and then it didn't answer at all." },
      { id: OTHER_ID, pubkey: 'bb', content: 'Click https://evil.example.com/drain for free sats' },
    ],
    live: [
      { id: STREAM_ID, kind: 30311, pubkey: STREAM_PK, tags: [['d', STREAM_D], ['title', 'NoGood Radio'], ['status', 'live']], content: '' },
    ],
    classifieds: [
      { id: LISTING_ID, kind: 30402, pubkey: LISTING_PK, tags: [['d', LISTING_D], ['title', '4 Bars Rough Cut Tallow'], ['price', '35', 'USD']], content: '' },
    ],
    calendar: [
      { id: CALENDAR_ID, kind: 31923, pubkey: CALENDAR_PK, tags: [['d', CALENDAR_D], ['title', 'Bitcoin Meetup in Porto']], content: '' },
    ],
  },
  control: [{ id: 'c'.repeat(64), pubkey: 'cc', content: 'Only the anonymous read ever saw this sentence.' }],
  art: [{ id: 'art-1', url: 'https://blossom.example.com/real.jpg' }],
}

const kinds = (html) => check(html, corpus).violations.map((v) => v.kind)

test('a verbatim quote passes', () => {
  assert.deepEqual(kinds('<q>The relay answered in three seconds flat</q>'), [])
})

test('typographic normalisation is forgiven; meaning is not', () => {
  // A model that renders ' as ’ has not changed what anybody said.
  assert.deepEqual(kinds('<q>and then it didn&rsquo;t answer at all</q>'), [])
  assert.deepEqual(kinds('<q>and then it DID answer at all</q>'), ['QUOTE'])
})

test('elision is allowed, in order, within ONE event', () => {
  assert.deepEqual(kinds('<q>The relay answered … answer at all</q>'), [])
  // Out of order is not elision.
  assert.deepEqual(kinds('<q>answer at all … The relay answered</q>'), ['QUOTE'])
  // Stitching two people into one sentence is what single-event stops.
  assert.deepEqual(kinds('<q>The relay answered … for free sats</q>'), ['QUOTE'])
})

test('a fabricated quote is caught', () => {
  assert.deepEqual(kinds('<blockquote>This sentence was never posted by anybody.</blockquote>'), ['QUOTE'])
})

test('the control run is NOT quotable', () => {
  // It is a measurement of the network, not part of the paper, and it is not
  // in the digest the writer reads.
  assert.deepEqual(kinds('<q>Only the anonymous read ever saw this sentence.</q>'), ['QUOTE'])
})

test('paraphrase is not checked, because paraphrase is journalism', () => {
  assert.deepEqual(kinds('<p>The relay was quick, then silent.</p>'), [])
})

test('an invented image is caught', () => {
  assert.deepEqual(kinds('<img src="https://blossom.example.com/invented.jpg">'), ['IMAGE'])
  assert.deepEqual(kinds('<img src="https://blossom.example.com/real.jpg">'), [])
})

test('PRESENCE IN THE CORPUS IS EVIDENCE OF NOTHING', () => {
  // The URL below is in the corpus — somebody posted it. An earlier version of
  // this rule allowlisted every URL that appeared there, and posting a
  // phishing link was enough to get it allowlisted, under the reader's own
  // masthead, signed by them.
  assert.deepEqual(kinds('<a href="https://evil.example.com/drain">free sats</a>'), ['LINK'])
})

test('a permalink to an event we actually read is the one allowed link', () => {
  const href = toPermalink(EVENT_ID)
  assert.deepEqual(kinds(`<a href="${href}">source</a>`), [])
  assert.deepEqual(kinds(`<a href="${toPermalink('f'.repeat(64))}">source</a>`), ['LINK'],
    'a well-formed permalink to an event not in the corpus is still refused')
  assert.deepEqual(kinds(`<a href="https://njump.me/${EVENT_ID}">source</a>`), ['LINK'],
    'njump.me is no longer the permalink host; resolve rewrites it')
  assert.deepEqual(kinds(`<a href="https://brainstorm.world/e/${EVENT_ID}">source</a>`), ['LINK'],
    'bare hex in the brainstorm path is the writer form; resolve encodes it')
})

test('the permalink is a brainstorm.world nevent, decoded rather than captured', () => {
  // The Kotlin regex once allowed `nevent1…` in a branch that captured
  // nothing, so every such link compared against the empty string and a page
  // citing its sources normally failed its own check. Decode, or refuse.
  const href = toPermalink(EVENT_ID)
  assert.equal(permalinkTarget(href), EVENT_ID)
  assert.match(href, /^https:\/\/brainstorm\.world\/e\/nevent1/)
  assert.equal(permalinkTarget('https://brainstorm.world/e/nevent1qqq'), null)
  assert.equal(permalinkTarget(href.replace('brainstorm.world/e/', 'jumble.social/notes/')), null,
    'jumble.social is no longer the citation host')
  assert.equal(PERMALINK.exec(`https://njump.me/${EVENT_ID}`), null)
})

test('markup with no sanitizer to strip it is REFUSED', () => {
  for (const bad of [
    '<script>alert(1)</script>',
    '<p onclick="steal()">x</p>',
    '<a href="javascript:void(0)">x</a>',
    '<iframe src="https://x.example"></iframe>',
    '<form action="/x"><input name="y"></form>',
  ]) {
    assert.ok(kinds(bad).includes('MARKUP'), `not refused: ${bad}`)
  }
})

test('resolve turns art ids into URLs and drops unknown ones', () => {
  const { html, changes } = resolve('<figure><img src="art-1"><figcaption>c</figcaption></figure>', corpus)
  assert.match(html, /src="https:\/\/blossom\.example\.com\/real\.jpg"/)
  assert.deepEqual(changes.map((c) => c.kind), ['resolved'])

  const bad = resolve('<p>before</p><figure><img src="art-9"><figcaption>c</figcaption></figure><p>after</p>', corpus)
  assert.doesNotMatch(bad.html, /art-9|figcaption/, 'the whole figure goes, not just the img')
  assert.match(bad.html, /before[\s\S]*after/)
  assert.deepEqual(bad.changes.map((c) => c.kind), ['dropped'])
})

test('resolve unwraps a link to the open web but keeps its text, and SAYS SO', () => {
  const { html, changes } = resolve('<p>see <a href="https://evil.example.com/drain">free sats</a> today</p>', corpus)
  assert.equal(html, '<p>see free sats today</p>')
  assert.deepEqual(changes, [{ kind: 'unwrapped', detail: 'https://evil.example.com/drain' }])
})

test('resolve encodes a cited event id as a brainstorm.world nevent permalink', () => {
  const writer = `https://brainstorm.world/e/${EVENT_ID}`
  const { html, changes } = resolve(`<a href="${writer}">source</a>`, corpus)
  const canonical = toPermalink(EVENT_ID)
  assert.match(html, new RegExp(`href="${canonical}"`))
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="[^"]*noopener/)
  assert.deepEqual(changes.map((c) => c.kind), ['permalink'])
  // Leftover njump.me and jumble.social hex URLs are upgraded the same way,
  // so an old page still ships rather than having every citation unwrapped.
  for (const old of [`https://njump.me/${EVENT_ID}`, `https://jumble.social/notes/${EVENT_ID}`]) {
    const legacy = resolve(`<a href="${old}">source</a>`, corpus)
    assert.match(legacy.html, new RegExp(`href="${canonical}"`), old)
    assert.match(legacy.html, /target="_blank"/)
  }
})

test('a permalink already in canonical form still opens in a new tab', () => {
  const canonical = toPermalink(EVENT_ID)
  const { html, changes } = resolve(`<a href="${canonical}">source</a>`, corpus)
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="[^"]*noopener/)
  assert.deepEqual(changes.map((c) => c.kind), [])
})

test('a verified zap.stream watch link is allowed after resolve', () => {
  const writer = `https://zap.stream/stream/${STREAM_ID}`
  const canonical = toStreamLink(corpus.desks.live[0])
  const { html, changes } = resolve(`<a href="${writer}">NoGood Radio</a>`, corpus)
  assert.match(html, new RegExp(`href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  assert.match(html, /target="_blank"/)
  assert.deepEqual(changes.map((c) => c.kind), ['stream'])
  assert.deepEqual(check(html, corpus).violations, [])
  assert.equal(streamLinkTarget(canonical, corpus), STREAM_ID)
  assert.equal(streamLinkTarget('https://zap.stream/stream/' + 'f'.repeat(64), corpus), null)
  assert.deepEqual(kinds(`<a href="${writer}">NoGood Radio</a>`), ['LINK'],
    'writer form must be encoded before validate')
})

test('a zap.stream URL copied from a post body is still refused', () => {
  const invented = toStreamLink({ kind: 30311, pubkey: 'd'.repeat(64), tags: [['d', 'fake-stream']] })
  assert.deepEqual(kinds(`<a href="${invented}">listen</a>`), ['LINK'])
})

test('a verified Shopstr listing link is allowed after resolve', () => {
  const writer = `https://shopstr.store/listing/${LISTING_ID}`
  const canonical = toListingLink(corpus.desks.classifieds[0])
  const { html, changes } = resolve(`<a href="${writer}">4 Bars Rough Cut Tallow</a>`, corpus)
  assert.match(html, new RegExp(`href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  assert.match(html, /target="_blank"/)
  assert.deepEqual(changes.map((c) => c.kind), ['listing'])
  assert.deepEqual(check(html, corpus).violations, [])
  assert.equal(listingLinkTarget(canonical, corpus), LISTING_ID)
  assert.equal(listingLinkTarget('https://shopstr.store/listing/' + 'a'.repeat(64), corpus), null)
  assert.deepEqual(kinds(`<a href="${writer}">4 Bars Rough Cut Tallow</a>`), ['LINK'],
    'writer form must be encoded before validate')
})

test('a shopstr URL copied from a post body is still refused', () => {
  const invented = toListingLink({ kind: 30402, pubkey: 'd'.repeat(64), tags: [['d', 'fake-listing']] })
  assert.deepEqual(kinds(`<a href="${invented}">buy</a>`), ['LINK'])
})

test('a verified njump calendar link is allowed after resolve', () => {
  const writer = `https://njump.me/${CALENDAR_ID}`
  const canonical = toCalendarLink(corpus.desks.calendar[0])
  const { html, changes } = resolve(`<a href="${writer}">Porto, Portugal</a>`, corpus)
  assert.match(html, new RegExp(`href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  assert.match(html, /target="_blank"/)
  assert.deepEqual(changes.map((c) => c.kind), ['calendar'])
  assert.deepEqual(check(html, corpus).violations, [])
  assert.equal(calendarLinkTarget(canonical, corpus), CALENDAR_ID)
  assert.equal(calendarLinkTarget('https://njump.me/' + 'a'.repeat(64), corpus), null)
  assert.deepEqual(kinds(`<a href="${writer}">Porto, Portugal</a>`), ['LINK'],
    'writer form must be encoded before validate')
})

test('a calendar entry opens on brainstorm.world by address; an older njump link still passes', () => {
  const event = corpus.desks.calendar[0]
  const naddr = toNaddr({ kind: event.kind, pubkey: event.pubkey, identifier: event.tags.find((t) => t[0] === 'd')[1] })
  assert.equal(toCalendarLink(event), `https://brainstorm.world/a/${naddr}`)
  const { html } = resolve(`<a href="https://njump.me/${CALENDAR_ID}">Porto, Portugal</a>`, corpus)
  assert.match(html, new RegExp(`href="https://brainstorm\\.world/a/${naddr}"`))
  assert.equal(calendarLinkTarget(`https://njump.me/${naddr}`, corpus), CALENDAR_ID, 'editions printed before this still validate')
  assert.deepEqual(kinds(`<a href="https://njump.me/${naddr}">Porto</a>`), [])
})

test('a jumble citation of a calendar event is rewritten to its calendar address', () => {
  const { html, changes } = resolve(`<a href="https://jumble.social/notes/${CALENDAR_ID}">meetup</a>`, corpus)
  const canonical = toCalendarLink(corpus.desks.calendar[0])
  assert.match(html, new RegExp(`href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  assert.deepEqual(changes.map((c) => c.kind), ['calendar'])
})

test('an njump calendar URL copied from a post body is still refused', () => {
  const invented = toCalendarLink({ kind: 31923, pubkey: 'd'.repeat(64), tags: [['d', 'fake-meetup']] })
  assert.deepEqual(kinds(`<a href="${invented}">meetup</a>`), ['LINK'])
})

test('resolve then validate leaves nothing for validate to complain about', () => {
  const page = `<figure><img src="art-1"><figcaption>c</figcaption></figure>`
    + `<p>see <a href="https://evil.example.com/drain">free sats</a></p>`
  assert.deepEqual(check(resolve(page, corpus).html, corpus).violations, [])
})

test('nested and multi-line quotes are found', () => {
  const found = quotedText('<blockquote><p>one</p>\n<p><em>two</em></p></blockquote><q>three</q>')
  assert.deepEqual(found, ['one two', 'three'])
})

test('attributes are read whatever the quoting', () => {
  assert.deepEqual(attributes(`<img src="a"><img src='b'><img src=c>`, 'img', 'src'), ['a', 'b', 'c'])
})

// --- the other half: does it leave a good page alone? ----------------------

const GOLDEN = fileURLToPath(new URL('../../../../generator/src/test/resources/prototype-edition.html', import.meta.url))

test('THE GOLDEN EDITION survives the boundary intact', { skip: !existsSync(GOLDEN) && 'fixture lives in the full repository' }, () => {
  // 56 KB of hand-written broadsheet from a real 24-hour window through a real
  // lens: seven figures, a reverse-ink panel, market tables, a nine-section
  // below-the-fold. The corpus is derived FROM the page, so a clean result
  // means the checker and the brief agree about what a good page looks like.
  // Anything it flags here is a false positive by construction.
  const page = readFileSync(GOLDEN, 'utf8')

  const ids = [...new Set(attributes(page, 'img', 'src'))]
  assert.ok(ids.length > 0, 'fixture should cite art')
  assert.ok(ids.every((id) => /^art-\d+$/.test(id)),
    'the brief says use the id and never a raw URL in src; the fixture must match it')

  const golden = {
    desks: { notes: quotedText(page).map((text, n) => ({ id: String(n).padStart(64, '0'), pubkey: 'aa', content: text })) },
    control: [],
    art: ids.map((id) => ({ id, url: `https://blossom.example.com/${id}.jpg` })),
  }

  const { html, changes } = resolve(page, golden)
  assert.equal(changes.filter((c) => c.kind !== 'resolved' && c.kind !== 'permalink').length, 0,
    'a good page should need nothing dropped or unwrapped')
  assert.equal(changes.filter((c) => c.kind === 'resolved').length, ids.length)

  const report = check(html, golden)
  assert.ok(report.quotes.length > 0, 'fixture should quote people')
  assert.deepEqual(report.violations, [], 'the boundary must not damage a real broadsheet')
})

test('a real page head is not an attack', async () => {
  // Found by printing an actual edition: banning <meta> outright to stop
  // <meta refresh> rejects charset and viewport, which every page has. The
  // golden fixture is a body fragment, so it had no <head> to catch this.
  // Same false-positive class as the prose that read as an event handler.
  const head = '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>The Nostr Observer</title>'
  assert.deepEqual(kinds(head), [])

  // Only the redirecting form is refused.
  assert.deepEqual(kinds('<meta http-equiv="refresh" content="0;url=https://evil.example">'), ['MARKUP'])
  assert.deepEqual(kinds('<base href="https://evil.example/">'), ['MARKUP'],
    '<base> rewrites every relative URL on the page and is refused outright')
})

// --- Audit, 2026-09-21 ------------------------------------------------------

test('a jumble nevent naming a CALENDAR listing is refused, not cited', () => {
  // An nevent freezes one revision of an event whose whole nature is to be
  // replaced, so the reader clicks through to a meetup whose time has moved.
  // resolve.mjs rewrites these to njump naddrs; this is the half that makes a
  // regression there fail closed, and it is what Validator.kt already did.
  const frozen = toPermalink(CALENDAR_ID)
  assert.deepEqual(kinds(`<a href="${frozen}">the meetup</a>`), ['LINK'])
  // An ordinary note is still citable the normal way.
  assert.deepEqual(kinds(`<a href="${toPermalink(EVENT_ID)}">source</a>`), [])
})

test('resolve turns that frozen citation into the calendar\'s address on Brainstorm', () => {
  const page = `<a href="${toPermalink(CALENDAR_ID)}">the meetup</a>`
  const { html, changes } = resolve(page, corpus)
  assert.deepEqual(changes.map((c) => c.kind), ['calendar'])
  assert.match(html, /brainstorm\.world\/a\/naddr1/)
  assert.deepEqual(check(html, corpus).violations, [])
})

test('a link helper does not read the corpus to answer about a url it cannot parse', () => {
  // The scan used to run BEFORE the regex, so every anchor on the page cost
  // six passes over every desk. Measured at 4,800 events and 528 anchors that
  // was 585 ms in resolve, ~440 ms of it for urls that never matched.
  let reads = 0
  const counted = { get desks () { reads++; return corpus.desks }, art: corpus.art }
  for (const href of ['https://example.test/x', 'mailto:a@b.c', 'https://njump.me/not-an-naddr']) {
    streamLinkTarget(href, counted)
    listingLinkTarget(href, counted)
    calendarLinkTarget(href, counted)
  }
  assert.equal(reads, 0)
})

test('the corpus is indexed once, however many links ask about it', () => {
  let reads = 0
  const counted = { get desks () { reads++; return corpus.desks }, art: corpus.art }
  const stream = toStreamLink(corpus.desks.live[0])
  for (let i = 0; i < 50; i++) assert.ok(streamLinkTarget(stream, counted))
  assert.equal(reads, 1)
})

test('unwrapping an open-web link does not depend on the case of its closing tag', () => {
  // The old search lowercased the WHOLE document once per anchor — 54 MB of
  // copies on a 102 KB page with 528 of them. The sticky search that replaced
  // it also accepts `</a >`, which the literal missed.
  for (const close of ['</a>', '</A>', '</a >']) {
    const page = `<p>before <a href="https://evil.example/x">text${close} after</p>`
    const { html, changes } = resolve(page, corpus)
    assert.deepEqual(changes.map((c) => c.kind), ['unwrapped'])
    assert.match(html, /before text after/)
    assert.doesNotMatch(html, /<a\b/i)
  }
})

// --- brainstorm.world, 2026-09-25 -------------------------------------------

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('an article citation goes to brainstorm.world/a/ by address, not /e/', () => {
  // Articles are edited in place; an nevent would freeze one revision.
  const { html, changes } = resolve(`<a href="https://brainstorm.world/e/${ARTICLE_ID}">Read</a>`, corpus)
  const canonical = toArticleLink(corpus.desks.longform[0])
  assert.match(canonical, /^https:\/\/brainstorm\.world\/a\/naddr1/)
  assert.match(html, new RegExp(`href="${escape(canonical)}"`))
  assert.deepEqual(changes.map((c) => c.kind), ['article'])
  assert.deepEqual(check(html, corpus).violations, [])
  assert.equal(articleLinkTarget(canonical, corpus), ARTICLE_ID)
  // The frozen form is refused, so a regression in resolve fails closed.
  assert.deepEqual(kinds(`<a href="${toPermalink(ARTICLE_ID)}">Read</a>`), ['LINK'])
  // An article address nobody in the corpus published is refused.
  const invented = toArticleLink({ kind: 30023, pubkey: 'd'.repeat(64), tags: [['d', 'fake']] })
  assert.deepEqual(kinds(`<a href="${invented}">Read</a>`), ['LINK'])
})

test('a name links to its author on brainstorm.world, from a post id the writer was given', () => {
  // The writer never sees pubkeys. It names one of the person's posts and
  // resolve swaps in the author's npub.
  const { html, changes } = resolve(`<a href="https://brainstorm.world/p/${ARTICLE_ID}">Roger</a>`, corpus)
  const canonical = toProfileLink(ARTICLE_PK)
  assert.equal(canonical, `https://brainstorm.world/p/${toNpub(ARTICLE_PK)}`)
  assert.match(html, new RegExp(`href="${escape(canonical)}"`))
  assert.match(html, /target="_blank"/)
  assert.deepEqual(changes.map((c) => c.kind), ['profile'])
  assert.deepEqual(check(html, corpus).violations, [])
  assert.equal(profileLinkTarget(canonical, corpus), ARTICLE_PK)
})

test('a profile of somebody who did not post in the window is refused', () => {
  const stranger = toProfileLink('d'.repeat(64))
  assert.deepEqual(kinds(`<a href="${stranger}">someone</a>`), ['LINK'])
  // An unknown post id in the writer form is unwrapped, not guessed at.
  const { html, changes } = resolve(`<a href="https://brainstorm.world/p/${'f'.repeat(64)}">someone</a>`, corpus)
  assert.equal(html, 'someone')
  assert.deepEqual(changes.map((c) => c.kind), ['unwrapped'])
})

// --- the paper's own name, 2026-09-25 ---------------------------------------

test('a configured name is held: the nameplate and title must carry it', () => {
  const named = { ...corpus, paper: { name: 'The Daily Brainstorm' } }
  const page = (plate, title) => `<head><title>${title}</title></head>`
    + `<header class="masthead"><h1>${plate}</h1></header>`
  const nameKinds = (html, c) => check(html, c).violations.map((v) => v.kind)

  // The house nameplate splits "The" into its own span; that is still the name.
  assert.deepEqual(nameKinds(page('<span class="the">The</span>Daily Brainstorm', 'The Daily Brainstorm — Friday, September 25, 2026'), named), [])
  assert.deepEqual(nameKinds(page('The Nostr Observer', 'The Daily Brainstorm — Friday'), named), ['MASTHEAD'],
    'the writer drifting back to the product default is caught')
  assert.deepEqual(nameKinds(page('The Daily Brainstorm', 'The Nostr Observer — Friday'), named), ['MASTHEAD'],
    'the document title carries the name too')
  assert.deepEqual(nameKinds('<p>no nameplate at all</p>', named), ['MASTHEAD'])

  // No setting, no check: the brief's own default and its masthead-change
  // comments stay the writer's business.
  assert.deepEqual(nameKinds(page('The Nostr Observer', 'The Nostr Observer — Friday'), corpus), [])
})

// --- the wires, 2026-09-25 --------------------------------------------------

test('a headline or almanac line from the wires may be quoted word for word; an invented one may not', () => {
  const wired = {
    ...corpus,
    wires: {
      asOf: 1, weather: null, sports: null, notes: [],
      almanac: { date: 'September 25', source: 'Wikipedia (CC BY-SA)', items: [{ year: 1066, text: 'Harald Hardrada is defeated at Stamford Bridge.' }] },
      headlines: [{ source: 'BBC News - World', items: [{ title: 'Leaders meet in Geneva', published: null }] }],
    },
  }
  const wireKinds = (html) => check(html, wired).violations.map((v) => v.kind)
  assert.deepEqual(wireKinds('<q>Leaders meet in Geneva</q>'), [])
  assert.deepEqual(wireKinds('<q>Harald Hardrada is defeated at Stamford Bridge.</q>'), [])
  assert.deepEqual(wireKinds('<q>Leaders fail to meet in Geneva</q>'), ['QUOTE'])
  assert.deepEqual(kinds('<q>Leaders meet in Geneva</q>'), ['QUOTE'], 'no wires in the corpus, nothing to quote from them')
})

// --- the construction, 2026-09-25 -------------------------------------------

test('a front page has one lead and at most one off-lead', () => {
  const fold = (heads) => `<section class="fold">${heads}</section>`
  const lead = '<h2 class="lead-head">A</h2>'
  const off = '<h2 class="main-head">B</h2>'
  const second = '<h3 class="sub-head">C</h3>'
  assert.deepEqual(kinds(fold(lead + off + second + second)), [])
  assert.deepEqual(kinds(fold(lead + second)), [], 'an off-lead is allowed, not required')
  assert.deepEqual(kinds(fold(off + second)), ['LAYOUT'], 'no lead')
  assert.deepEqual(kinds(fold(lead + lead)), ['LAYOUT'], 'two leads')
  assert.deepEqual(kinds(fold(lead + off + off)), ['LAYOUT'], 'two off-leads')
  assert.deepEqual(kinds(lead + lead), [], 'no fold, no front page, no rule: a fragment, or a thin single-column edition')
  const detail = check(fold(off), corpus).violations[0]
  assert.equal(detail.detail, 'a front page has exactly one lead headline (class lead-head); this one has 0')
})

test('the serial and the recipe may be quoted word for word, like any wire', () => {
  const wired = { ...corpus, wires: { asOf: 1, weather: null, sports: null, almanac: null, headlines: [], notes: [],
    serial: { title: 'P&P', author: 'Austen', id: 1342, instalment: 1, of: 2, text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', source: 'Project Gutenberg, public domain' },
    recipe: { name: 'Thai-style steamed fish', kind: '', ingredients: [], method: 'Nestle the fish fillets in a bowl.', art: null, source: 'TheMealDB' },
    cartoon: { title: 'Voyager Instruments', caption: 'Convincing him to turn off the instruments.', number: 1, art: 'art-1', source: 'xkcd' } } }
  const wireKinds = (html) => check(html, wired).violations.map((v) => v.kind)
  assert.deepEqual(wireKinds('<q>a single man in possession of a good fortune</q>'), [])
  assert.deepEqual(wireKinds('<q>Nestle the fish fillets in a bowl.</q>'), [])
  assert.deepEqual(wireKinds('<q>Convincing him to turn off the instruments.</q>'), [])
  assert.deepEqual(wireKinds('<q>a single man in possession of a great fortune</q>'), ['QUOTE'])
})

// --- Long Reads, 2026-09-26 -----------------------------------------------------------

test('an article\'s own summary may be quoted word for word; a reworded one may not, and a note\'s tags are not text', () => {
  const article = { id: '6'.repeat(64), kind: 30023, pubkey: '7'.repeat(64), created_at: 1, content: 'The body of the piece.',
    tags: [['d', 'x'], ['title', 'The Unknown Difficulty'], ['summary', 'Why the hardest part of mining is the part nobody measures.']] }
  const note = { id: '8'.repeat(64), kind: 1, pubkey: '7'.repeat(64), created_at: 1, content: 'hello', tags: [['summary', 'A tag on a note is not something anyone said.']] }
  const shelf = { ...corpus, desks: { ...corpus.desks, articles: [article], notes: [...(corpus.desks.notes || []), note] } }
  const shelfKinds = (html) => check(html, shelf).violations.map((v) => v.kind)
  assert.deepEqual(shelfKinds('<q>Why the hardest part of mining is the part nobody measures.</q>'), [])
  assert.deepEqual(shelfKinds('<q>Why the easiest part of mining is the part nobody measures.</q>'), ['QUOTE'])
  assert.deepEqual(shelfKinds('<q>A tag on a note is not something anyone said.</q>'), ['QUOTE'])
})

// --- the Feature is set by the printer, 2026-09-26 -------------------------------------

test('resolve sets the Feature\'s text exactly from the corpus, escaped, whatever the writer left in its place', () => {
  const feature = {
    kind: 'conversation', title: 'T', authors: ['A'], link: 'https://theconversation.com/x-1', source: 'The Conversation', licence: 'CC BY-ND 4.0', credit: 'c',
    blocks: [{ type: 'p', text: 'Tariffs & <tricks>, said nobody.' }, { type: 'h', text: 'A race?' }, { type: 'p', text: 'Last word.' }],
  }
  const withFeature = { ...corpus, wires: { feature } }
  const empty = '<article class="feature"><h3 class="sub-head">T</h3><div class="feature-text"></div><p class="note">c</p></article>'
  const set = resolve(empty, withFeature).html
  assert.match(set, /<div class="feature-text">\n?<p>Tariffs &amp; &lt;tricks&gt;, said nobody\.<\/p>\n?<h3 class="feature-sub">A race\?<\/h3>\n?<p>Last word\.<\/p>\n?<\/div>/)
  const typed = resolve(empty.replace('<div class="feature-text"></div>', '<div class="feature-text"><p>A paraphrase the licence forbids.</p></div>'), withFeature).html
  assert.equal(typed, set, 'what the writer typed is replaced by the text itself')
  assert.deepEqual(check(set, withFeature).violations, [], 'the set page passes the boundary')
  assert.equal(resolve(empty, corpus).html, empty, 'no Feature in the corpus, nothing set')
})

test('a Sunday story keeps Gutenberg\'s italics as italics', () => {
  const feature = { kind: 'story', title: 'Beyond the Door', authors: ['Philip K. Dick'], link: 'https://www.gutenberg.org/ebooks/28644', source: 'Project Gutenberg', licence: 'public domain in the USA', credit: 'c',
    blocks: [{ type: 'p', text: '_Did you ever wonder at the bird in a cuckoo clock?_' }, { type: 'p', text: 'He set it down _there_, not_here.' }] }
  const html = resolve('<div class="feature-text"></div>', { ...corpus, wires: { feature } }).html
  assert.match(html, /<p><em>Did you ever wonder at the bird in a cuckoo clock\?<\/em><\/p>/)
  assert.match(html, /<p>He set it down <em>there<\/em>, not_here\.<\/p>/, 'an underscore inside a word is left alone')
  const dashed = resolve('<div class="feature-text"></div>', { ...corpus, wires: { feature: { ...feature, blocks: [{ type: 'p', text: 'a clock for his wife--without knowing, and "I wouldn\'t have--"' }] } } }).html
  assert.match(dashed, /wife—without knowing, and "I wouldn't have—"/, 'Gutenberg\'s double hyphen is set as a dash')
})

// --- credit lines are set by the printer, 2026-09-26 ------------------------------------

test('resolve sets the few credits a licence wants beside the work as plain text: no tags, no links', () => {
  const wires = { credits: {
    weather: { source: 'Weather data by Open-Meteo.com', inline: 'Weather data by Open-Meteo.com', url: 'https://open-meteo.com/', licence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } },
    picture: { source: 'Timothy A. Gonsalves / Wikimedia Commons & <co>', url: 'https://commons.wikimedia.org/wiki/File:X.jpg', licence: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } },
    feature: { source: 'The Conversation', url: 'https://theconversation.com/x-1', licence: { name: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/' }, note: 'republished under Creative Commons; read the original' },
  } }
  const html = resolve('<p class="credit" data-credit="weather"></p><p class="credit" data-credit="picture"></p><p class="credit" data-credit="feature"></p><p class="credit" data-credit="nothing"></p>', { ...corpus, wires }).html
  assert.match(html, /<p class="credit" data-credit="weather">Weather data by Open-Meteo\.com<\/p>/, 'the wording Open-Meteo asks for, and nothing else')
  assert.match(html, /<p class="credit" data-credit="picture">Timothy A\. Gonsalves \/ Wikimedia Commons &amp; &lt;co&gt; · CC BY-SA 4\.0<\/p>/)
  assert.match(html, /<p class="credit" data-credit="feature">The Conversation · CC BY-ND 4\.0 · republished under Creative Commons; read the original<\/p>/)
  assert.doesNotMatch(html, /data-href|credit-licence|data-credit="nothing"/)
})

test('resolve adds one "Sources & licences" list at the foot, grouped by section, each source and licence ready to link', () => {
  const wires = { credits: {
    weather: { source: 'Weather data by Open-Meteo.com', url: 'https://open-meteo.com/', licence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } },
    markets: [{ source: 'mempool.space', url: 'https://mempool.space/' }, { source: 'ECB reference rates, via Frankfurter', url: 'javascript:alert(1)' }],
    quakes: { source: 'U.S. Geological Survey', url: 'https://earthquake.usgs.gov/', licence: { name: 'Public domain', url: null } },
    tape: { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/', note: 'delayed; not live, not advice' },
  } }
  const html = resolve('<main class="sheet"><p>The paper.</p></main>', { ...corpus, wires }).html
  const list = /<details class="sources">([\s\S]*?)<\/details>\s*<\/main>/.exec(html)
  assert.ok(list, 'the last thing on the sheet, closed until asked for')
  assert.match(list[1], /^\s*<summary>Sources &amp; licences<\/summary>/)
  assert.match(list[1], /<li><span class="sources-section">The network<\/span> Posts from Nostr, ranked by <span data-href="https:\/\/brainstorm\.world\/">Brainstorm<\/span><\/li>/)
  assert.match(list[1], /<li><span class="sources-section">Weather<\/span> <span data-href="https:\/\/open-meteo\.com\/">Weather data by Open-Meteo\.com<\/span> \(<span data-href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/">CC BY 4\.0<\/span>\)<\/li>/)
  assert.match(list[1], /<li><span class="sources-section">Conditions<\/span> <span data-href="https:\/\/mempool\.space\/">mempool\.space<\/span>; ECB reference rates, via Frankfurter; <span data-href="https:\/\/earthquake\.usgs\.gov\/">U\.S\. Geological Survey<\/span> \(Public domain\)<\/li>/, 'a source without an https link is named, not linked')
  assert.match(list[1], /<li><span class="sources-section">The Tape<\/span> <span data-href="https:\/\/finance\.yahoo\.com\/">Yahoo Finance<\/span>, delayed; not live, not advice<\/li>/)
  assert.deepEqual(check(html, { ...corpus, wires }).violations, [], 'plain text and data attributes: nothing for the boundary to refuse')
  assert.doesNotMatch(resolve('<main class="sheet"></main>', corpus).html, /class="sources"/, 'no wires, no list')
  assert.equal(resolve(html, { ...corpus, wires }).html.match(/<details class="sources">/g).length, 1, 'resolving again sets the list afresh, not twice')
})
