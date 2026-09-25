// The daily five-letter word. The same word for every reader of a date, from
// a bundled list of common words (the answers) and a public-domain list of
// accepted guesses (web2). Nothing is fetched. The living copy checks guesses
// against hashes; the answer itself is never in the page.

const EPOCH = Date.UTC(2026, 0, 1)

/** #1 is 1 January 2026. */
export function dayNumber (now) {
  return Math.floor((now * 1000 - EPOCH) / 86_400_000) + 1
}

// A fixed permutation of the answers, so the run through the list is not
// alphabetical and every word comes up once before any repeats.
function order (answers) {
  let a = 0x9E3779B9
  const random = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...answers]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function dailyWord (now, answers) {
  const list = order(answers)
  const n = dayNumber(now) - 1
  return list[((n % list.length) + list.length) % list.length]
}

/** 'hit' | 'near' | 'miss' per letter, with repeated letters counted as Wordle counts them. */
export function score (guess, answer) {
  const g = guess.toLowerCase().split('')
  const a = answer.toLowerCase().split('')
  const out = new Array(5).fill('miss')
  const left = {}
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) out[i] = 'hit'
    else left[a[i]] = (left[a[i]] || 0) + 1
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 'hit') continue
    if (left[g[i]]) { out[i] = 'near'; left[g[i]]-- }
  }
  return out
}

export function accepts (word, guesses) {
  const w = String(word).toLowerCase()
  return w.length === 5 && guesses.includes(w)
}

const TILE = { hit: '🟩', near: '🟨', miss: '⬛' }

export function shareGrid ({ name, day, rows, won }) {
  return [`${name} #${day} ${won ? rows.length : 'X'}/6`, ...rows.map((r) => r.map((s) => TILE[s]).join(''))].join('\n')
}

/** The note a reader posts: the grid and a hashtag. The word is never in it. */
function shareNote (game, now) {
  return { kind: 1, created_at: now, tags: [['t', 'five']], content: `${shareGrid(game)}\n\n#five` }
}

/**
 * Sends one signed event to each relay and waits for its OK (NIP-01). Only a
 * relay that answers OK true counts as posted; a refusal keeps its reason, a
 * relay that says nothing in time is "no answer".
 */
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

export { shareNote, publishNote }
