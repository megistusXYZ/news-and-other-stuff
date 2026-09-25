// The living layer. Attached by scripts/dress.mjs to an edition that has
// ALREADY passed validate.mjs; the writer never sees or writes this file.
//
// Two rules hold everywhere below:
//
// 1. EVERY STRING FROM THE CORPUS IS UNTRUSTED. It reaches the DOM through
//    textContent and nothing else — never innerHTML. A bio or a note is
//    somebody else's writing, and this is the one place on the page where it
//    arrives unchecked by the quote gate.
// 2. MOTION SETTLES, THEN STOPS. Things move once on load and on touch, and
//    then the page is still, as a page should be. prefers-reduced-motion turns
//    every animation off.

const island = document.getElementById('observer-data')
const data = island ? JSON.parse(island.textContent) : null
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

const counted = new Map()


// A failure in one part must not take the others, or the paper, with it.
function guard (part) {
  try {
    const running = part()
    if (running && running.catch) running.catch((error) => console.warn('living:', part.name, error))
  } catch (error) {
    console.warn('living:', part.name, error)
  }
}

// --- small helpers ---------------------------------------------------------

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

function el (tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function ago (seconds) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - seconds))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

// A stable 0..1 from a hex key, so layout and fallback colour never change
// between reloads of the same edition.
function unit (hex, salt = 0) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < hex.length; i++) {
    h ^= hex.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

// --- the day's accent, from the lead photograph ----------------------------
//
// One colour per edition: the lead picture's dominant hue, pushed dark enough
// to read on newsprint. When the host will not let us read its pixels (no
// CORS), the hue comes from the date instead — still one colour per day.

function accent () {
  const fallback = () => setAccent(unit(String(data.until), 7) * 360, 0.46)
  const lead = document.querySelector('.fold figure img, figure img')
  if (!lead || !lead.currentSrc && !lead.src) return fallback()
  const probe = new Image()
  probe.crossOrigin = 'anonymous'
  probe.referrerPolicy = 'no-referrer'
  probe.onerror = fallback
  probe.onload = () => {
    try {
      const size = 32
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(probe, 0, 0, size, size)
      const px = ctx.getImageData(0, 0, size, size).data
      // Weight each pixel by its saturation, so grey sky and white walls do
      // not wash the colour out.
      let x = 0; let y = 0; let weight = 0
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] / 255; const g = px[i + 1] / 255; const b = px[i + 2] / 255
        const max = Math.max(r, g, b); const min = Math.min(r, g, b)
        const sat = max === 0 ? 0 : (max - min) / max
        if (sat < 0.12 || max < 0.12) continue
        const hue = hueOf(r, g, b, max, min)
        const w = sat * sat
        x += Math.cos(hue) * w; y += Math.sin(hue) * w; weight += w
      }
      if (weight < 2) return fallback()
      const degrees = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
      setAccent(degrees, 0.52)
    } catch {
      fallback() // a tainted canvas throws here
    }
  }
  probe.src = lead.currentSrc || lead.src
}

function hueOf (r, g, b, max, min) {
  const d = max - min
  let h = 0
  if (d === 0) h = 0
  else if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60) * Math.PI / 180
}

function setAccent (hue, saturation) {
  // Lightness fixed at 32%: dark enough for small caps on cream paper at
  // better than 7:1, whatever hue the photograph hands us.
  document.documentElement.style.setProperty('--accent', `hsl(${hue.toFixed(0)} ${(saturation * 100).toFixed(0)}% 32%)`)
}

// --- live timestamps -------------------------------------------------------
//
// Each story's byline gets the age of the newest post it cites, and the ages
// keep counting while the page is open. The edition is a snapshot; this says
// how old the snapshot is getting.

function timestamps () {
  const stamps = []
  for (const story of $$('.story, .band .cell')) {
    const times = $$('a[data-t]', story).map((a) => Number(a.dataset.t)).filter(Boolean)
    // In the byline line, small and grey, where a paper dates a story. A
    // story with no byline gets no stamp: the section label stays a label,
    // and the index row's live count already says the paper is breathing.
    const host = story.querySelector('.byline')
    if (!times.length || !host) continue
    const newest = Math.max(...times)
    const stamp = el('time', 'lv-ago')
    stamp.dateTime = new Date(newest * 1000).toISOString()
    stamp.title = new Date(newest * 1000).toUTCString()
    host.append(stamp)
    stamps.push([stamp, newest])
  }
  const tick = () => { for (const [stamp, t] of stamps) stamp.textContent = ago(t) }
  tick()
  setInterval(tick, 30_000)
}

// --- the one-time reveal ---------------------------------------------------
//
// The page is fully readable without this: the hiding class is only ever
// added here, by script, and removed within the second the element is seen.

function reveal () {
  if (reduce || !('IntersectionObserver' in window)) return
  const groups = [
    ...$$('.fold > .col').map((col) => [...col.children]),
    ...$$('.band').map((band) => [...band.querySelectorAll('.band-head, .cell')]),
  ]
  const items = []
  for (const group of groups) {
    group.forEach((node, i) => {
      node.style.setProperty('--lv-delay', `${Math.min(i, 5) * 70}ms`)
      node.classList.add('lv-pre')
      items.push(node)
    })
  }
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('lv-in')
      entry.target.classList.remove('lv-pre')
      seen.unobserve(entry.target)
    }
  }, { threshold: 0.08 })
  for (const item of items) seen.observe(item)
  // Belt and braces: nothing stays hidden if the observer never fires.
  setTimeout(() => $$('.lv-pre').forEach((n) => { n.classList.add('lv-in'); n.classList.remove('lv-pre') }), 6000)
}

// --- hover cards -----------------------------------------------------------
//
// Built from what the edition captured, so a card is instant and works
// offline. When online, a note's card then asks a couple of public relays how
// many replies, reposts, reactions and zaps it has — a count, fetched on
// hover and once per note, never stored.

function cards () {
  const card = el('div', 'lv-card')
  card.setAttribute('role', 'tooltip')
  document.body.append(card)
  let showTimer = 0
  let hideTimer = 0
  let current = null

  const show = (anchor) => {
    clearTimeout(hideTimer)
    if (current === anchor) return
    clearTimeout(showTimer)
    showTimer = setTimeout(() => {
      const built = build(anchor)
      if (!built || document.body.classList.contains('lv-reading-open')) return
      current = anchor
      warmReader(anchor.href)
      card.replaceChildren(...built)
      place(anchor)
      card.classList.add('lv-show')
    }, 160)
  }
  const hide = () => {
    clearTimeout(showTimer)
    hideTimer = setTimeout(() => {
      card.classList.remove('lv-show')
      current = null
    }, 140)
  }

  const hideNow = () => {
    clearTimeout(showTimer)
    card.classList.remove('lv-show')
    current = null
  }

  const place = (anchor) => {
    const r = anchor.getBoundingClientRect()
    const w = card.offsetWidth || 320
    const h = card.offsetHeight || 160
    let left = Math.min(Math.max(12, r.left), innerWidth - w - 12)
    let top = r.bottom + 8
    if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8)
    card.style.left = `${left}px`
    card.style.top = `${top}px`
  }

  const target = (event) => event.target.closest && event.target.closest('a[data-ev], a[data-pk]')
  document.addEventListener('mouseover', (e) => { const a = target(e); if (a) show(a) })
  document.addEventListener('mouseout', (e) => { const a = target(e); if (a && !a.contains(e.relatedTarget)) hide() })
  document.addEventListener('focusin', (e) => { const a = target(e); if (a) show(a) })
  document.addEventListener('focusout', (e) => { if (target(e)) hide() })
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer))
  card.addEventListener('mouseleave', hide)
  addEventListener('scroll', () => { if (current) place(current) }, { passive: true })

  function build (anchor) {
    const ev = anchor.dataset.ev && data.events[anchor.dataset.ev]
    const pk = anchor.dataset.pk || (ev && ev.pk)
    const person = pk && data.people[pk]
    if (!ev && !person) return null
    const parts = []

    const head = el('div', 'lv-card-head')
    head.append(avatar(person))
    const who = el('div')
    who.append(el('div', 'lv-card-name', (person && person.name) || 'Someone on nostr'))
    const meta = ev ? ago(ev.t) : (person && person.nip05) || ''
    if (meta) who.append(el('div', 'lv-card-meta', meta))
    head.append(who)
    parts.push(head)

    if (ev) {
      if (ev.title) parts.push(el('div', 'lv-card-title', ev.title))
      if (ev.text) parts.push(el('div', 'lv-card-text', ev.text))
    } else if (person && person.about) {
      parts.push(el('div', 'lv-card-text', person.about))
    }

    const counts = el('div', 'lv-card-counts')
    parts.push(counts)
    // One quiet action, and it stays in the paper: the post or the profile
    // opens in the reader panel beside the page. Brainstorm proper, where the
    // reader can zap or follow, is one deliberate click further, in the
    // panel's header — or straight away with a modifier-click, since the link
    // is a real link. → stays here; ↗ would leave.
    const foot = el('div', 'lv-card-foot')
    const go = el('a', 'lv-card-go', ev ? 'Read post →' : 'View profile →')
    go.href = anchor.href
    go.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      hideNow()
      openReader(anchor.href, anchor)
    })
    foot.append(go)
    parts.push(foot)
    if (ev) live(ev.id, counts)
    return parts
  }

  function avatar (person) {
    if (person && person.picture && /^https:\/\//.test(person.picture)) {
      const img = el('img', 'lv-card-avatar')
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.loading = 'lazy'
      img.src = person.picture
      img.onerror = () => img.replaceWith(monogram(person))
      return img
    }
    return monogram(person)
  }

  function monogram (person) {
    const name = (person && person.name) || '?'
    return el('div', 'lv-card-monogram', [...name.trim()][0] || '?')
  }
}

function live (id, into) {
  if (!navigator.onLine || !('WebSocket' in window)) return
  const render = (c) => {
    const bits = []
    if (c.replies) bits.push(`${c.replies} ${c.replies === 1 ? 'reply' : 'replies'}`)
    if (c.reposts) bits.push(`${c.reposts} repost${c.reposts === 1 ? '' : 's'}`)
    if (c.reactions) bits.push(`${c.reactions} ♥`)
    if (c.zaps) bits.push(`${c.zaps} ⚡`)
    into.textContent = bits.join(' · ')
  }
  const known = counted.get(id)
  if (known) return known.then(render)
  const pending = countOn(data.relays || [], id)
  counted.set(id, pending)
  pending.then(render)
}

function countOn (relays, id) {
  return new Promise((resolve) => {
    const seen = { 1: new Set(), 6: new Set(), 7: new Set(), 9735: new Set() }
    let open = 0
    const done = () => {
      resolve({ replies: seen[1].size, reposts: seen[6].size, reactions: seen[7].size, zaps: seen[9735].size })
    }
    const deadline = setTimeout(finish, 4000)
    const sockets = []
    function finish () {
      clearTimeout(deadline)
      for (const ws of sockets) { try { ws.close() } catch {} }
      done()
    }
    for (const url of relays.slice(0, 3)) {
      let ws
      try { ws = new WebSocket(url) } catch { continue }
      sockets.push(ws)
      open++
      const sub = 'lv' + Math.random().toString(36).slice(2, 8)
      ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, { kinds: [1, 6, 7, 9735], '#e': [id], limit: 500 }]))
      ws.onmessage = (message) => {
        let frame
        try { frame = JSON.parse(message.data) } catch { return }
        if (frame[0] === 'EVENT' && frame[2] && seen[frame[2].kind]) seen[frame[2].kind].add(frame[2].id)
        if (frame[0] === 'EOSE' || frame[0] === 'CLOSED') {
          try { ws.close() } catch {}
          if (--open === 0) finish()
        }
      }
      ws.onerror = () => { if (--open === 0) finish() }
    }
    if (open === 0) finish()
  })
}

// --- the reader panel: reading through Brainstorm ------------------------
//
// A citation, article or name opens the real brainstorm.world page in a panel
// over the paper, which stays behind it, dimmed. The address carries
// `#read=<path>`, so Back closes the panel and a reload or a shared link
// reopens it. Arrow keys walk every citation in reading order.
//
// Only brainstorm.world is ever framed. The hash names a PATH, and the origin
// is ours, so an address somebody hands the reader cannot point the panel at
// another site.
//
// Brainstorm has no embed mode yet; `embed=1` is passed now so the panel loses
// the app's own chrome the day it ships one. Inside the frame the reader is
// signed out (browsers partition an embedded site's storage), which is why
// zapping and following are one click away in a real tab, never faked here.

const BRAINSTORM = 'https://brainstorm.world'
let openReader = () => {}
let warmReader = () => {}

function reader () {
  const scrim = el('div', 'lv-scrim')
  const panel = el('aside', 'lv-panel')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', 'Reading')
  panel.tabIndex = -1

  const head = el('header', 'lv-panel-head')
  const where = el('div', 'lv-panel-where')
  const kicker = el('span', 'lv-panel-kicker', 'Reading on Brainstorm')
  where.append(kicker, el('span', 'lv-panel-pos'))
  const prev = el('button', 'lv-panel-step', '‹')
  prev.type = 'button'; prev.setAttribute('aria-label', 'Previous')
  const next = el('button', 'lv-panel-step', '›')
  next.type = 'button'; next.setAttribute('aria-label', 'Next')
  const out = el('a', 'lv-panel-out')
  out.target = '_blank'; out.rel = 'noopener noreferrer'
  // The way out, said in full on a desk and in two words on a phone, where
  // the header has no room for the sentence but must still have the door.
  const setOut = (long, short, href) => {
    out.replaceChildren(el('span', 'lv-out-long', long), el('span', 'lv-out-short', short), ' ↗')
    out.setAttribute('aria-label', long)
    out.href = href
  }
  setOut('Open full page to zap or follow', 'Full page', BRAINSTORM)
  const close = el('button', 'lv-panel-close', '×')
  close.type = 'button'; close.setAttribute('aria-label', 'Close and return to the paper')
  head.append(where, prev, next, out, close)

  const body = el('div', 'lv-panel-body')
  const loading = el('div', 'lv-panel-loading', 'Opening on Brainstorm…')
  body.append(loading)
  // One thing in the body at a time: a Brainstorm page in a frame, or one of
  // the paper's own sheets. A FRESH frame per page — pointing one frame at a
  // new src adds a step to the joint session history, and Back then walks the
  // frame instead of closing the panel; a new frame's first load adds nothing.
  let frame = null
  let sheet = null
  let preview = null
  let settle = 0
  // Brainstorm boots its whole app in every frame and then asks the relays
  // for the post, which lands some 400ms after the frame reports "loaded".
  // So a frame is shown a beat after its load, or at once when it loaded
  // while waiting; until then the reader has the paper's own copy.
  const SETTLE_MS = 650
  const reveal = (f) => {
    clearTimeout(settle)
    const wait = f.dataset.loadedAt ? Math.max(0, SETTLE_MS - (performance.now() - Number(f.dataset.loadedAt))) : SETTLE_MS
    settle = setTimeout(() => { if (f === frame) body.classList.add('lv-loaded') }, wait)
  }
  // Up to two pages load unseen: the one the reader is hovering, and the
  // next story. A waiting frame is shown by swapping visibility, never moved —
  // moving an iframe reloads it. Its first load adds no history, so Back still
  // closes the panel.
  const waiting = new Map()
  const makeFrame = (src) => {
    const f = el('iframe', 'lv-panel-frame')
    f.title = 'Brainstorm'
    f.referrerPolicy = 'no-referrer'
    f.setAttribute('allow', 'clipboard-write')
    f.dataset.src = src
    f.addEventListener('load', () => {
      if (!f.dataset.loadedAt) f.dataset.loadedAt = String(performance.now())
      if (f === frame) reveal(f)
    })
    f.src = src
    body.append(f)
    return f
  }
  const warm = (src) => {
    if (!src || (frame && frame.dataset.src === src) || waiting.has(src)) return
    if (waiting.size >= 2) {
      const [oldest, f] = waiting.entries().next().value
      f.remove()
      waiting.delete(oldest)
    }
    const f = makeFrame(src)
    f.classList.add('lv-waiting')
    f.tabIndex = -1
    f.setAttribute('aria-hidden', 'true')
    waiting.set(src, f)
  }
  const clear = () => {
    clearTimeout(settle)
    if (frame) { frame.remove(); frame = null }
    if (sheet) { sheet.dispatchEvent(new Event('lv:unmount')); sheet.remove(); sheet = null }
    if (preview) { preview.remove(); preview = null }
  }
  const mountFrame = (src, copy) => {
    clear()
    if (copy) { preview = copy; body.append(preview) }
    const f = waiting.get(src)
    if (f) {
      waiting.delete(src)
      f.classList.remove('lv-waiting')
      f.removeAttribute('aria-hidden')
      f.removeAttribute('tabindex')
      frame = f
      if (f.dataset.loadedAt) reveal(f)
    } else {
      frame = makeFrame(src)
    }
  }
  const mountSheet = (node) => {
    clear()
    sheet = node
    body.append(sheet)
    body.classList.add('lv-loaded')
  }
  // On a profile: the person's stories in this paper, to step into.
  const today = el('nav', 'lv-panel-today')
  today.setAttribute('aria-label', 'In today\'s paper')
  today.hidden = true
  // For a new reader, once: what the panel is, and where zap and follow live.
  // Shown on the first few Brainstorm pages until dismissed, then never again.
  const note = el('div', 'lv-panel-note')
  note.hidden = true
  const noteText = el('span', 'lv-panel-note-text', 'You’re reading Brainstorm inside your paper. To zap, follow or reply, ')
  const noteOut = el('a', 'lv-panel-note-out', 'open the full page ↗')
  noteOut.target = '_blank'; noteOut.rel = 'noopener noreferrer'
  noteText.append(noteOut)
  const noteOk = el('button', 'lv-panel-note-ok', 'Got it')
  noteOk.type = 'button'
  note.append(noteText, noteOk)
  const NOTE_KEY = 'lv-panel-note'
  noteOk.addEventListener('click', () => { store.set(NOTE_KEY, { done: true }); note.hidden = true })
  panel.append(head, today, body, note)
  document.body.append(scrim, panel)

  // What this reader has opened in this edition, kept on their device.
  const READ_KEY = `lv-read-${location.pathname}`
  const read = new Set(store.get(READ_KEY) || [])
  const markRead = (id) => { for (const a of $$(`a[data-ev="${id}"]`)) a.classList.add('lv-was-read') }
  read.forEach(markRead)

  // Everything the panel can open: citations and names on Brainstorm,
  // stations in the wireless, listings in the classifieds.
  const links = () => $$('a[data-ev], a[data-pk], a[data-stream], a[data-listing]')
    .filter((a) => a.dataset.stream || a.dataset.listing || a.href.startsWith(BRAINSTORM + '/'))
  // What the arrows walk: the paper's stories, each once, in reading order
  // (dress.mjs works it out). People, stations and listings are opened from
  // their own links and are not stepped to.
  const stories = (data.sequence || []).filter((id) => document.querySelector(`a[data-ev="${id}"]`))
  const storyAnchor = (id) => document.querySelector(`a[data-ev="${id}"]`)
  let index = -1
  let source = null
  let opener = null

  const pathOf = (url) => {
    const u = new URL(url, BRAINSTORM)
    return u.origin === BRAINSTORM ? u.pathname + u.search : null
  }
  const embed = (path) => {
    const u = new URL(path, BRAINSTORM)
    u.searchParams.set('embed', '1')
    return u.href
  }
  const targetOf = (a) => a.dataset.stream ? { type: 'stream', id: a.dataset.stream }
    : a.dataset.listing ? { type: 'listing', id: a.dataset.listing }
      : { type: 'page', path: pathOf(a.href) }
  const keyOf = (t) => (t.type === 'page' ? t.path : `${t.type}:${t.id}`)
  const storyOf = (target, anchor) => {
    if (target.type !== 'page') return null
    if (anchor && anchor.dataset.ev) return anchor.dataset.ev
    return stories.find((id) => pathOf(storyAnchor(id).href) === target.path) || null
  }
  const personOf = (target, anchor) => {
    if (target.type !== 'page' || !/^\/p\//.test(target.path)) return null
    if (anchor && anchor.dataset.pk && !anchor.dataset.ev) return anchor.dataset.pk
    const named = links().find((a) => a.dataset.pk && !a.dataset.ev && pathOf(a.href) === target.path)
    return named ? named.dataset.pk : null
  }
  const openStory = (id) => {
    const a = storyAnchor(id)
    if (!a) return
    a.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    open(targetOf(a), a)
  }
  const copyOf = (story, pk) => {
    const ev = story && data.events[story]
    const who = data.people[(ev && ev.pk) || pk]
    if (!ev && !who) return null
    const box = el('article', 'lv-panel-preview')
    const head = el('div', 'lv-preview-head')
    if (who && who.picture) {
      const img = el('img', 'lv-preview-avatar')
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.src = who.picture
      img.onerror = () => img.remove()
      head.append(img)
    }
    const line = el('div')
    line.append(el('div', 'lv-preview-name', (who && who.name) || 'Someone on nostr'))
    const meta = ev ? ago(ev.t) : (who && who.nip05) || ''
    if (meta) line.append(el('div', 'lv-preview-meta', meta))
    head.append(line)
    box.append(head)
    if (ev && ev.title) box.append(el('h2', 'lv-preview-title', ev.title))
    const text = ev ? ev.text : who && who.about
    if (text) box.append(el('p', 'lv-preview-text', text))
    box.append(el('p', 'lv-preview-wait', 'From the paper’s copy · the live page is on its way'))
    return box
  }
  const headline = (id) => {
    const ev = data.events[id]
    if (!ev) return 'A post'
    if (ev.title) return ev.title
    const words = String(ev.text || '').trim()
    return words.length > 60 ? words.slice(0, 59).trimEnd() + '…' : (words || 'A post')
  }

  function show (target, anchor) {
    const story = storyOf(target, anchor)
    index = story ? stories.indexOf(story) : -1
    if (story && !read.has(story)) { read.add(story); store.set(READ_KEY, [...read]); markRead(story) }
    const onStory = index >= 0
    prev.hidden = next.hidden = !onStory
    prev.disabled = index <= 0
    next.disabled = index >= stories.length - 1
    panel.querySelector('.lv-panel-pos').textContent = onStory
      ? `${index + 1} of ${stories.length} stories · ${read.size} read` : ''

    // A profile lists the person's stories in this paper.
    const pk = personOf(target, anchor)
    const theirs = pk && data.people[pk] ? (data.people[pk].stories || []).filter(storyAnchor) : []
    today.replaceChildren()
    today.hidden = !theirs.length
    if (theirs.length) {
      today.append(el('span', 'lv-panel-today-label', 'In today’s paper'))
      for (const id of theirs) {
        const b = el('button', 'lv-panel-today-story' + (read.has(id) ? ' lv-was-read' : ''), headline(id))
        b.type = 'button'
        b.addEventListener('click', () => openStory(id))
        today.append(b)
      }
    }
    body.classList.remove('lv-loaded')

    if (target.type === 'stream') {
      const st = data.streams[target.id]
      kicker.textContent = 'The Wireless'
      setOut('Listen on zap.stream', 'zap.stream', st.url)
      mountSheet(wireless(target.id))
    } else if (target.type === 'listing') {
      const ad = data.listings[target.id]
      kicker.textContent = 'The Classifieds'
      setOut('Enquire on Shopstr', 'Shopstr', ad.url)
      mountSheet(classified(target.id))
    } else {
      kicker.textContent = pk ? 'Profile on Brainstorm' : 'Reading on Brainstorm'
      setOut('Open full page to zap or follow', 'Full page', BRAINSTORM + target.path)
      mountFrame(embed(target.path), copyOf(story, pk))
      // The reader is likely to press › next: have that page loading already.
      if (onStory && index < stories.length - 1) warm(embed(pathOf(storyAnchor(stories[index + 1]).href)))
    }

    // The new reader's note: Brainstorm pages only, a few times, until "Got it".
    const seen = store.get(NOTE_KEY) || { shown: 0 }
    const showNote = target.type === 'page' && !seen.done && (seen.shown || 0) < 3
    note.hidden = !showNote
    if (showNote) {
      noteOut.href = BRAINSTORM + target.path
      if (!document.body.classList.contains('lv-reading-open')) store.set(NOTE_KEY, { shown: (seen.shown || 0) + 1 })
    }

    if (source) source.classList.remove('lv-reading')
    source = anchor ? anchor.closest('.story, .band .cell, .box') : null
    if (source) source.classList.add('lv-reading')

    if (!document.body.classList.contains('lv-reading-open')) {
      opener = document.activeElement
      document.body.classList.add('lv-reading-open')
      requestAnimationFrame(() => close.focus())
    }
  }

  function hide () {
    document.body.classList.remove('lv-reading-open')
    if (source) source.classList.remove('lv-reading')
    source = null
    clear()
    for (const f of waiting.values()) f.remove()
    waiting.clear()
    if (opener && opener.focus) opener.focus()
  }

  // `#read=` names a PATH on brainstorm.world, or one of this edition's own
  // stations or listings. Nothing else, so a shared address cannot point the
  // panel at another site.
  const fromHash = () => {
    const m = /^#read=(.+)$/.exec(location.hash)
    if (!m) return null
    const value = decodeURIComponent(m[1])
    if (value.startsWith('/') && !value.startsWith('//')) return { type: 'page', path: value }
    const own = /^(stream|listing):([0-9a-f]{64})$/.exec(value)
    if (own && (own[1] === 'stream' ? data.streams : data.listings)[own[2]]) return { type: own[1], id: own[2] }
    return null
  }
  const anchorFor = (t) => links().find((a) => keyOf(targetOf(a)) === keyOf(t)) || null

  const open = (target, anchor = null, { push = true } = {}) => {
    if (!target || (target.type === 'page' && !target.path)) return
    const hash = '#read=' + encodeURIComponent(keyOf(target))
    if (push && location.hash !== hash) {
      // The first step into the panel is a history entry, so Back leaves it;
      // steps inside the panel replace it, so Back never walks citations.
      if (document.body.classList.contains('lv-reading-open')) history.replaceState({ lv: 1 }, '', hash)
      else history.pushState({ lv: 1 }, '', hash)
    }
    show(target, anchor)
  }
  openReader = (url, anchor = null, options) => open({ type: 'page', path: pathOf(url) }, anchor, options)
  // Hovering a Brainstorm link starts its page loading, unseen, so the click
  // lands on a page that is already there.
  warmReader = (url) => {
    const path = pathOf(url)
    if (path) warm(embed(path))
  }

  const step = (by) => {
    if (index < 0 || !stories.length) return
    const to = Math.min(stories.length - 1, Math.max(0, index + by))
    if (to !== index) openStory(stories[to])
  }

  const dismiss = () => {
    if (fromHash() && history.state && history.state.lv) history.back()
    else { history.replaceState(null, '', location.pathname + location.search); hide() }
  }

  addEventListener('popstate', () => {
    const target = fromHash()
    if (!target) return hide()
    open(target, anchorFor(target), { push: false })
  })

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target.closest && e.target.closest('a[data-ev], a[data-pk], a[data-stream], a[data-listing]')
    if (!a) return
    if (!a.dataset.stream && !a.dataset.listing && !a.href.startsWith(BRAINSTORM + '/')) return
    e.preventDefault()
    open(targetOf(a), a)
  })
  scrim.addEventListener('click', dismiss)
  close.addEventListener('click', dismiss)
  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))

  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('lv-reading-open')) return
    if (e.target && e.target.closest && e.target.closest('video, input, textarea')) return
    if (e.key === 'Escape') { e.preventDefault(); dismiss() }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'Tab') {
      // Keep focus in the panel while it is open.
      const stops = [prev, next, out, close, ...$$('button', today), ...(frame ? [frame] : $$('button, a, video', sheet || body)), noteOut, noteOk]
        .filter((n) => n && !n.disabled && !n.hidden && !n.closest('[hidden]'))
      const at = stops.indexOf(document.activeElement)
      if (e.shiftKey && at <= 0) { e.preventDefault(); stops[stops.length - 1].focus() }
      else if (!e.shiftKey && at === stops.length - 1) { e.preventDefault(); stops[0].focus() }
    }
  })

  // A reload or a shared link reopens what was being read.
  const initial = fromHash()
  if (initial) {
    history.replaceState({ lv: 1 }, '', location.hash)
    open(initial, anchorFor(initial), { push: false })
  }
}

// --- the wireless and the classifieds -----------------------------------------
//
// Stations and listings the edition printed, set the way a paper of 1905 set
// its wireless programme and its small ads, with a present-day twist: the
// station plays in the panel, and its on-air mark is re-read from the relay.
// Every string here is somebody's post — text only, as everywhere else.

function price (p) {
  if (!p || p.amount == null || p.amount === '') return ''
  const n = Number(p.amount)
  if (n === 0) return 'Free'
  const cur = String(p.currency || '').toUpperCase()
  if (cur === 'SATS' || cur === 'SAT') return `${Number.isFinite(n) ? n.toLocaleString('en') : p.amount} sats`
  if (/^[A-Z]{3}$/.test(cur) && Number.isFinite(n)) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n) } catch {}
  }
  return `${p.amount}${cur ? ' ' + cur : ''}`
}

function onAir (st) {
  if (st.status === 'live') return `● On air${st.listeners != null ? ` · ${st.listeners} listening` : ''}`
  if (st.status === 'planned') return '◌ Coming up'
  return '○ Off air'
}

function halftone (url, className) {
  const img = el('img', className)
  img.alt = ''
  img.loading = 'lazy'
  img.referrerPolicy = 'no-referrer'
  img.src = url
  img.onerror = () => img.remove()
  return img
}

// The rows on the page: a small halftone, the name in small caps, and one
// line — the on-air mark for a station, the price after dotted leaders for a
// listing. The writer's own words stay, set beneath as the notice.
function wireRows () {
  for (const a of $$('a[data-stream]')) {
    const st = data.streams[a.dataset.stream]
    const p = a.closest('p')
    if (!st || !p || p.classList.contains('lv-row')) continue
    const rest = [...p.childNodes].filter((n) => n !== a)
    const note = rest.map((n) => n.textContent).join('').replace(/^[\s,:;–—-]+/, '').replace(/^on zap\.stream\.?\s*/i, '').trim()
    p.classList.add('lv-row')
    p.replaceChildren()
    if (st.image) p.append(halftone(st.image, 'lv-thumb'))
    const text = el('span', 'lv-row-text')
    const line = el('span', 'lv-row-head')
    const status = el('span', `lv-onair lv-onair-${st.status || 'ended'}`, onAir(st))
    status.dataset.statusFor = a.dataset.stream
    line.append(a)
    text.append(line, status, el('span', 'lv-row-note', note || st.summary || ''))
    p.append(text)
  }
  for (const a of $$('a[data-listing]')) {
    const ad = data.listings[a.dataset.listing]
    const p = a.closest('p')
    if (!ad || !p || p.classList.contains('lv-row')) continue
    const rest = [...p.childNodes].filter((n) => n !== a)
    let note = rest.map((n) => n.textContent).join('').replace(/^[\s,:;–—-]+/, '').trim()
    // The price is set in the head line; do not print it twice.
    if (ad.price && ad.price.amount) {
      const amount = String(ad.price.amount)
      note = note.replace(new RegExp(`^[^,.]*${amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^,.]*[,.]\\s*`), '').trim()
    }
    p.classList.add('lv-row')
    p.replaceChildren()
    if (ad.images[0]) p.append(halftone(ad.images[0], 'lv-thumb'))
    const text = el('span', 'lv-row-text')
    const line = el('span', 'lv-row-head')
    const cost = price(ad.price)
    line.append(a)
    if (cost) line.append(el('span', 'lv-leaders'), el('span', 'lv-price', cost))
    text.append(line, el('span', 'lv-row-note', note || ad.summary || ''))
    p.append(text)
  }
}

let hlsLoading = null
function loadHls () {
  if (window.Hls) return Promise.resolve(window.Hls)
  if (hlsLoading) return hlsLoading
  const source = document.getElementById('hls-src')
  if (!source) return Promise.resolve(null)
  // Our own vendored library, inlined as inert text by dress.mjs, run only
  // now that a reader has asked to listen.
  hlsLoading = new Promise((resolve) => {
    const script = document.createElement('script')
    script.textContent = source.textContent
    document.head.append(script)
    resolve(window.Hls || null)
  })
  return hlsLoading
}

function wireless (id) {
  const st = data.streams[id]
  const sheet = el('article', 'lv-sheet lv-sheet-wireless')
  if (st.image) {
    const cover = el('figure', 'lv-sheet-cover')
    cover.append(halftone(st.image, 'lv-sheet-img'))
    sheet.append(cover)
  }
  sheet.append(el('h2', 'lv-sheet-title', st.title || 'A station'))
  const status = el('p', `lv-onair lv-onair-${st.status || 'ended'}`, onAir(st))
  status.dataset.statusFor = id
  sheet.append(status)
  if (st.summary) sheet.append(el('p', 'lv-sheet-text', st.summary))

  const player = el('div', 'lv-player')
  const tune = el('button', 'lv-tune', st.hls && st.status === 'live' ? '▶  Tune in' : 'Nothing on air to play')
  tune.type = 'button'
  tune.disabled = !(st.hls && st.status === 'live')
  const note = el('span', 'lv-player-note', st.hls ? 'Live broadcast, carried by zap.stream' : 'This station has no feed the paper can play')
  player.append(tune, note)
  sheet.append(player)

  let hls = null
  let video = null
  tune.addEventListener('click', async () => {
    tune.disabled = true
    tune.textContent = 'Tuning…'
    video = el('video', 'lv-video')
    video.controls = true
    video.playsInline = true
    if (st.image) video.poster = st.image
    player.prepend(video)
    sheet.classList.add('lv-playing')
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = st.hls
    } else {
      const Hls = await loadHls()
      if (!Hls || !Hls.isSupported()) { tune.textContent = 'This browser cannot play it here'; return }
      hls = new Hls()
      hls.loadSource(st.hls)
      hls.attachMedia(video)
    }
    video.play().then(() => { tune.remove(); note.textContent = 'On air now · live from zap.stream' })
      .catch(() => { tune.textContent = '▶  Press play on the set above'; tune.disabled = true })
  })
  // Leaving the station stops it; nothing plays behind a closed panel.
  sheet.addEventListener('lv:unmount', () => {
    if (hls) hls.destroy()
    if (video) { video.pause(); video.removeAttribute('src'); video.load() }
  })

  if (st.tags.length) sheet.append(el('p', 'lv-sheet-tags', st.tags.join(' · ')))
  if (st.starts) sheet.append(el('p', 'lv-sheet-meta', `On the air since ${new Date(st.starts * 1000).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })}`))
  return sheet
}

function classified (id) {
  const ad = data.listings[id]
  const sheet = el('article', 'lv-sheet lv-sheet-ad')
  if (ad.images.length) {
    const gallery = el('figure', 'lv-sheet-gallery')
    const main = halftone(ad.images[0], 'lv-sheet-img')
    main.classList.add('lv-in-colour')
    gallery.append(main)
    if (ad.images.length > 1) {
      const strip = el('div', 'lv-sheet-thumbs')
      ad.images.forEach((url) => {
        const b = el('button', 'lv-sheet-thumb')
        b.type = 'button'
        b.setAttribute('aria-label', 'Show this picture')
        b.append(halftone(url))
        b.addEventListener('click', () => { main.src = url })
        strip.append(b)
      })
      gallery.append(strip)
    }
    sheet.append(gallery)
  }
  sheet.append(el('h2', 'lv-sheet-title', ad.title || 'A listing'))
  if (ad.price) sheet.append(el('p', 'lv-sheet-price', price(ad.price)))
  const seller = data.people[ad.seller]
  const meta = [ad.location, seller && seller.name ? `offered by ${seller.name}` : null, ad.status === 'sold' ? 'sold' : null].filter(Boolean)
  if (meta.length) sheet.append(el('p', 'lv-sheet-meta', meta.join(' · ')))
  // Where to buy it: the seller's own marketplace first, named by its host
  // so the reader knows where they are going; Shopstr, where the listing was
  // posted, second. Both leave the paper, in a new tab, and say so.
  const buy = el('div', 'lv-buy')
  if (ad.link) {
    let host = ''
    try { host = new URL(ad.link).hostname.replace(/^www\./, '') } catch {}
    const a = el('a', 'lv-buy-main', ad.status === 'sold' ? `Sold · listed at ${host} ↗` : `Buy at ${host} ↗`)
    a.href = ad.link
    a.target = '_blank'
    a.rel = 'noopener noreferrer nofollow'
    buy.append(a)
  }
  const shop = el('a', ad.link ? 'lv-buy-alt' : 'lv-buy-main', 'Enquire on Shopstr ↗')
  shop.href = ad.url
  shop.target = '_blank'
  shop.rel = 'noopener noreferrer'
  buy.append(shop)
  sheet.append(buy)
  const text = (ad.text || ad.summary || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
  if (text) sheet.append(el('p', 'lv-sheet-text lv-sheet-long', text))
  if (ad.tags.length) sheet.append(el('p', 'lv-sheet-tags', ad.tags.join(' · ')))
  return sheet
}

// On load, ask the relay whether each station is still on the air. One
// question for all of them; nothing else on the page moves.
async function stationStatus () {
  const ids = Object.keys(data.streams || {})
  if (!ids.length || !data.since || !data.since.relay || !('WebSocket' in window)) return
  const addr = ids.map((id) => data.streams[id].address)
  const found = await ask(data.since.relay, {
    kinds: [30311], authors: [...new Set(addr.map((a) => a.pubkey))], '#d': [...new Set(addr.map((a) => a.d))], search: 'include:spam',
  }, 6000)
  for (const id of ids) {
    const st = data.streams[id]
    const latest = found.filter((e) => e.pubkey === st.address.pubkey && (e.tags.find((t) => t[0] === 'd') || [])[1] === st.address.d)
      .sort((x, y) => y.created_at - x.created_at)[0]
    if (!latest) continue
    const tag = (n) => (latest.tags.find((t) => t[0] === n) || [])[1]
    st.status = tag('status') || st.status
    const n = parseInt(tag('current_participants'), 10)
    st.listeners = Number.isFinite(n) ? n : st.listeners
    for (const mark of $$(`[data-status-for="${id}"]`)) {
      mark.textContent = onAir(st)
      mark.className = mark.className.replace(/lv-onair-\S+/, `lv-onair-${st.status || 'ended'}`)
    }
  }
}

// --- since this edition ----------------------------------------------------
//
// The paper's own lens, picked up where the window closed: the same ranked
// query, asked of the same relay, for anything newer. The printed stories do
// not change. It asks once on load and then every five minutes while the tab
// is visible — the relay is shared, and a paper open all day should not be the
// thing that hammers it.

function sinceStrip () {
  const since = data.since
  if (!since || !since.relay || !since.filter || !('WebSocket' in window)) return
  // Into the slot the index row was printed with; failing that, a strip of
  // its own under the nameplate.
  const slot = document.querySelector('.lv-since-slot')
  const anchor = slot || document.querySelector('.masthead')
  if (!anchor) return

  const closed = new Date(data.until * 1000).toISOString().slice(11, 16) + ' UTC'
  const strip = slot || el('div', 'lv-since')
  const button = el('button', 'lv-since-button')
  button.type = 'button'
  button.setAttribute('aria-expanded', 'false')
  const dot = el('span', 'lv-since-dot')
  const label = el('span', 'lv-since-label', `Checking for new ranked posts since ${closed}…`)
  button.append(dot, label)
  const drawer = el('div', 'lv-drawer')
  drawer.hidden = true
  strip.append(button)
  if (slot) slot.closest('.lv-index').after(drawer)
  else { strip.append(drawer); anchor.after(strip) }

  button.addEventListener('click', () => {
    drawer.hidden = !drawer.hidden
    button.setAttribute('aria-expanded', String(!drawer.hidden))
  })

  let last = 0
  const check = async () => {
    if (document.hidden) return
    last = Date.now()
    const events = await ask(since.relay, { ...since.filter, since: data.until + 1 })
    const fresh = events.filter((e) => e.created_at > data.until).sort((a, b) => b.created_at - a.created_at)
    if (!fresh.length) {
      label.textContent = `No new ranked posts since ${closed}`
      strip.classList.remove('lv-has-new')
      button.disabled = true
      return
    }
    const names = await namesFor(since.relay, [...new Set(fresh.slice(0, 8).map((e) => e.pubkey))])
    label.textContent = `${fresh.length}${fresh.length >= since.filter.limit ? '+' : ''} new ranked post${fresh.length === 1 ? '' : 's'} since ${closed}`
    strip.classList.add('lv-has-new')
    button.disabled = false
    drawer.replaceChildren(...fresh.slice(0, 8).map((e) => item(e, names)), seeAll())
  }

  function item (e, names) {
    const row = el('button', 'lv-drawer-item')
    row.type = 'button'
    const meta = el('div', 'lv-drawer-meta')
    meta.append(el('span', 'lv-drawer-name', names[e.pubkey] || (data.people[e.pubkey] && data.people[e.pubkey].name) || 'Someone you trust'), el('span', 'lv-drawer-ago', ago(e.created_at)))
    const text = String(e.content || '').replace(/nostr:[a-z0-9]+/gi, '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim()
    row.append(meta, el('div', 'lv-drawer-text', text.length > 180 ? text.slice(0, 179) + '…' : text || '(a post with no text)'))
    // Brainstorm's /e/ takes a bare event id; no encoding needed here.
    row.addEventListener('click', () => openReader(`${BRAINSTORM}/e/${e.id}`))
    return row
  }

  function seeAll () {
    const link = el('button', 'lv-drawer-all', `See everything since ${closed} on Brainstorm →`)
    link.type = 'button'
    link.addEventListener('click', () => openReader(since.seeAll))
    return link
  }

  check()
  setInterval(() => { if (Date.now() - last >= 5 * 60_000) check() }, 30_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last >= 5 * 60_000) check() })
}

// One REQ, drained to EOSE or a deadline. AUTH challenges are ignored, as the
// skill's own reader ignores them: an unsolicited AUTH is not the answer.
function ask (url, filter, wait = 8000) {
  return new Promise((resolve) => {
    const events = new Map()
    let ws
    try { ws = new WebSocket(url) } catch { return resolve([]) }
    const sub = 'lvs' + Math.random().toString(36).slice(2, 8)
    const done = () => { clearTimeout(timer); try { ws.close() } catch {} resolve([...events.values()]) }
    const timer = setTimeout(done, wait)
    ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, filter]))
    ws.onmessage = (m) => {
      let f
      try { f = JSON.parse(m.data) } catch { return }
      if (f[0] === 'EVENT' && f[1] === sub && f[2] && f[2].id) events.set(f[2].id, f[2])
      if ((f[0] === 'EOSE' || f[0] === 'CLOSED') && f[1] === sub) done()
    }
    ws.onerror = done
  })
}

async function namesFor (url, pubkeys) {
  if (!pubkeys.length) return {}
  const found = await ask(url, { kinds: [0], authors: pubkeys, search: 'include:spam' }, 5000)
  const names = {}
  for (const e of found.sort((a, b) => a.created_at - b.created_at)) {
    try {
      const m = JSON.parse(e.content || '{}')
      const name = m.display_name || m.displayName || m.name
      if (name) names[e.pubkey] = String(name).slice(0, 60)
    } catch {}
  }
  return names
}

// --- cameos -------------------------------------------------------------------
//
// The way a newspaper puts a face to a quotation: a small half-column
// portrait, in halftone grey, set into the paragraph where the person is
// quoted, with their name beneath. One to a story, one per person on the
// page, and only for people the edition quotes and who publish an https
// picture. Clicking it opens them in the reader panel like their name does.

function cameos () {
  const seen = new Set()
  for (const story of $$('.fold .story, .band .cell')) {
    if (story.querySelector('.lv-cameo')) continue
    for (const p of $$('p', story)) {
      if (!p.querySelector('q')) continue
      if (p.matches('.kicker, .byline, .dek, .note') || p.closest('figcaption')) continue
      // The quote's own citation names its author; failing that, the first
      // person named in the paragraph.
      const source = p.querySelector('a[data-ev][data-pk]') || p.querySelector('a[data-pk]')
      const pk = source && source.dataset.pk
      const person = pk && data.people[pk]
      if (!person || !person.picture || !person.name || seen.has(pk)) continue
      seen.add(pk)
      const cameo = el('a', 'lv-cameo')
      cameo.href = `${BRAINSTORM}/p/${pk}`
      cameo.dataset.pk = pk
      cameo.target = '_blank'
      cameo.rel = 'noopener noreferrer'
      const img = el('img')
      img.alt = person.name
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      img.src = person.picture
      img.onerror = () => cameo.remove()
      cameo.append(img, el('span', 'lv-cameo-name', person.name))
      p.prepend(cameo)
      break
    }
  }
}

// --- the puzzles, played ------------------------------------------------------
//
// The sudoku and the word of the day are played in place. Neither answer is
// in the page: the island carries a hash per sudoku cell and hashes for the
// word's letters, so a guess is checked by hashing it, a cell revealed by
// trying nine digits, and a lost word found by trying the answer list. Play
// is saved on this device, per edition, and nowhere else.

async function sha (text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const store = {
  get (key) { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } },
  set (key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} },
}
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

function puzzle () {
  const pre = document.querySelector('pre.sudoku')
  const hashes = data.puzzle && data.puzzle.cells
  if (!pre) return
  const rows = pre.textContent.trim().split(/\n/).map((r) => r.trim()).filter(Boolean)
  if (rows.length !== 9 || rows.some((r) => r.length !== 9)) return
  const key = `lv-sudoku-${data.puzzle ? data.puzzle.code : data.code}`
  const saved = store.get(key) || {}
  const state = {
    values: saved.values || rows.map((r) => [...r].map((ch) => (/[1-9]/.test(ch) ? Number(ch) : 0))),
    given: rows.map((r) => [...r].map((ch) => /[1-9]/.test(ch))),
    notes: saved.notes || rows.map(() => Array.from({ length: 9 }, () => [])),
    seconds: saved.seconds || 0,
    done: !!saved.done,
  }
  const save = () => store.set(key, { values: state.values, notes: state.notes, seconds: state.seconds, done: state.done })

  const wrap = el('div', 'lv-sudoku')
  const table = el('table', 'sudoku')
  table.setAttribute('aria-label', 'Sudoku')
  const cells = []
  for (let r = 0; r < 9; r++) {
    const tr = el('tr')
    for (let c = 0; c < 9; c++) {
      const td = el('td', state.given[r][c] ? 'lv-given' : 'lv-cell')
      if (!state.given[r][c] && hashes) { td.tabIndex = 0; td.setAttribute('role', 'gridcell') }
      tr.append(td)
      cells.push(td)
    }
    table.append(tr)
  }
  const bar = el('div', 'lv-sudoku-bar')
  const timer = el('span', 'lv-sudoku-timer', clock(state.seconds))
  const notesBtn = el('button', 'lv-key lv-key-wide', 'Notes')
  const checkBtn = el('button', 'lv-key lv-key-wide', 'Check')
  const revealBtn = el('button', 'lv-key lv-key-wide', 'Reveal cell')
  const clearBtn = el('button', 'lv-key', '⌫')
  for (const b of [notesBtn, checkBtn, revealBtn, clearBtn]) b.type = 'button'
  const pad = el('div', 'lv-keypad')
  for (let d = 1; d <= 9; d++) { const b = el('button', 'lv-key', String(d)); b.type = 'button'; b.dataset.digit = d; pad.append(b) }
  pad.append(clearBtn)
  const word = el('p', 'lv-sudoku-word')
  bar.append(timer, notesBtn, checkBtn, revealBtn)
  wrap.append(table, bar, pad, word)
  pre.replaceWith(wrap)
  if (!hashes) return

  let selected = null
  let notes = false
  const at = (i) => [Math.floor(i / 9), i % 9]
  const value = (r, c) => state.values[r][c]

  function paint () {
    const sel = selected == null ? null : at(selected)
    const selDigit = sel ? value(sel[0], sel[1]) : 0
    // Conflicts: a digit twice in a row, column or box, among filled cells.
    const conflict = new Set()
    const groups = []
    for (let i = 0; i < 9; i++) {
      groups.push(Array.from({ length: 9 }, (_, j) => i * 9 + j))
      groups.push(Array.from({ length: 9 }, (_, j) => j * 9 + i))
      const br = 3 * Math.floor(i / 3); const bc = 3 * (i % 3)
      groups.push([0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (br + r) * 9 + bc + c)))
    }
    for (const g of groups) {
      const seen = {}
      for (const i of g) { const [r, c] = at(i); const v = value(r, c); if (v) (seen[v] = seen[v] || []).push(i) }
      for (const list of Object.values(seen)) if (list.length > 1) list.forEach((i) => conflict.add(i))
    }
    cells.forEach((td, i) => {
      const [r, c] = at(i)
      const v = value(r, c)
      td.classList.toggle('lv-selected', i === selected)
      td.classList.toggle('lv-same', !!selDigit && v === selDigit && i !== selected)
      td.classList.toggle('lv-peer', !!sel && i !== selected && (r === sel[0] || c === sel[1] || (Math.floor(r / 3) === Math.floor(sel[0] / 3) && Math.floor(c / 3) === Math.floor(sel[1] / 3))))
      td.classList.toggle('lv-conflict', conflict.has(i))
      if (state.given[r][c]) return
      td.replaceChildren()
      if (v) td.textContent = String(v)
      else if (state.notes[r][c].length) {
        const n = el('div', 'lv-notes')
        for (let d = 1; d <= 9; d++) n.append(el('span', null, state.notes[r][c].includes(d) ? String(d) : ''))
        td.append(n)
      }
    })
    cells.forEach((td, i) => { const [r, c] = at(i); if (state.given[r][c]) td.textContent = String(value(r, c)) })
    notesBtn.classList.toggle('lv-on', notes)
  }

  const select = (i) => { selected = i; paint(); cells[i].focus({ preventScroll: true }) }
  function enter (digit) {
    if (selected == null || state.done) return
    const [r, c] = at(selected)
    if (state.given[r][c]) return
    if (notes && digit) {
      const list = state.notes[r][c]
      const k = list.indexOf(digit)
      if (k > -1) list.splice(k, 1); else list.push(digit)
      state.values[r][c] = 0
    } else {
      state.values[r][c] = digit
      if (digit) state.notes[r][c] = []
    }
    cells[selected].classList.remove('lv-wrong', 'lv-revealed')
    save(); paint()
    if (digit && state.values.every((row) => row.every(Boolean))) check(true)
  }

  async function check (quiet) {
    let wrong = 0; let filled = 0
    for (let i = 0; i < 81; i++) {
      const [r, c] = at(i)
      if (state.given[r][c] || !value(r, c)) continue
      filled++
      const ok = (await sha(`${data.puzzle.code}:${r}:${c}:${value(r, c)}`)) === hashes[r][c]
      cells[i].classList.toggle('lv-wrong', !ok)
      if (!ok) wrong++
    }
    if (!wrong && filled === cells.filter((td) => td.classList.contains('lv-cell')).length) {
      state.done = true; save()
      word.textContent = `Solved in ${clock(state.seconds)}.`
      wrap.classList.add('lv-solved')
    } else if (!quiet) {
      word.textContent = wrong ? `${wrong} wrong so far.` : `Nothing wrong so far — ${81 - filled - cells.filter((td) => td.classList.contains('lv-given')).length} to go.`
    }
  }

  async function reveal () {
    if (selected == null || state.done) return
    const [r, c] = at(selected)
    if (state.given[r][c]) return
    for (let d = 1; d <= 9; d++) {
      if ((await sha(`${data.puzzle.code}:${r}:${c}:${d}`)) === hashes[r][c]) {
        state.values[r][c] = d; state.notes[r][c] = []
        cells[selected].classList.add('lv-revealed')
        save(); paint()
        return
      }
    }
  }

  cells.forEach((td, i) => { if (td.classList.contains('lv-cell')) td.addEventListener('click', () => select(i)) })
  pad.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return
    if (b === clearBtn) enter(0); else if (b.dataset.digit) enter(Number(b.dataset.digit))
  })
  notesBtn.addEventListener('click', () => { notes = !notes; paint() })
  checkBtn.addEventListener('click', () => check(false))
  revealBtn.addEventListener('click', reveal)
  table.addEventListener('keydown', (e) => {
    if (selected == null) return
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); enter(Number(e.key)) }
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { e.preventDefault(); enter(0) }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); notes = !notes; paint() }
    else if (/^Arrow/.test(e.key)) {
      e.preventDefault()
      let [r, c] = at(selected)
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
      for (let k = 0; k < 9; k++) {
        r = (r + step[0] + 9) % 9; c = (c + step[1] + 9) % 9
        if (!state.given[r][c]) { select(r * 9 + c); break }
      }
    }
  })

  // The clock runs while the puzzle is on screen and unsolved.
  let visible = false
  new IntersectionObserver(([e]) => { visible = e.isIntersecting }).observe(wrap)
  setInterval(() => {
    if (!visible || state.done || document.hidden) return
    state.seconds++; timer.textContent = clock(state.seconds)
    if (state.seconds % 10 === 0) save()
  }, 1000)
  if (state.done) { word.textContent = `Solved in ${clock(state.seconds)}.`; wrap.classList.add('lv-solved') }
  paint()
}

// --- Five: sharing -----------------------------------------------------------
// Copied from scripts/five.mjs, where they are tested; test/five.test.mjs
// fails if these drift from the tested ones by a single byte.

const TILE = { hit: '🟩', near: '🟨', miss: '⬛' }

function shareGrid ({ name, day, rows, won }) {
  return [`${name} #${day} ${won ? rows.length : 'X'}/6`, ...rows.map((r) => r.map((s) => TILE[s]).join(''))].join('\n')
}
function shareNote (game, now) {
  return { kind: 1, created_at: now, tags: [['t', 'five']], content: `${shareGrid(game)}\n\n#five` }
}
function publishNote (relays, event, { WebSocket = globalThis.WebSocket, timeout = 6000 } = {}) {
  const one = (url) => new Promise((resolve) => {
    let ws
    let timer
    const finish = (ok, reason) => { clearTimeout(timer); try { ws && ws.close() } catch {} resolve(ok ? { url } : { url, reason }) }
    try { ws = new WebSocket(url) } catch { return resolve({ url, reason: 'unreachable' }) }
    timer = setTimeout(() => finish(false, 'no answer'), timeout)
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]))
    ws.onerror = () => finish(false, 'unreachable')
    ws.onmessage = (message) => {
      let reply
      try { reply = JSON.parse(message.data) } catch { return }
      if (reply[0] === 'OK' && reply[1] === event.id) finish(reply[2] === true, String(reply[3] || 'refused'))
    }
  })
  return Promise.all(relays.map(one)).then((results) => ({
    accepted: results.filter((r) => !r.reason).map((r) => r.url),
    refused: results.filter((r) => r.reason),
  }))
}

// --- Five: the word of the day ------------------------------------------------

function five () {
  const host = document.querySelector('.five')
  const game = data.five
  if (!host || !game) return
  const key = `lv-five-${game.day}`
  const saved = store.get(key) || { guesses: [], won: false }
  const guessSet = new Set(game.guesses)
  const board = el('div', 'lv-five-board')
  const rows = []
  for (let r = 0; r < 6; r++) {
    const row = el('div', 'lv-five-row')
    const tiles = []
    for (let c = 0; c < 5; c++) { const t = el('span', 'lv-tile'); row.append(t); tiles.push(t) }
    board.append(row); rows.push(tiles)
  }
  const message = el('p', 'lv-five-message')
  const keyboard = el('div', 'lv-keyboard')
  const keyState = {}
  for (const line of ['qwertyuiop', 'asdfghjkl', '⏎zxcvbnm⌫']) {
    const kr = el('div', 'lv-keyboard-row')
    for (const ch of line) { const b = el('button', 'lv-key' + (/[⏎⌫]/.test(ch) ? ' lv-key-wide' : ''), ch === '⏎' ? 'Enter' : ch); b.type = 'button'; b.dataset.key = ch; kr.append(b) }
    keyboard.append(kr)
  }
  const foot = el('div', 'lv-five-foot')
  const share = el('button', 'lv-key lv-key-wide', 'Share')
  share.type = 'button'
  // Post appears only when the browser has a Nostr signer (NIP-07). The
  // reader approves the signature in their own extension; the paper never
  // sees a key. It is the one thing the paper writes, and only on a click.
  const post = el('button', 'lv-key lv-key-wide', 'Post')
  post.type = 'button'
  post.hidden = true
  post.title = 'Post your grid to Nostr, signed by your extension'
  const stats = el('span', 'lv-five-stats')
  foot.append(stats, post, share)
  // The plate goes straight under the heading; the writer's note follows it.
  const head = host.querySelector('.back-head')
  if (head) head.after(board, message, keyboard, foot); else host.append(board, message, keyboard, foot)
  host.tabIndex = 0

  let current = ''
  let done = saved.won || saved.guesses.length >= 6
  const scored = []

  async function scoreGuess (guess) {
    const out = new Array(5).fill('miss')
    const used = {}
    for (let i = 0; i < 5; i++) {
      if ((await sha(`five:${game.day}:${i}:${guess[i]}`)) === game.positions[i]) { out[i] = 'hit'; used[guess[i]] = (used[guess[i]] || 0) + 1 }
    }
    for (let i = 0; i < 5; i++) {
      if (out[i] === 'hit') continue
      const ch = guess[i]
      const next = (used[ch] || 0) + 1
      if (game.letters.includes(await sha(`five:${game.day}:${ch}:${next}`))) { out[i] = 'near'; used[ch] = next }
    }
    return out
  }

  const RANK = { miss: 1, near: 2, hit: 3 }
  function paintRow (r, guess, marks) {
    rows[r].forEach((t, i) => {
      t.textContent = guess ? guess[i].toUpperCase() : ''
      t.className = 'lv-tile' + (marks ? ` lv-${marks[i]}` : guess ? ' lv-typed' : '')
      if (marks) { const k = guess[i]; if (!keyState[k] || RANK[marks[i]] > RANK[keyState[k]]) keyState[k] = marks[i] }
    })
    for (const b of keyboard.querySelectorAll('button[data-key]')) { const k = b.dataset.key; b.className = 'lv-key' + (b.classList.contains('lv-key-wide') ? ' lv-key-wide' : '') + (keyState[k] ? ` lv-${keyState[k]}` : '') }
  }
  function paintStats () {
    const s = store.get('lv-five-stats') || { played: 0, won: 0, streak: 0, best: 0, last: 0 }
    stats.textContent = s.played ? `Played ${s.played} · Won ${s.won} · Streak ${s.streak}` : ''
  }
  function record (won) {
    const s = store.get('lv-five-stats') || { played: 0, won: 0, streak: 0, best: 0, last: 0 }
    if (s.last === game.day) return
    s.played++; if (won) { s.won++; s.streak = s.last === game.day - 1 ? s.streak + 1 : 1 } else s.streak = 0
    s.best = Math.max(s.best, s.streak); s.last = game.day
    store.set('lv-five-stats', s)
  }

  async function answerByTrying () {
    for (const w of game.answers) {
      let ok = true
      for (let i = 0; i < 5 && ok; i++) ok = (await sha(`five:${game.day}:${i}:${w[i]}`)) === game.positions[i]
      if (ok) return w
    }
    return null
  }

  async function submit () {
    if (done || current.length !== 5) return
    if (!guessSet.has(current)) { message.textContent = 'Not in the word list.'; board.classList.add('lv-shake'); setTimeout(() => board.classList.remove('lv-shake'), 400); return }
    const marks = await scoreGuess(current)
    const r = saved.guesses.length
    saved.guesses.push(current); scored.push(marks)
    paintRow(r, current, marks)
    if (marks.every((m) => m === 'hit')) { saved.won = true; done = true; message.textContent = ['Genius.', 'Magnificent.', 'Impressive.', 'Splendid.', 'Great.', 'Phew.'][r]; record(true) }
    else if (saved.guesses.length >= 6) { done = true; record(false); message.textContent = 'Out of guesses…'; answerByTrying().then((w) => { if (w) message.textContent = `The word was ${w.toUpperCase()}.` }) }
    else message.textContent = ''
    current = ''
    store.set(key, saved); paintStats()
  }
  function type (k) {
    if (done) return
    if (k === '⏎' || k === 'Enter') return submit()
    if (k === '⌫' || k === 'Backspace') { current = current.slice(0, -1) }
    else if (/^[a-z]$/.test(k) && current.length < 5) current += k
    paintRow(saved.guesses.length, current.padEnd(5, ' ').trim() ? current.padEnd(5, ' ') : '', null)
    rows[saved.guesses.length].forEach((t, i) => { t.textContent = (current[i] || '').toUpperCase(); t.className = 'lv-tile' + (current[i] ? ' lv-typed' : '') })
  }
  keyboard.addEventListener('click', (e) => { const b = e.target.closest('button[data-key]'); if (b) { type(b.dataset.key); host.focus({ preventScroll: true }) } })
  host.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'enter' || k === 'backspace' || /^[a-z]$/.test(k)) { e.preventDefault(); type(k === 'enter' ? 'Enter' : k === 'backspace' ? 'Backspace' : k) }
  })
  const grid = () => ({ name: game.name, day: game.day, rows: scored, won: saved.won })
  // On a phone, the system share sheet: one tap to any app. Elsewhere, a copy.
  share.addEventListener('click', async () => {
    if (!scored.length) { message.textContent = 'Nothing to share yet.'; return }
    const text = shareGrid(grid())
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text }); return } catch (e) { if (e && e.name === 'AbortError') return }
    }
    try { await navigator.clipboard.writeText(text); message.textContent = 'Copied — paste it anywhere.' } catch { message.textContent = text }
  })

  const postedKey = `lv-five-posted-${game.day}`
  const signer = () => (window.nostr && typeof window.nostr.signEvent === 'function' ? window.nostr : null)
  const posted = () => store.get(postedKey)
  const showPost = () => {
    post.hidden = !signer() && !posted()
    if (posted()) post.textContent = 'Posted'
  }
  showPost()
  // Extensions inject window.nostr late; look again once the page has settled.
  setTimeout(showPost, 800)
  window.addEventListener('load', () => setTimeout(showPost, 300))
  new IntersectionObserver(([e]) => { if (e.isIntersecting) showPost() }).observe(host)
  const seeIt = (id) => {
    const link = el('a', '', 'See it on Brainstorm')
    link.href = `${BRAINSTORM}/e/${id}`
    link.addEventListener('click', (e) => { e.preventDefault(); openReader(link.href) })
    return link
  }
  post.addEventListener('click', async () => {
    const already = posted()
    if (already) { openReader(`${BRAINSTORM}/e/${already.id}`); return }
    if (!done) { message.textContent = 'Finish today’s word first, then post the grid.'; return }
    const nostr = signer()
    if (!nostr) return
    const unsigned = shareNote(grid(), Math.floor(Date.now() / 1000))
    post.disabled = true
    message.textContent = 'Waiting for your signer…'
    let signed
    try { signed = await nostr.signEvent(unsigned) } catch { signed = null }
    if (!signed || !/^[0-9a-f]{64}$/.test(String(signed.id)) || signed.content !== unsigned.content) {
      post.disabled = false
      message.textContent = 'Not signed. Nothing was posted.'
      return
    }
    // The reader's own write relays when the signer shares them, else the
    // paper's public ones.
    let relays = []
    try {
      const mine = nostr.getRelays ? await nostr.getRelays() : null
      relays = Object.entries(mine || {}).filter(([, m]) => m && m.write).map(([url]) => url)
    } catch {}
    relays = [...new Set(relays.filter((url) => /^wss:\/\/[^\s]+$/.test(url)))].slice(0, 8)
    if (!relays.length) relays = data.relays || []
    message.textContent = `Posting to ${relays.length} relays…`
    const { accepted } = await publishNote(relays, signed)
    post.disabled = false
    if (!accepted.length) { message.textContent = 'No relay took it. Nothing was posted; try again later.'; return }
    store.set(postedKey, { id: signed.id })
    showPost()
    message.textContent = `Posted to ${accepted.length} of ${relays.length} relays. `
    message.append(seeIt(signed.id))
  })

  // Replay the saved day.
  ;(async () => {
    for (let r = 0; r < saved.guesses.length; r++) { const marks = await scoreGuess(saved.guesses[r]); scored.push(marks); paintRow(r, saved.guesses[r], marks) }
    if (done && !saved.won) answerByTrying().then((w) => { if (w) message.textContent = `The word was ${w.toUpperCase()}.` })
    else if (saved.won) message.textContent = 'Solved. Back tomorrow.'
    paintStats()
  })()
}

// --- the section bar: one row that slides -------------------------------------

function sectionBar () {
  const row = document.querySelector('.lv-index .lv-sections')
  if (!row) return
  // The fade sits on whichever side has more to see.
  const edges = () => {
    const max = row.scrollWidth - row.clientWidth
    row.classList.toggle('lv-more-left', row.scrollLeft > 2)
    row.classList.toggle('lv-more-right', row.scrollLeft < max - 2)
  }
  row.addEventListener('scroll', edges, { passive: true })
  window.addEventListener('resize', edges)
  edges()
  // A mouse wheel turns up and down; over the bar, that slides it sideways —
  // until it reaches an end, when the page scrolls as usual.
  row.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    const max = row.scrollWidth - row.clientWidth
    if (max <= 0) return
    const next = row.scrollLeft + e.deltaY
    if ((e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max)) return
    e.preventDefault()
    row.scrollLeft = Math.max(0, Math.min(max, next))
  }, { passive: false })
}

// Started last, once every helper above exists.
if (data) {
  document.documentElement.classList.add('lv')
  // Open the line to Brainstorm while the reader is still on the front page.
  for (const origin of [BRAINSTORM, 'https://api.brainstorm.world']) {
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = origin
    link.crossOrigin = ''
    document.head.append(link)
  }
  // A branded paper keeps to its brand's palette; the photograph does not
  // get a vote.
  if (!data.brand) guard(accent)
  guard(timestamps)
  guard(sectionBar)
  guard(reveal)
  guard(cameos)
  guard(puzzle)
  guard(five)
  guard(cards)
  guard(wireRows)
  guard(reader)
  guard(sinceStrip)
  guard(stationStatus)
}
