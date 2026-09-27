// What's On: the calendar events (NIP-52, kinds 31922/31923) the reader's
// network posted, sorted the way a paper's listings are. Upcoming within three
// weeks, each event once (the same title at the same start is one event, however
// many times it was posted), then:
//   near      within 150 km of the reader's town, or naming it when there is no
//             geohash — soonest first;
//   online    a location (or, with none, a title) that says it is online;
//   elsewhere the rest, nearest first, then soonest where distance is unknown.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
const NEAR_KM = 150
const ONLINE = /\b(online|virtual|zoom|jitsi|webinar|livestream)\b|https?:\/\//i

/** The middle of a geohash's cell, or null for anything that is not one. */
export function geohashPoint (hash) {
  if (typeof hash !== 'string' || !/^[0-9b-hjkmnp-z]{1,12}$/.test(hash)) return null
  let even = true
  const lat = [-90, 90]
  const lon = [-180, 180]
  for (const ch of hash) {
    const bits = BASE32.indexOf(ch)
    for (let b = 4; b >= 0; b--) {
      const range = even ? lon : lat
      const mid = (range[0] + range[1]) / 2
      if ((bits >> b) & 1) range[0] = mid
      else range[1] = mid
      even = !even
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 }
}

function km (a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)))
}

const tag = (e, name) => ((e.tags || []).find((t) => t[0] === name) || [])[1]

function startOf (e) {
  const raw = tag(e, 'start')
  if (!raw) return null
  if (e.kind === 31922) {
    const t = Date.parse(`${raw}T00:00:00Z`)
    return Number.isFinite(t) ? Math.floor(t / 1000) : null
  }
  const t = Number(raw)
  return Number.isFinite(t) ? t : null
}

export function whatsOn (events, { lat, lon, place, now, days = 21 }) {
  const home = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  const town = typeof place === 'string' && place.trim() ? place.split(',')[0].trim().toLowerCase() : null
  const seen = new Set()
  const out = { near: [], online: [], elsewhere: [] }
  for (const e of events) {
    const start = startOf(e)
    if (start == null || start < now || start > now + days * 86400) continue
    const title = String(tag(e, 'title') || tag(e, 'name') || '').trim()
    const key = `${title.toLowerCase()}|${start}`
    if (!title || seen.has(key)) continue
    seen.add(key)
    const location = String(tag(e, 'location') || '').trim()
    const point = geohashPoint(tag(e, 'g'))
    const item = { event: e, start, title, location, km: home && point ? km(home, point) : null }
    if (ONLINE.test(location) || (!location && ONLINE.test(title))) out.online.push(item)
    else if (item.km != null ? item.km <= NEAR_KM : town && !point && location.toLowerCase().includes(town)) out.near.push(item)
    else out.elsewhere.push(item)
  }
  const soonest = (a, b) => a.start - b.start
  out.near.sort(soonest)
  out.online.sort(soonest)
  out.elsewhere.sort((a, b) => (a.km == null) - (b.km == null) || (a.km ?? 0) - (b.km ?? 0) || soonest(a, b))
  return out
}
