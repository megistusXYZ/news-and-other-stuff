#!/usr/bin/env node
// The half of `Sanitizer.kt` the page actually depends on, and nothing else.
//
// The editorial brief tells the writer to use `<img src="art-3">` and says the
// id "is replaced with the real URL afterwards". Something has to be that
// afterwards, or every picture on a page written to the brief is broken. This
// is it.
//
// THE ID IS THE WHOLE POINT, and it is why this step exists rather than just
// telling the writer to paste URLs. If the writer picked art by writing URLs,
// an invented URL would be indistinguishable from a real one. Handing over ids
// and resolving them here makes a fabricated image reference structurally
// impossible instead of merely detectable.
//
// IT REPORTS EVERYTHING IT CHANGES, loudly, and that is not decoration. A
// dropped figure or an unwrapped link is the visible edge of somebody trying
// to edit a newspaper they do not work for. A sanitizer that cleans up in
// silence would hide exactly the event worth seeing. So: strip, then say so.
//
// Usage: node resolve.mjs <page.html> [--corpus corpus.json] [--out page.html]

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { permalinkTarget, toPermalink, streamLinkTarget, streamWriterTarget, toStreamLink, listingLinkTarget, listingWriterTarget, toListingLink, calendarLinkTarget, calendarWriterTarget, toCalendarLink, articleLinkTarget, toArticleLink, profileLinkTarget, profileWriterTarget, toProfileLink, corpusIndex } from './validate.mjs'
import { fromNevent } from './nostr.mjs'
import { tags, attributes } from './html.mjs'

/**
 * A citation is a source, not a page the paper should be replaced by.
 * `noopener` stops the opened tab from reaching `window.opener`.
 */
export function openInNewTab (raw) {
  let tag = raw
  const attrs = attributes(raw)
  if ((attrs.target || '').toLowerCase() !== '_blank') {
    tag = 'target' in attrs
      ? tag.replace(/(\btarget\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, '$1"_blank"')
      : tag.replace(/^<a\b/i, '<a target="_blank"')
  }
  const rel = new Set((attrs.rel || '').split(/\s+/).filter(Boolean))
  rel.add('noopener')
  rel.add('noreferrer')
  const next = [...rel].join(' ')
  tag = 'rel' in attributes(tag)
    ? tag.replace(/(\brel\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${next}"`)
    : tag.replace(/^<a\b/i, `<a rel="${next}"`)
  return tag
}

/**
 * The event a citation names, in any form a writer or an older edition might
 * use: the brainstorm.world writer form, the jumble.social and njump.me forms
 * this skill used before, or an nevent on any of the three. All of them
 * resolve to the same brainstorm.world address, so an old page still ships
 * rather than having every citation unwrapped.
 */
function citedEventId (href) {
  const canonical = permalinkTarget(href)
  if (canonical) return canonical
  const hex = /^https:\/\/(?:brainstorm\.world\/e\/|jumble\.social\/notes\/|njump\.me\/)([0-9a-f]{64})(?:[/?#].*)?$/i.exec(href)
  if (hex) return hex[1].toLowerCase()
  const nevent = /^https:\/\/(?:brainstorm\.world\/e\/|jumble\.social\/notes\/|njump\.me\/)(nevent1[0-9a-z]+)/i.exec(href)
  if (nevent) {
    try { return fromNevent(nevent[1]) } catch { return null }
  }
  return null
}

function arg (name, fallback = null) {
  const at = process.argv.indexOf(name)
  return at > -1 ? process.argv[at + 1] : fallback
}

/** The first `</a>` at or after `from`, or null. */
function closeAnchor (html, from) {
  const close = /<\/a\s*>/gi
  close.lastIndex = from
  const match = close.exec(html)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}

/** Drop the `<figure>` around `at`, or just the tag if there is no figure. */
function dropFigure (html, start, end) {
  const before = html.lastIndexOf('<figure', start)
  if (before !== -1) {
    const after = html.indexOf('</figure>', end)
    // Only if this figure really encloses the image — a `<figure` earlier in
    // the document that has already closed is not our parent.
    if (after !== -1 && html.slice(before, start).indexOf('</figure>') === -1) {
      return html.slice(0, before) + html.slice(after + '</figure>'.length)
    }
  }
  return html.slice(0, start) + html.slice(end)
}

/**
 * Resolve art ids, drop unknown ones, unwrap links to the open web.
 *
 * Returns the new html and every change made, so the caller can print them.
 */
export function resolve (html, corpus) {
  const byId = new Map((corpus.art || []).map((a) => [a.id, a]))
  const eventIds = new Set(Object.values(corpus.desks).flat().map((e) => e.id))
  const changes = []
  let out = html

  // --- art ids -------------------------------------------------------------
  // Rescanned from the top after each edit because dropping a figure moves
  // every offset after it. Element lookup goes through the quoting-aware
  // scanner: a caption containing `>` used to hide the whole `<img>`, so the
  // id was never resolved and `src="art-3"` shipped as a broken picture that
  // the boundary could not see either.
  for (let guard = 0; guard < 1000; guard++) {
    const img = tags(out, 'img').find((t) => /^art-\d+$/.test(attributes(t.raw).src || ''))
    if (!img) break
    const id = attributes(img.raw).src
    const art = byId.get(id)
    if (art) {
      out = out.slice(0, img.start)
        + img.raw.replace(/(\bsrc\s*=\s*)("art-\d+"|'art-\d+'|art-\d+)/i, `$1"${art.url}"`)
        + out.slice(img.end)
      changes.push({ kind: 'resolved', detail: `${id} -> ${art.url}` })
    } else {
      out = dropFigure(out, img.start, img.end)
      changes.push({ kind: 'dropped', detail: `${id} is not on the shortlist; its figure was removed` })
    }
  }

  // --- links to the open web ----------------------------------------------
  // The paper prints addresses; it does not make them clickable — except
  // source citations, profiles, verified zap.stream watch links, verified
  // Shopstr listing links, and verified njump calendar links. A citation of an
  // event we read is rewritten to brainstorm.world's nevent URL (the writer
  // cites hex; this is the afterwards) — unless it is an article, which goes to
  // brainstorm.world/a/ by address, or a calendar listing, which becomes an
  // njump naddr; both are edited in place and an nevent freezes one revision.
  // A profile writer form names a post and becomes its author's npub. Stream /
  // classified / calendar writer forms are encoded to their host's naddr. Everything else
  // is unwrapped to its own text. Rebuilt back to front so each edit leaves
  // earlier offsets untouched.
  // From the shared index rather than three more passes over every desk — the
  // target helpers below already consult it, and a second set of maps built
  // here is both the same work twice and a chance for the two to disagree
  // about what counts as linkable.
  const { streams, listings, calendars, articles } = corpusIndex(corpus)
  // Point the anchor at `canonical`, open it in a new tab, and log `kind`
  // when the address actually changed.
  const retarget = (anchor, url, canonical, kind) => {
    let tag = anchor.raw
    if (url !== canonical) {
      tag = tag.replace(/(\bhref\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${canonical}"`)
    }
    tag = openInNewTab(tag)
    if (tag !== anchor.raw) {
      out = out.slice(0, anchor.start) + tag + out.slice(anchor.end)
      if (url !== canonical) changes.push({ kind, detail: `${url} -> ${canonical}` })
    }
  }
  const anchors = tags(out, 'a').reverse()
  for (const anchor of anchors) {
    const url = attributes(anchor.raw).href || ''
    if (!/^https?:/i.test(url)) continue
    const id = citedEventId(url)
    // Not `out.toLowerCase().indexOf(…)`: that copied the whole document once
    // per anchor, which on a 102 KB page with 528 anchors is 54 MB of string
    // nobody reads twice. A sticky case-insensitive search costs nothing and
    // also accepts `</a >`, which the literal missed.
    const closing = closeAnchor(out, anchor.end)
    if (!closing) continue
    const streamId = streamWriterTarget(url, corpus) || streamLinkTarget(url, corpus)
    if (streamId && streams.byId.has(streamId)) {
      const canonical = toStreamLink(streams.byId.get(streamId))
      let tag = anchor.raw
      if (url !== canonical) {
        tag = tag.replace(/(\bhref\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${canonical}"`)
      }
      tag = openInNewTab(tag)
      if (tag !== anchor.raw) {
        out = out.slice(0, anchor.start) + tag + out.slice(anchor.end)
        if (url !== canonical) {
          changes.push({ kind: 'stream', detail: `${url} -> ${canonical}` })
        }
      }
      continue
    }
    const listingId = listingWriterTarget(url, corpus) || listingLinkTarget(url, corpus)
    if (listingId && listings.byId.has(listingId)) {
      const canonical = toListingLink(listings.byId.get(listingId))
      let tag = anchor.raw
      if (url !== canonical) {
        tag = tag.replace(/(\bhref\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${canonical}"`)
      }
      tag = openInNewTab(tag)
      if (tag !== anchor.raw) {
        out = out.slice(0, anchor.start) + tag + out.slice(anchor.end)
        if (url !== canonical) {
          changes.push({ kind: 'listing', detail: `${url} -> ${canonical}` })
        }
      }
      continue
    }
    const calendarId = calendarWriterTarget(url, corpus) || calendarLinkTarget(url, corpus)
      || (id && calendars.byId.has(id) ? id : null)
    if (calendarId && calendars.byId.has(calendarId)) {
      const canonical = toCalendarLink(calendars.byId.get(calendarId))
      let tag = anchor.raw
      if (url !== canonical) {
        tag = tag.replace(/(\bhref\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${canonical}"`)
      }
      tag = openInNewTab(tag)
      if (tag !== anchor.raw) {
        out = out.slice(0, anchor.start) + tag + out.slice(anchor.end)
        if (url !== canonical) {
          changes.push({ kind: 'calendar', detail: `${url} -> ${canonical}` })
        }
      }
      continue
    }
    const pubkey = profileWriterTarget(url, corpus) || profileLinkTarget(url, corpus)
    if (pubkey) {
      retarget(anchor, url, toProfileLink(pubkey), 'profile')
      continue
    }
    const articleId = articleLinkTarget(url, corpus) || (id && articles.byId.has(id) ? id : null)
    if (articleId && articles.byId.has(articleId)) {
      retarget(anchor, url, toArticleLink(articles.byId.get(articleId)), 'article')
      continue
    }
    if (id && eventIds.has(id)) {
      const canonical = toPermalink(id)
      let tag = anchor.raw
      if (url !== canonical) {
        tag = tag.replace(/(\bhref\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${canonical}"`)
      }
      // The paper stays put; a citation is not a destination that replaces
      // the edition. A writer who forgets target=_blank still gets it.
      tag = openInNewTab(tag)
      if (tag !== anchor.raw) {
        out = out.slice(0, anchor.start) + tag + out.slice(anchor.end)
        if (url !== canonical) {
          changes.push({ kind: 'permalink', detail: `${url} -> ${canonical}` })
        }
      }
      continue
    }
    out = out.slice(0, anchor.start) + out.slice(anchor.end, closing.start) + out.slice(closing.end)
    changes.push({ kind: 'unwrapped', detail: url.slice(0, 120) })
  }
  changes.reverse()

  // --- the Feature --------------------------------------------------------
  // A no-derivatives article has to be printed exactly as published, so the
  // writer only leaves its place (<div class="feature-text"></div>) and the
  // text is set here, from the corpus, escaped. Anything typed in its place is
  // replaced. A Sunday story's Gutenberg _italics_ become real italics.
  const feature = corpus.wires && corpus.wires.feature
  if (feature && Array.isArray(feature.blocks)) {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const italics = (t) => (feature.kind === 'story'
      ? t.replace(/(^|[^\w])_([^_]+?)_(?=[^\w]|$)/g, '$1<em>$2</em>').replace(/--/g, '—')
      : t)
    const body = feature.blocks.map((b) => (b.type === 'h'
      ? `<h3 class="feature-sub">${esc(b.text)}</h3>`
      : `<p>${italics(esc(b.text))}</p>`)).join('\n')
    const place = /<div class="feature-text">[\s\S]*?<\/div>/
    if (place.test(out)) {
      out = out.replace(place, () => `<div class="feature-text">\n${body}\n</div>`)
      changes.push({ kind: 'feature', detail: `set ${feature.blocks.length} blocks of ${feature.title}` })
    }
  }

  // --- credit lines -------------------------------------------------------
  // The writer leaves <p class="credit" data-credit="weather markets"></p>;
  // the printer sets it from each wire's own attribution, in one style: the
  // source, its licence, and a note when the source asks for one. Plain text
  // with data-href for the living copy to link; a credit with nothing to
  // credit is removed rather than left empty.
  const wiresOf = (corpus.wires || {})
  const escText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const href = (u) => (/^https:\/\/[^\s"'<>]{1,300}$/.test(String(u || '')) ? ` data-href="${String(u).replace(/&/g, '&amp;')}"` : '')
  const credits = wiresOf.credits || {}
  out = out.replace(/<p class="credit" data-credit="([a-zA-Z\s]{1,200})">[\s\S]*?<\/p>/g, (whole, keys) => {
    const items = keys.trim().split(/\s+/).flatMap((key) => (Object.prototype.hasOwnProperty.call(credits, key) ? [].concat(credits[key]) : []))
      .filter((a) => a && a.source)
    if (!items.length) { changes.push({ kind: 'credit', detail: `nothing to credit for ${keys}` }); return '' }
    const line = items.map((a) => `<span class="credit-item"${href(a.url)}>${escText(a.source)}</span>`
      + (a.licence && a.licence.name ? ` <span class="credit-licence"${href(a.licence.url)}>${escText(a.licence.name)}</span>` : '')
      + (a.note ? ` · <span class="credit-note">${escText(a.note)}</span>` : '')).join(' · ')
    return `<p class="credit" data-credit="${keys}">${line}</p>`
  })

  return { html: out, changes }
}

function main () {
  const page = process.argv[2]
  if (!page || page.startsWith('--')) {
    console.error('Usage: node resolve.mjs <page.html> [--corpus corpus.json] [--out page.html]')
    process.exit(2)
  }
  const corpus = JSON.parse(readFileSync(arg('--corpus', 'corpus.json'), 'utf8'))
  const { html, changes } = resolve(readFileSync(page, 'utf8'), corpus)
  writeFileSync(arg('--out', page), html)

  const counts = changes.reduce((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] || 0) + 1 }), {})
  console.log('')
  console.log(`  Resolved ${counts.resolved || 0} art id(s).`)
  if (counts.permalink) console.log(`  Encoded ${counts.permalink} citation(s) to brainstorm.world notes.`)
  if (counts.article) console.log(`  Encoded ${counts.article} article citation(s) to brainstorm.world by address.`)
  if (counts.profile) console.log(`  Linked ${counts.profile} name(s) to brainstorm.world profiles.`)
  if (counts.stream) console.log(`  Encoded ${counts.stream} stream watch link(s) to zap.stream.`)
  if (counts.listing) console.log(`  Encoded ${counts.listing} classified listing link(s) to Shopstr.`)
  if (counts.calendar) console.log(`  Encoded ${counts.calendar} calendar link(s) to Brainstorm.`)
  for (const c of changes.filter((c) => c.kind === 'feature')) console.log(`  Feature: ${c.detail}, word for word.`)
  if (counts.dropped || counts.unwrapped) {
    console.log('')
    console.log('  CHANGES WORTH READING - each of these is the page trying to do something')
    console.log('  the paper does not do. Look at them before you ship:')
    console.log('')
    for (const change of changes.filter((c) => c.kind !== 'resolved' && c.kind !== 'permalink' && c.kind !== 'article' && c.kind !== 'profile' && c.kind !== 'stream' && c.kind !== 'listing' && c.kind !== 'calendar' && c.kind !== 'feature' && c.kind !== 'credit')) {
      console.log(`  ${change.kind.toUpperCase()}: ${change.detail}`)
    }
  }
  console.log('')
}

// Importable by the tests; runs only when it is the thing that was invoked.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
