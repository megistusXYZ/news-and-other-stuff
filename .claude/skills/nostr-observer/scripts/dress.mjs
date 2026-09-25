#!/usr/bin/env node
// Dress a validated edition in the living layer: house typefaces, live
// timestamps, hover cards, portraits beside the people quoted, the reader
// panel, the day's accent and a one-time reveal.
//
// WHY THIS IS A SEPARATE STEP AND NOT SOMETHING THE WRITER DOES. The paper is
// written from strangers' posts, so the page the writer produces must run
// nothing — validate.mjs refuses <script> outright, and that rule is the one
// that stops a post from putting code in the reader's browser. This step
// keeps that true. It runs the same check first and refuses a page that does
// not pass it, and the only script it adds is `reference/living.js`, byte for
// byte. Nothing the writer wrote, and nothing anybody posted, becomes code.
//
// The corpus does travel into the page, as a JSON data island for the hover
// cards and portraits. It is escaped so it cannot close its own
// <script> element, and living.js only ever puts it in the DOM as text.
//
// The dressed copy is written beside the edition as `.living.html`; the
// edition itself is not touched, exactly as embed.mjs writes `.artifact.html`.
//
// Usage: node dress.mjs <page.html> [--corpus corpus.json] [--out page.living.html]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { check, permalinkTarget, articleLinkTarget, calendarLinkTarget, profileLinkTarget, streamLinkTarget, listingLinkTarget, toStreamLink, toListingLink, decodeEntities } from './validate.mjs'
import { tags, attributes, textIn } from './html.mjs'
import { filterFor } from './corpus.mjs'
import { toNpub, BRAINSTORM, ARTICLE_KINDS } from './nostr.mjs'

const REFERENCE = fileURLToPath(new URL('../reference/', import.meta.url))

/** Public relays the hover cards ask for reply / zap counts. Read-only, on hover. */
export const COUNT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

const EXCERPT = 420
// Enough voices to be the page; few enough that the search URL stays sane.
const MAX_SEE_ALL = 12

function arg (name, fallback = null) {
  const at = process.argv.indexOf(name)
  return at > -1 ? process.argv[at + 1] : fallback
}

/** The four families, as @font-face rules with the files inlined. */
export function fontFaces (dir = join(REFERENCE, 'fonts')) {
  const family = {
    'playfair-display': 'Playfair Display',
    'source-serif-4': 'Source Serif 4',
    'ibm-plex-mono': 'IBM Plex Mono',
    figtree: 'Figtree',
  }
  const rules = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.woff2')).sort()) {
    const match = /^(.+)-latin-(\d+)-(normal|italic)\.woff2$/.exec(file)
    if (!match || !family[match[1]]) continue
    const data = readFileSync(join(dir, file)).toString('base64')
    rules.push(`@font-face{font-family:"${family[match[1]]}";font-style:${match[3]};font-weight:${match[2]};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2")}`)
  }
  return rules.join('\n')
}

/** Every brand under `reference/brands/<name>/`: its stylesheet and mark. */
function loadBrands (dir = join(REFERENCE, 'brands')) {
  const brands = {}
  for (const name of readdirSync(dir)) {
    const footer = join(dir, name, 'footer.html')
    brands[name] = {
      css: readFileSync(join(dir, name, 'brand.css'), 'utf8'),
      mark: readFileSync(join(dir, name, 'mark.svg'), 'utf8').trim(),
      footer: existsSync(footer) ? readFileSync(footer, 'utf8') : '',
    }
  }
  return brands
}


/**
 * Inside today: the section bar, printed.
 *
 * What a newspaper's front carries under its nameplate: its sections, not
 * its stories. The front page (the fold), each headed band, the pages of the
 * wires band, and the weather last — with a slot at the right for what is
 * new since the edition closed. One row; the reader asked for nothing that
 * wraps. Printed here so it exists without script; living.js only fills the
 * slot. Sections get ids so the links work on paper as well as on screen.
 */
export function indexRow (html) {
  const hasClass = (raw, name) => new RegExp(`\\b${name}\\b`).test(attributes(raw).class || '')
  const spans = (name) => textIn(html, name).map((t) => ({ ...t, open: tags(html, name).find((o) => o.start === t.start) }))
  const within = (outer, inner) => inner.start > outer.start && inner.start < outer.end
  const label = (inner, name, cls, segment) => {
    const found = spans(name).find((t) => within(inner, t) && (!cls || hasClass(t.open.raw, cls)))
    if (!found) return null
    const text = decodeEntities(found.raw.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    const parts = text.split('·').map((p) => p.trim()).filter(Boolean)
    return (segment === 'first' ? parts[0] : parts[parts.length - 1]) || null
  }

  const sections = spans('section')
  const fold = sections.find((t) => hasClass(t.open.raw, 'fold'))
  const entries = []
  let weather = null
  if (fold) {
    entries.push({ open: fold.open, text: 'Front page' })
    const box = spans('div').find((t) => within(fold, t) && hasClass(t.open.raw, 'box') && hasClass(t.open.raw, 'weather'))
    if (box) weather = { open: box.open, text: 'Weather' }
  }
  for (const band of sections.filter((t) => hasClass(t.open.raw, 'band') && !hasClass(t.open.raw, 'seconds'))) {
    if (hasClass(band.open.raw, 'tinted')) {
      // The wires band is listed by its pages — Sports, Almanac, Wider World
      // — the way a paper's nav lists them, not by the band's own name.
      for (const cell of spans('div').filter((t) => within(band, t) && hasClass(t.open.raw, 'cell'))) {
        const text = label(cell, 'p', 'box-head', 'first')
        if (text) entries.push({ open: cell.open, text })
      }
    } else {
      const text = label(band, 'h2')
      if (text) entries.push({ open: band.open, text })
    }
  }
  entries.sort((a, b) => a.open.start - b.open.start)
  if (weather) entries.push(weather)
  if (entries.length < 3) return html

  // Ids into the open tags, back to front so earlier offsets hold.
  let out = html
  entries.forEach((e, i) => { e.id = attributes(e.open.raw).id || `lv-section-${i + 1}` })
  for (const e of [...entries].sort((a, b) => b.open.start - a.open.start)) {
    if (!attributes(e.open.raw).id) {
      const tag = e.open.raw.replace(/>$/, ` id="${e.id}">`)
      out = out.slice(0, e.open.start) + tag + out.slice(e.open.end)
    }
  }
  const links = entries.map((e) => `<a href="#${e.id}">${e.text}</a>`)
  const nav = `<nav class="lv-index" aria-label="Inside today"><span class="lv-sections">${links.join('')}</span><span class="lv-since-slot"></span></nav>`

  // Under the dateline if the writer set one, else straight under the nameplate.
  const masthead = tags(out, 'header').find((t) => hasClass(t.raw, 'masthead'))
  if (!masthead) return html
  let at = out.indexOf('</header>', masthead.end)
  if (at === -1) return html
  at += '</header>'.length
  const dateline = textIn(out, 'div').find((t) => t.start >= at && hasClass(tags(out, 'div').find((o) => o.start === t.start).raw, 'dateline'))
  if (dateline && out.slice(at, dateline.start).trim() === '') at = out.indexOf('</div>', dateline.end) + '</div>'.length
  return out.slice(0, at) + nav + out.slice(at)
}

/** sha-256 of `code:row:col:digit` for every cell; the page checks, never reads. */
export function hashedPuzzle (code, solution) {
  const cells = solution.map((row, r) => row.map((digit, c) => createHash('sha256').update(`${code}:${r}:${c}:${digit}`).digest('hex')))
  return { code, cells }
}

/** The word game's lists: the answers we chose, the guesses web2 allows. */
function loadFiveWords () {
  const words = (name) => readFileSync(join(REFERENCE, name), 'utf8').split(/\n/).map((w) => w.trim()).filter((w) => /^[a-z]{5}$/.test(w))
  return { answers: words('five-answers.txt'), guesses: words('five-guesses.txt') }
}

/**
 * The word of the day as hashes: one per position (`five:day:i:letter`) and
 * one per letter occurrence (`five:day:letter:k`), so the page can score a
 * guess the way Wordle does — repeated letters and all — and, on a loss, find
 * the answer by trying the answer list against the position hashes. The word
 * itself is nowhere in the page.
 */
export function hashedFive (five, words) {
  const sha = (text) => createHash('sha256').update(text).digest('hex')
  const answer = five.answer.toLowerCase()
  const seen = {}
  const letters = [...answer].map((ch) => { seen[ch] = (seen[ch] || 0) + 1; return sha(`five:${five.day}:${ch}:${seen[ch]}`) })
  return {
    name: five.name,
    day: five.day,
    positions: [...answer].map((ch, i) => sha(`five:${five.day}:${i}:${ch}`)),
    letters: letters.sort(),
    answers: words.answers,
    guesses: [...new Set([...words.guesses, ...words.answers])],
  }
}

/**
 * A webp's width and height, read from its header: the extended form (VP8X,
 * which anything with transparency uses) or plain lossy (VP8 ). Null when
 * the bytes are not a webp we can read.
 */
function webpSize (base64) {
  const b = Buffer.from(base64, 'base64')
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
  return null
}

/** Every stamp under `reference/stamps/`: a small webp, as base64. */
function loadStamps (dir = join(REFERENCE, 'stamps')) {
  const stamps = {}
  if (!existsSync(dir)) return stamps
  for (const file of readdirSync(dir).filter((f) => /^[a-z0-9-]+\.webp$/.test(f))) {
    stamps[file.replace(/\.webp$/, '')] = readFileSync(join(dir, file)).toString('base64')
  }
  return stamps
}

/** Everything dress() injects, read from `reference/`. */
export function loadAssets () {
  return {
    brands: loadBrands(),
    stamps: loadStamps(),
    fiveWords: loadFiveWords(),
    fonts: fontFaces(),
    css: readFileSync(join(REFERENCE, 'living.css'), 'utf8'),
    js: readFileSync(join(REFERENCE, 'living.js'), 'utf8'),
    hls: readFileSync(join(REFERENCE, 'vendor', 'hls.light.min.js'), 'utf8'),
  }
}

/**
 * JSON that cannot end the <script> element it sits in. `<` covers
 * `</script>` and `<!--`; U+2028 / U+2029 are line terminators to old parsers.
 */
export function islandJson (value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** A trusted asset must not be able to close the element it is inlined in. */
function assertInlinable (name, text) {
  if (/<\/script/i.test(text)) throw new Error(`${name} contains "</script" and cannot be inlined`)
}

function excerpt (text) {
  const clean = String(text || '')
    // nostr: URIs and bare links are noise in a card; the card is for reading.
    .replace(/nostr:[a-z0-9]+/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > EXCERPT ? clean.slice(0, EXCERPT - 1).trimEnd() + '…' : clean
}

const title = (event) => (event.tags || []).find((t) => t[0] === 'title')?.[1] || null

/**
 * Long-form is markdown; a card reads it as prose. The heading that repeats
 * the article's title goes (the card already shows the title), and so do the
 * marks: headings, quotes, list bullets, rules, images, emphasis and code
 * ticks. A link keeps its words and loses its address.
 */
function prose (markdown, heading) {
  const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')
  const lines = String(markdown || '').split('\n')
  const first = lines.findIndex((line) => line.trim())
  if (first > -1 && heading && squash(lines[first].replace(/^\s*#+/, '')) === squash(heading)) lines.splice(first, 1)
  return lines
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*(?:[-*_]\s*){3,}$/, ''))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/gm, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
}

/**
 * Dress a page. Pure: no files, so a test can hand it any page, any corpus
 * and any assets. Throws on a page that has not passed validate.
 */
export function dress (html, corpus, assets) {
  if (/id=["']?observer-data/.test(html)) throw new Error('This page is already dressed. Dress the validated edition, not its living copy.')
  const { violations } = check(html, corpus)
  if (violations.length) {
    const error = new Error(`The edition has not passed validate.mjs (${violations.length} violation(s)). Fix it and validate first; only a clean page is dressed.`)
    error.violations = violations
    throw error
  }
  for (const name of ['fonts', 'css', 'js', 'hls']) if (assets[name]) assertInlinable(name, assets[name])

  // The reader's brand, from observer.config.json by way of the corpus. An
  // unknown name is refused rather than silently printed unbranded.
  const brandName = corpus.paper?.brand || null
  const brand = brandName ? assets.brands?.[brandName] : null
  if (brandName && !brand) throw new Error(`Unknown brand "${brandName}". Brands live in reference/brands/.`)
  // The paper's stamp, beside its nameplate: our own picture, inlined as a
  // CSS variable the stylesheet places. Base64 only, so it cannot close a tag.
  const stampName = corpus.paper?.stamp || null
  const stamp = stampName ? assets.stamps?.[stampName] : null
  if (stampName && !stamp) throw new Error(`Unknown stamp "${stampName}". Stamps live in reference/stamps/.`)
  if (stamp && !/^[A-Za-z0-9+/]+=*$/.test(stamp)) throw new Error(`The ${stampName} stamp must be base64.`)
  // Its own proportions, so the cut is drawn at its true shape.
  const stampSize = stamp ? webpSize(stamp) : null
  const stampRatio = stampSize ? `;--lv-stamp-ratio:${stampSize.w} / ${stampSize.h}` : ''
  if (brand) {
    assertInlinable(`${brandName} css`, brand.css)
    assertInlinable(`${brandName} mark`, brand.mark)
    if (/<script|\son[a-z]+\s*=/i.test(brand.mark)) throw new Error(`The ${brandName} mark must be a plain SVG.`)
    if (brand.footer && /<script|\son[a-z]+\s*=|javascript:/i.test(brand.footer)) throw new Error(`The ${brandName} footer must be plain markup.`)
  }

  const events = Object.values(corpus.desks).flat()
  const byId = new Map(events.map((e) => [e.id, e]))
  const profiles = corpus.profiles || {}

  // --- annotate the anchors the page already has ---------------------------
  // data-ev / data-pk / data-t are what living.js keys everything on. They are
  // derived from hrefs validate.mjs has just accepted, never from page text.
  const cited = new Map()
  const people = new Set()
  let out = html
  const streams = new Map()
  const listings = new Map()
  for (const anchor of tags(out, 'a').reverse()) {
    const href = attributes(anchor.raw).href || ''
    // The wireless and the classifieds: links validate.mjs accepted as a
    // live stream or a listing in the corpus. They open the paper's own
    // player and listing sheet rather than leaving it.
    const streamId = streamLinkTarget(href, corpus)
    const listingId = streamId ? null : listingLinkTarget(href, corpus)
    if (streamId || listingId) {
      const event = byId.get(streamId || listingId)
      if (streamId) streams.set(streamId, event)
      else { listings.set(listingId, event); people.add(event.pubkey) }
      const tag = anchor.raw.replace(/^<a\b/i, `<a data-${streamId ? 'stream' : 'listing'}="${streamId || listingId}"`)
      out = out.slice(0, anchor.start) + tag + out.slice(anchor.end)
      continue
    }
    let id = permalinkTarget(href) || articleLinkTarget(href, corpus) || calendarLinkTarget(href, corpus)
    if (id && !byId.has(id)) id = null
    const pubkey = id ? byId.get(id).pubkey : profileLinkTarget(href, corpus)
    if (!id && !pubkey) continue
    const attrs = []
    if (id) {
      cited.set(id, byId.get(id))
      attrs.push(`data-ev="${id}"`, `data-t="${byId.get(id).created_at}"`)
    }
    if (pubkey) {
      people.add(pubkey)
      attrs.push(`data-pk="${pubkey}"`)
    }
    const tag = anchor.raw.replace(/^<a\b/i, `<a ${attrs.join(' ')}`)
    out = out.slice(0, anchor.start) + tag + out.slice(anchor.end)
  }

  // --- pictures: the lead first, the rest when they are near ---------------
  // The page is long and its pictures are hotlinked; a phone should not fetch
  // a 4000px spread photograph to read the front. The first picture is the
  // lead and gets priority; every other one waits for the reader's scroll.
  // Cameos and sheet pictures are made by living.js, which lazies its own.
  const pictures = tags(out, 'img')
  // Spliced from the end so earlier offsets stay valid; the lead is index 0.
  for (const [i, img] of [...pictures.entries()].reverse()) {
    const attrs = attributes(img.raw)
    const add = []
    if (i === 0) {
      if (!('fetchpriority' in attrs)) add.push('fetchpriority="high"')
    } else {
      if (!('loading' in attrs)) add.push('loading="lazy"')
      if (!('decoding' in attrs)) add.push('decoding="async"')
    }
    if (!add.length) continue
    const tag = img.raw.replace(/^<img\b/i, `<img ${add.join(' ')}`)
    out = out.slice(0, img.start) + tag + out.slice(img.end)
  }

  // --- the data island -----------------------------------------------------
  const https = (url) => (/^https:\/\/[^\s"'<>]{1,500}$/.test(String(url || '')) ? url : null)
  const tagOf = (e, name) => (e.tags || []).find((t) => t[0] === name)?.[1] ?? null
  const tagsOf = (e, name) => (e.tags || []).filter((t) => t[0] === name).map((t) => t[1])
  const streamsOut = {}
  for (const [id, e] of streams) {
    const listeners = parseInt(tagOf(e, 'current_participants'), 10)
    const starts = parseInt(tagOf(e, 'starts'), 10)
    streamsOut[id] = {
      title: tagOf(e, 'title'),
      summary: tagOf(e, 'summary') ? String(tagOf(e, 'summary')).slice(0, 400) : null,
      image: https(tagOf(e, 'image') || tagOf(e, 'thumb')),
      status: tagOf(e, 'status'),
      starts: Number.isFinite(starts) ? starts : null,
      listeners: Number.isFinite(listeners) ? listeners : null,
      tags: tagsOf(e, 't').filter((t) => !t.includes(':')).slice(0, 5),
      // Only an https HLS playlist is a feed the page will play.
      hls: tagsOf(e, 'streaming').find((u) => https(u) && /\.m3u8(\?|$)/.test(u)) || null,
      url: toStreamLink(e),
      address: { kind: e.kind, pubkey: e.pubkey, d: tagOf(e, 'd') },
    }
  }
  const listingsOut = {}
  for (const [id, e] of listings) {
    const price = (e.tags || []).find((t) => t[0] === 'price')
    listingsOut[id] = {
      title: tagOf(e, 'title'),
      price: price ? { amount: price[1], currency: price[2] || null } : null,
      images: tagsOf(e, 'image').map(https).filter(Boolean).slice(0, 6),
      summary: tagOf(e, 'summary') ? String(tagOf(e, 'summary')).slice(0, 400) : null,
      text: String(e.content || '').slice(0, 1600),
      location: tagOf(e, 'location'),
      tags: tagsOf(e, 't').slice(0, 6),
      status: tagOf(e, 'status'),
      seller: e.pubkey,
      url: toListingLink(e),
      // Where the seller actually sells: the listing's own `r` link. The one
      // open-web link the living layer ever offers, because a classified is
      // an offer and the offer lives there — https only, from the listing's
      // structured tag and never from its text, and shown with its host.
      link: tagsOf(e, 'r').find(https) || null,
    }
  }
  // The reading order the panel's arrows step through: every cited post and
  // article once, as the page first meets it. People, stations and listings
  // are opened from their own links, not stepped to.
  const sequence = [...new Set(tags(out, 'a').map((a) => attributes(a.raw)['data-ev']).filter(Boolean))]

  const eventsOut = {}
  for (const [id, e] of cited) {
    eventsOut[id] = { id, pk: e.pubkey, kind: e.kind, t: e.created_at, title: title(e), text: excerpt(ARTICLE_KINDS.has(e.kind) ? prose(e.content, title(e)) : e.content) }
  }
  const peopleOut = {}
  for (const pk of people) {
    const p = profiles[pk] || {}
    peopleOut[pk] = {
      name: p.name || null,
      nip05: p.nip05 || null,
      picture: /^https:\/\/[^\s"'<>]{1,500}$/.test(String(p.picture || '')) ? p.picture : null,
      about: p.about ? excerpt(p.about).slice(0, 280) : null,
      // Their stories in this paper, in reading order: a profile in the
      // panel lists them under "In today's paper".
      stories: sequence.filter((id) => byId.get(id)?.pubkey === pk),
    }
  }

  // The live strip: the same ranked read the edition was made from, picked
  // up where the window closed. And the Brainstorm search that shows it in
  // full — the page's voices, in the order the page meets them, newest first.
  const onPage = []
  for (const anchor of tags(out, 'a')) {
    const pk = attributes(anchor.raw)['data-pk']
    if (pk && !onPage.includes(pk)) onPage.push(pk)
  }
  const day = new Date(corpus.until * 1000).toISOString().slice(0, 10)
  const query = [...onPage.slice(0, MAX_SEE_ALL).map((pk) => `from:${toNpub(pk)}`), `since:${day}`].join(' ')
  const search = new URLSearchParams({ q: query, t: 'notes', f: 'sort:recent' })
  const { until: _until, ...liveFilter } = filterFor([1], corpus.until, null, 40, corpus.observer, corpus.floor)
  const since = {
    relay: corpus.relay || null,
    filter: corpus.observer ? liveFilter : null,
    seeAll: `${BRAINSTORM}/?${search.toString().replace(/\+/g, '%20')}`,
  }

  const island = {
    brand: brandName,
    // The sudoku, as one hash per cell: the living copy can check a digit or
    // reveal one cell (nine hashes to try), and the answer is nowhere in the page.
    puzzle: corpus.wires && corpus.wires.puzzle ? hashedPuzzle(corpus.code, corpus.wires.puzzle.solution) : null,
    five: corpus.wires && corpus.wires.five && assets.fiveWords ? hashedFive(corpus.wires.five, assets.fiveWords) : null,
    streams: streamsOut,
    listings: listingsOut,
    since,
    code: corpus.code,
    start: corpus.since,
    until: corpus.until,
    relays: COUNT_RELAYS,
    sequence,
    // The reader's clock, for the page's own times ("since 11:09 p.m. CDT"):
    // their place's zone from the weather, 12 hours for a US paper.
    clock: corpus.wires && corpus.wires.weather && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(String(corpus.wires.weather.timezone || ''))
      ? { timezone: corpus.wires.weather.timezone, hour12: corpus.wires.weather.unit === '°F' }
      : null,
    events: eventsOut,
    people: peopleOut,
  }

  const head = `<style id="living-fonts">\n${assets.fonts}\n</style>\n<style id="living-css">\n${assets.css}</style>\n`
    + (brand ? `<style id="brand-css">\n${brand.css}</style>\n` : '')
    + (stamp ? `<style id="living-stamp">:root{--lv-stamp:url("data:image/webp;base64,${stamp}")${stampRatio}}</style>\n` : '')
  // The printer's colophon, for a branded paper only: who made it and how to
  // get your own. The brand's own markup, with the reader's paper name in it.
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const colophon = brand && brand.footer
    ? brand.footer.trim().replaceAll('{{name}}', escapeHtml(corpus.paper?.name || 'This paper')).replaceAll('{{mark}}', brand.mark) + '\n'
    : ''
  const tail = `<script type="application/json" id="observer-data">${islandJson(island)}</script>\n`
    // The player library, inert text until a reader presses play — and only
    // on a paper that has something to play.
    + (Object.values(streamsOut).some((st) => st.hls) && assets.hls ? `<script type="text/plain" id="hls-src">${assets.hls}</script>\n` : '')
    + `<script type="module" id="living-js">${assets.js}</script>\n`

  if (!/<\/head>/i.test(out) || !/<\/body>/i.test(out)) throw new Error('The edition needs a <head> and a <body> to dress.')
  out = out.replace(/<\/head>/i, `${head}</head>`)
  if (brand) out = out.replace(/<html\b/i, `<html data-brand="${brandName}"`)
  if (stamp) out = out.replace(/<html\b/i, `<html data-stamp="${stampName}"`)
  // The stamp is set as a cut before the nameplate — a profile engraving
  // facing into the name, spanning the name and the motto, the way old
  // papers set a cut in the left ear. First in the header; the name's own
  // text is not touched.
  if (stamp) {
    const masthead = tags(out, 'header').find((t) => /\bmasthead\b/.test(attributes(t.raw).class || ''))
    if (masthead) out = out.slice(0, masthead.end) + '<span class="lv-cut" aria-hidden="true"></span>' + out.slice(masthead.end)
  }
  out = indexRow(out)

  // The colophon is the last thing on the sheet, inside its margins; with no
  // sheet, it is the last thing on the page.
  if (colophon) {
    const sheet = tags(out, 'main').find((t) => /\bsheet\b/.test(attributes(t.raw).class || ''))
    const end = sheet ? out.lastIndexOf('</main>') : -1
    if (end > -1) out = out.slice(0, end) + colophon + out.slice(end)
    else out = out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${colophon}</body>`)
  }
  const close = out.search(/<\/body>(?![\s\S]*<\/body>)/i)
  out = out.slice(0, close) + tail + out.slice(close)

  return {
    html: out,
    stats: { cited: cited.size, people: people.size },
  }
}

function main () {
  const page = process.argv[2]
  if (!page || page.startsWith('--')) {
    console.error('Usage: node dress.mjs <page.html> [--corpus corpus.json] [--out page.living.html]')
    process.exit(2)
  }
  const corpus = JSON.parse(readFileSync(arg('--corpus', 'corpus.json'), 'utf8'))
  const out = arg('--out', page.replace(/\.html$/i, '') + '.living.html')
  let result
  try {
    result = dress(readFileSync(page, 'utf8'), corpus, loadAssets())
  } catch (error) {
    console.error(`\n  NOT DRESSED: ${error.message}\n`)
    for (const v of error.violations || []) console.error(`  ${v.kind}: ${v.detail}\n    ${v.excerpt}`)
    process.exit(1)
  }
  writeFileSync(out, result.html)
  const { cited, people } = result.stats
  console.log('')
  console.log(`  Dressed: ${out}`)
  console.log(`  ${cited} cited posts and ${people} people get hover cards.`)
  console.log(`  ${(Buffer.byteLength(result.html) / 1024).toFixed(0)} KB, self-contained. The edition itself is unchanged.`)
  console.log('')
}

// Importable by the tests; runs only when it is the thing that was invoked.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
