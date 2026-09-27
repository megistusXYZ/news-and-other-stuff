// The wires: what a paper takes from outside its own reporting.
//
// The front page is what the reader's web of trust said. A real paper also
// carries the weather, the scores, an almanac and the wider world's
// headlines, and it takes those from wire services. These are ours: open,
// free services that need no key, fetched on the READER'S OWN MACHINE at
// print time, from settings in their observer.config.json. Nothing here is
// ranked by the lens, and the digest says so.
//
// Two rules:
//
// 1. A SERVICE THAT FAILS COSTS ITS SECTION, NEVER THE PAPER. Each wire is
//    fetched on its own; a failure becomes a note the digest prints, and the
//    edition goes to press without it.
// 2. WIRE TEXT IS DATA. A headline in somebody's RSS feed is exactly as able
//    to say "ignore your instructions" as a note on Nostr. The digest prints
//    it under the same warning.

const AGENT = 'NostrObserver/1.0 (+https://github.com/NosFabrica/the-nostr-observer)'
const TIMEOUT = 12_000

// WMO weather interpretation codes, as Open-Meteo documents them.
const WEATHER_WORDS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Slight rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Slight snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

async function getText (fetch, url) {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(TIMEOUT) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

async function getJson (fetch, url) {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const round = (n) => (Number.isFinite(n) ? Math.round(n) : null)
const clock = (iso) => (typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : null)

// Air, on the scale the reader's part of the world uses; the moon, from the
// synodic month counted from the new moon of 6 January 2000, 18:14 UTC.
const EU_AQI = [[20, 'Good'], [40, 'Fair'], [60, 'Moderate'], [80, 'Poor'], [100, 'Very poor'], [Infinity, 'Extremely poor']]
const US_AQI = [[50, 'Good'], [100, 'Moderate'], [150, 'Unhealthy for sensitive groups'], [200, 'Unhealthy'], [300, 'Very unhealthy'], [Infinity, 'Hazardous']]
const SYNODIC = 29.530588853
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 1000

export function moon (now) {
  const phase = (((now - NEW_MOON) / 86400 / SYNODIC) % 1 + 1) % 1
  const illumination = Math.round((1 - Math.cos(2 * Math.PI * phase)) / 2 * 100)
  const words = phase < 0.0625 || phase >= 0.9375 ? 'New moon'
    : phase < 0.1875 ? 'Waxing crescent' : phase < 0.3125 ? 'First quarter' : phase < 0.4375 ? 'Waxing gibbous'
      : phase < 0.5625 ? 'Full moon' : phase < 0.6875 ? 'Waning gibbous' : phase < 0.8125 ? 'Last quarter' : 'Waning crescent'
  return { words, illumination }
}

async function air (fetch, lat, lon, us) {
  const a = await getJson(fetch, `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,us_aqi,pm2_5&timezone=auto`)
  const index = us ? a.current?.us_aqi : a.current?.european_aqi
  if (!Number.isFinite(index)) throw new Error('no reading')
  const words = (us ? US_AQI : EU_AQI).find(([top]) => index <= top)[1]
  return { index, scale: us ? 'US AQI' : 'European AQI', words }
}

async function weather (fetch, place, units, sky, now) {
  const found = await getJson(fetch, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`)
  const spot = found.results && found.results[0]
  if (!spot) throw new Error(`no place called ${place}`)
  // Two decimal places is a city, not a street: all the forecast needs.
  const lat = spot.latitude.toFixed(2)
  const lon = spot.longitude.toFixed(2)
  const daily = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
  // Fahrenheit for a US place unless the reader said otherwise — asked of the
  // service, so the figures are its own and not converted and re-rounded here.
  const fahrenheit = (units || (spot.country_code === 'US' ? 'us' : 'metric')) === 'us'
  const f = await getJson(fetch, `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=${daily}&forecast_days=4&timezone=auto${fahrenheit ? '&temperature_unit=fahrenheit' : ''}`)
  const d = f.daily
  const day = (i) => ({
    date: d.time[i],
    high: round(d.temperature_2m_max[i]),
    low: round(d.temperature_2m_min[i]),
    rain: round(d.precipitation_probability_max[i]),
    words: WEATHER_WORDS[d.weather_code[i]] || 'Unsettled',
  })
  const out = {
    place: [spot.name, spot.country].filter(Boolean).join(', '),
    country: spot.country_code || null,
    source: 'Weather data by Open-Meteo.com',
    unit: fahrenheit ? '°F' : '°C',
    // The place's own time zone, as Open-Meteo reports it: kick-offs are
    // printed in it.
    timezone: f.timezone || spot.timezone || null,
    // The city's point, rounded as it was asked: What's On measures from it.
    lat: Number(lat),
    lon: Number(lon),
    now: { temp: round(f.current.temperature_2m), words: WEATHER_WORDS[f.current.weather_code] || 'Unsettled' },
    today: { ...day(0), sunrise: clock(d.sunrise[0]), sunset: clock(d.sunset[0]) },
    ahead: [1, 2, 3].filter((i) => d.time[i]).map(day),
  }
  if (sky) {
    out.moon = moon(now)
    try { out.air = await air(fetch, lat, lon, spot.country_code === 'US') } catch { out.air = null }
  }
  return out
}

// The almanac: three events that happened on this date, from Wikipedia's
// "on this day" feed — the newest, the middle and the oldest, so the column
// ranges across the years the way an almanac does.
async function almanac (fetch, now) {
  const date = new Date(now * 1000)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const found = await getJson(fetch, `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`)
  const events = (found.events || []).filter((e) => Number.isFinite(e.year) && typeof e.text === 'string')
    .sort((a, b) => b.year - a.year)
  if (!events.length) throw new Error('nothing listed for today')
  const picks = [...new Set([0, Math.floor((events.length - 1) / 2), events.length - 1])].map((i) => events[i])
  return {
    date: date.toLocaleDateString('en', { month: 'long', day: 'numeric', timeZone: 'UTC' }),
    source: 'Wikipedia (CC BY-SA)',
    items: picks.map((e) => ({ year: e.year, text: e.text.slice(0, 400) })),
  }
}

// The wider world: the top headlines from each feed the reader chose. Just
// enough XML to read RSS 2.0 and Atom titles and dates — not a parser, and
// it never needs to be one: a title is all the paper takes, and it takes it
// as text.
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function xmlText (raw) {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  const text = cdata ? cdata[1] : raw.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return XML_ENTITIES[body.toLowerCase()] ?? whole
  })
  return text.replace(/\s+/g, ' ').trim()
}
const firstTag = (xml, names) => {
  for (const name of names) {
    const m = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml)
    if (m) return { attrs: m[1] || '', body: m[2] }
  }
  return null
}

async function feed (fetch, entry) {
  const url = typeof entry === 'string' ? entry : entry.url
  const section = (typeof entry === 'object' && entry.section) || 'Wider World'
  const xml = await getText(fetch, url)
  const blocks = [...xml.matchAll(/<(item|entry)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[3])
  const head = xml.split(/<(?:item|entry)[\s>]/i)[0]
  const outlet = firstTag(head, ['title'])
  const items = []
  for (const block of blocks.slice(0, 4)) {
    const t = firstTag(block, ['title'])
    if (!t) continue
    let title = xmlText(t.body)
    // Atom marks escaped markup as type="html"; that markup is formatting,
    // so it goes. Anything else is kept exactly as the feed wrote it — as text.
    if (/type=["']html["']/i.test(t.attrs)) title = title.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    const when = firstTag(block, ['pubDate', 'published', 'updated', 'dc:date'])
    const ms = when ? Date.parse(xmlText(when.body)) : NaN
    if (title) items.push({ title: title.slice(0, 240), published: Number.isFinite(ms) ? Math.floor(ms / 1000) : null })
  }
  if (!items.length) throw new Error('no headlines')
  // A feed titled "RSS", "Feed" or nothing is credited to its outlet's name:
  // the domain, capitalised, minus the www — "pitchfork.com" is Pitchfork.
  const host = new URL(url).hostname.replace(/^www\./, '')
  const outletName = host.split('.').slice(0, -1).join('.').replace(/^\w/, (c) => c.toUpperCase()) || host
  const titled = outlet ? xmlText(outlet.body).slice(0, 80) : ''
  const source = !titled || /^(rss|feed|news)\b[:\s-]*/i.test(titled) && titled.replace(/^(rss|feed|news)\b[:\s-]*/i, '').trim().length < 6 ? outletName : titled
  return { source, section, items }
}

// Sports: each team's last result and next fixture, from TheSportsDB. Its
// documented free key is 123, and on it the last and next lists carry one
// match each — which is exactly a paper's results box. The free tier is
// described as for development; a personal paper printed on the reader's own
// machine is the gentlest use there is, and it fetches once per edition.
const SPORTSDB = 'https://www.thesportsdb.com/api/v1/json/123'

// A team may name its sport — "Northwestern Wildcats (American Football)" — because
// the free search answers with ONE team, and a college name is shared by
// every sport the college plays. With a sport, the search tries the whole
// name and then each word, longest first, until a team of that sport comes
// back: TheSportsDB files Northwestern football under "Wildcats", not "Northwestern".
async function findTeam (fetch, entry) {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(entry)
  const name = (m ? m[1] : entry).trim()
  const sport = m ? m[2].trim().toLowerCase() : null
  const tries = sport
    ? [name, ...name.split(/\s+/).filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)]
    : [name]
  for (const q of [...new Set(tries)]) {
    const found = await getJson(fetch, `${SPORTSDB}/searchteams.php?t=${encodeURIComponent(q)}`)
    const hit = (found.teams || []).find((t) => !sport || String(t.strSport || '').toLowerCase() === sport)
    if (hit) return hit
  }
  return null
}

async function team (fetch, entry) {
  const hit = await findTeam(fetch, entry)
  if (!hit) return null
  const [last, next] = await Promise.all([
    getJson(fetch, `${SPORTSDB}/eventslast.php?id=${encodeURIComponent(hit.idTeam)}`).catch(() => ({})),
    getJson(fetch, `${SPORTSDB}/eventsnext.php?id=${encodeURIComponent(hit.idTeam)}`).catch(() => ({})),
  ])
  const played = (last.results || [])[0]
  const coming = (next.events || [])[0]
  const score = (v) => (v == null || v === '' ? null : parseInt(v, 10))
  return {
    team: hit.strTeam,
    league: hit.strLeague || null,
    last: played ? { home: played.strHomeTeam, away: played.strAwayTeam, homeScore: score(played.intHomeScore), awayScore: score(played.intAwayScore), date: played.dateEvent } : null,
    next: coming ? { home: coming.strHomeTeam, away: coming.strAwayTeam, date: coming.dateEvent, time: coming.strTime ? coming.strTime.slice(0, 5) : null, venue: coming.strVenue || null } : null,
  }
}

// The cartoon: today's xkcd. Its picture goes on the art shortlist like any
// photograph, so the writer cites an id and resolve / validate treat it as
// theirs — a cartoon the writer could paste a URL for is a cartoon anyone in
// the corpus could plant.
async function cartoon (fetch, art) {
  const strip = await getJson(fetch, 'https://xkcd.com/info.0.json')
  if (!strip || !/^https:\/\/imgs\.xkcd\.com\//.test(strip.img || '')) throw new Error('no strip today')
  const title = String(strip.safe_title || strip.title || '').slice(0, 120)
  const caption = String(strip.alt || '').slice(0, 400)
  const id = art.add(strip.img, 'xkcd', [title, caption].filter(Boolean).join(' — '))
  return { title, caption, number: strip.num, art: id, source: 'xkcd.com, CC BY-NC 2.5' }
}

// From the archive: one cartoon a day from Puck, the satirical weekly of
// 1877–1918, as published lithographs in the Library of Congress — public
// domain (published before 1929), keyless, and in keeping with a paper that
// looks back as well as forward. The day picks the page and the item, so it
// holds all day and changes tomorrow. Anything later than 1928 or without a
// picture is passed over.
async function archive (fetch, now) {
  const day = Math.floor(now / 86400)
  const page = (day % 60) + 1
  const found = await getJson(fetch, `https://www.loc.gov/photos/?q=puck&dates=1877/1918&fa=online-format:image&fo=json&c=25&sp=${page}`)
  const usable = (found && found.results || []).filter((r) => {
    const year = parseInt(String(r.date || ''), 10)
    const pictures = Array.isArray(r.image_url) ? r.image_url : []
    return year >= 1877 && year <= 1928 && pictures.length && /^https:\/\/tile\.loc\.gov\//.test(pictures[pictures.length - 1])
  })
  if (!usable.length) throw new Error('no cartoon on that page')
  const item = usable[day % usable.length]
  return {
    title: String(item.title || 'A cartoon').split(' / ')[0].replace(/^\[|\]$/g, '').replace(/[.\s]+$/, '').slice(0, 140),
    year: parseInt(item.date, 10),
    image: item.image_url[item.image_url.length - 1].replace(/#.*$/, ''),
    link: /^https:\/\/www\.loc\.gov\//.test(item.url || '') ? item.url : null,
    source: 'Puck, via the Library of Congress · public domain',
  }
}

// The serial: a public-domain novel from Project Gutenberg, one instalment a
// day, in order. The book is cut at paragraph breaks into instalments of about
// a column, and the day of the year picks which one — so no state is kept,
// and a reader who opens tomorrow's paper reads on from today's.
const INSTALMENT_WORDS = 550
const SERIAL_EPOCH = Date.UTC(2026, 0, 1)

async function serial (fetch, id, now) {
  const raw = await getText(fetch, `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`)
  const head = raw.split(/\*\*\* ?START OF/i)[0]
  const field = (name) => (new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(head) || [])[1]?.trim() || null
  const start = raw.search(/\*\*\* ?START OF[^\n]*\*\*\*\s*/i)
  const end = raw.search(/\*\*\* ?END OF/i)
  if (start === -1 || end === -1 || end <= start) throw new Error('not a Gutenberg text')
  const body = raw.slice(raw.indexOf('\n', start) + 1, end).replace(/\r/g, '')
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
  const instalments = []
  let current = []
  let words = 0
  for (const p of paragraphs) {
    current.push(p)
    words += p.split(/\s+/).length
    if (words >= INSTALMENT_WORDS) { instalments.push(current.join('\n\n')); current = []; words = 0 }
  }
  if (current.length) instalments.push(current.join('\n\n'))
  if (!instalments.length) throw new Error('an empty book')
  const day = Math.floor((now * 1000 - SERIAL_EPOCH) / 86_400_000)
  const index = ((day % instalments.length) + instalments.length) % instalments.length
  return {
    title: field('Title') || `Gutenberg #${id}`,
    author: field('Author'),
    id,
    instalment: index + 1,
    of: instalments.length,
    text: instalments[index].slice(0, 6000),
    source: 'Project Gutenberg, public domain',
  }
}

// Markets: bitcoin in three currencies, the fee to get into the next block,
// the block height, and the ECB's reference rates. Readings as of the fetch,
// stamped by the digest — a paper prints the close, not a ticker.
async function markets (fetch, notes) {
  const out = { bitcoin: null, fees: null, height: null, fx: null, source: 'mempool.space; ECB via Frankfurter' }
  const r4 = (n) => Math.round(n * 10000) / 10000
  try {
    const [px, fees, tip] = await Promise.all([
      getJson(fetch, 'https://mempool.space/api/v1/prices'),
      getJson(fetch, 'https://mempool.space/api/v1/fees/recommended'),
      getText(fetch, 'https://mempool.space/api/blocks/tip/height'),
    ])
    out.bitcoin = { usd: px.USD ?? null, eur: px.EUR ?? null, gbp: px.GBP ?? null }
    out.fees = { fastest: fees.fastestFee ?? null, hour: fees.hourFee ?? null }
    out.height = parseInt(String(tip).trim(), 10) || null
  } catch (error) {
    notes.push(`Markets: could not reach mempool.space (${String(error.message || error).slice(0, 80)})`)
  }
  try {
    const fx = await getJson(fetch, 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY,CHF')
    const rates = {}
    for (const code of ['EUR', 'GBP', 'JPY', 'CHF']) if (Number.isFinite(fx.rates?.[code])) rates[code] = r4(fx.rates[code])
    out.fx = { base: fx.base || 'USD', date: fx.date || null, rates }
  } catch (error) {
    notes.push(`Markets: could not reach the ECB rates (${String(error.message || error).slice(0, 80)})`)
  }
  return out.bitcoin || out.fx ? out : null
}

// The world at a glance: the past day's earthquakes of magnitude 4.5 and up,
// and the next public holiday where the reader lives. No place, no holiday;
// that is a quiet box, not a failure.
async function world (fetch, country, notes) {
  const out = { quakes: null, holiday: null }
  try {
    const q = await getJson(fetch, 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson')
    const list = (q.features || []).map((f) => f.properties || {}).filter((p) => Number.isFinite(p.mag))
    const top = list.sort((a, b) => b.mag - a.mag)[0]
    out.quakes = { count: list.length, strongest: top ? { magnitude: top.mag, place: String(top.place || '').slice(0, 120) } : null, source: 'USGS' }
  } catch (error) {
    notes.push(`World: could not reach the USGS (${String(error.message || error).slice(0, 80)})`)
  }
  if (country) {
    try {
      const list = await getJson(fetch, `https://date.nager.at/api/v3/NextPublicHolidays/${encodeURIComponent(country)}`)
      const next = Array.isArray(list) ? list[0] : null
      if (next) out.holiday = { date: next.date, name: String(next.localName || next.name || '').slice(0, 80), country, source: 'Nager.Date' }
    } catch (error) {
      notes.push(`World: could not reach Nager.Date for ${country} (${String(error.message || error).slice(0, 80)})`)
    }
  }
  return out
}

// The picture of the day: Wikimedia Commons' featured picture, at page size,
// with its maker and licence — both are conditions of using it.
async function featuredFeed (fetch, now) {
  const d = new Date(now * 1000)
  const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
  return getJson(fetch, `https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`)
}

// What the world looked up: Wikipedia's most-read pages of the day before —
// pop culture's barometer, and the same feed the picture comes from.
function lookedUp (feed) {
  const list = (feed.mostread && feed.mostread.articles) || []
  const items = list.filter((a) => a && a.normalizedtitle && a.normalizedtitle !== 'Main Page' && !/^Special:/.test(a.normalizedtitle))
    .slice(0, 5).map((a) => ({ title: String(a.normalizedtitle).slice(0, 120), views: a.views, about: a.description ? String(a.description).slice(0, 120) : null }))
  if (!items.length) throw new Error('nothing listed')
  return { date: String(feed.mostread.date || '').replace(/Z$/, '') || null, items, source: 'Wikipedia' }
}

async function picture (fetch, now, art, feed) {
  feed = feed || await featuredFeed(fetch, now)
  const img = feed.image
  const url = img && (img.thumbnail?.source || img.image?.source)
  if (!url || !/^https:\/\/[a-z0-9.-]+\.wikimedia\.org\//.test(url)) throw new Error('no featured picture today')
  const caption = String(img.description?.text || img.title || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  // Commons hands the artist as prose ("This photo was taken by X. Feel free
  // to…"); the first sentence is the credit.
  const artist = String(img.artist?.text || 'Unknown').replace(/\s+/g, ' ').trim().split(/(?<=[a-z])\. (?=[A-Z])/)[0].slice(0, 80)
  const id = art.add(url, artist, caption)
  // Its Commons page, for the living copy: a click on the picture opens it.
  const link = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s"'<>]{1,300}$/.test(img.file_page || '') ? img.file_page : null
  return { caption, artist, licence: img.license?.type || 'see Commons', art: id, source: 'Wikimedia Commons', link }
}

// The recipe of the day, from TheMealDB (the sports feed's sibling, same free
// key). Ingredients are paired to their measures and empty slots dropped; the
// source link stays out, because the paper prints no links to the open web.
async function recipe (fetch, art) {
  const found = await getJson(fetch, 'https://www.themealdb.com/api/json/v1/1/random.php')
  const m = found.meals && found.meals[0]
  if (!m || !m.strMeal) throw new Error('no dish today')
  const ingredients = []
  for (let i = 1; i <= 20; i++) {
    const item = String(m[`strIngredient${i}`] || '').trim()
    if (!item) continue
    ingredients.push({ item: item.slice(0, 60), measure: String(m[`strMeasure${i}`] || '').trim().slice(0, 40) })
  }
  const thumb = /^https:\/\/www\.themealdb\.com\//.test(m.strMealThumb || '') ? m.strMealThumb : null
  return {
    name: String(m.strMeal).slice(0, 120),
    kind: [m.strArea, m.strCategory].filter(Boolean).join(' · '),
    ingredients,
    method: String(m.strInstructions || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000),
    art: thumb ? art.add(thumb, 'TheMealDB', String(m.strMeal)) : null,
    source: 'TheMealDB',
    // The dish's own page, for the living copy's picture; never printed.
    link: /^\d{1,10}$/.test(String(m.idMeal || '')) ? `https://www.themealdb.com/meal/${m.idMeal}` : null,
  }
}

// Two alternates beside the recipe of the day, a vegetarian dish and
// something sweet, from TheMealDB's categories. The day picks each, so they
// hold all day and change tomorrow. The page offers them as quiet tabs.
const ALTERNATES = [['Vegetarian', 'Vegetarian'], ['Something sweet', 'Dessert']]
async function recipeAlternates (fetch, now) {
  const day = Math.floor(now / 86400)
  const out = []
  for (const [tab, category] of ALTERNATES) {
    const listed = await getJson(fetch, `https://www.themealdb.com/api/json/v1/1/filter.php?c=${category}`)
    const meals = (listed && listed.meals) || []
    if (!meals.length) continue
    const pick = meals[day % meals.length]
    const found = await getJson(fetch, `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(pick.idMeal)}`)
    const m = found && found.meals && found.meals[0]
    if (!m || !m.strMeal) continue
    const ingredients = []
    for (let i = 1; i <= 20; i++) {
      const item = String(m[`strIngredient${i}`] || '').trim()
      if (item) ingredients.push({ item: item.slice(0, 60), measure: String(m[`strMeasure${i}`] || '').trim().slice(0, 40) })
    }
    out.push({
      tab,
      name: String(m.strMeal).slice(0, 120),
      kind: [m.strArea, m.strCategory].filter(Boolean).join(' · '),
      image: /^https:\/\/www\.themealdb\.com\//.test(m.strMealThumb || '') ? m.strMealThumb : null,
      ingredients,
      method: String(m.strInstructions || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000),
      link: `https://www.themealdb.com/meal/${encodeURIComponent(m.idMeal)}`,
    })
  }
  return out
}

// Health and safety for the reader's place: facts to act on, not advice.
// The UV peak and the hours it is high (Open-Meteo); for a US place, the
// National Weather Service's active alerts, the fortnight's Class I food
// recalls (openFDA) and consumer-product recalls (CPSC). All keyless. Each
// source is asked on its own, so one that is down leaves the others.
const UV_LEVELS = [[11, 'extreme'], [8, 'very high'], [6, 'high'], [3, 'moderate'], [0, 'low']]
async function health (fetch, place, now) {
  const found = await getJson(fetch, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`)
  const spot = found.results && found.results[0]
  if (!spot) throw new Error(`no place called ${place}`)
  const lat = spot.latitude.toFixed(2)
  const lon = spot.longitude.toFixed(2)
  const us = spot.country_code === 'US'
  const out = { place: spot.name, uv: null, alerts: [], foodRecalls: [], productRecalls: [], source: us ? 'Open-Meteo · National Weather Service · openFDA · CPSC' : 'Open-Meteo' }
  const day = (t) => new Date(t * 1000).toISOString().slice(0, 10)
  const since = now - 14 * 86400

  try {
    const f = await getJson(fetch, `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index&daily=uv_index_max&forecast_days=1&timezone=auto`)
    const max = Math.round(f.daily.uv_index_max[0])
    const level = UV_LEVELS.find(([floor]) => max >= floor)[1]
    // The hours it is high or worse; on a moderate day, the moderate hours.
    const floor = max >= 6 ? 6 : max >= 3 ? 3 : null
    const at = floor == null ? [] : f.hourly.time.filter((_, i) => f.hourly.uv_index[i] >= floor)
    out.uv = { max, level, from: at.length ? at[0].slice(11, 16) : null, to: at.length ? at[at.length - 1].slice(11, 16) : null }
  } catch {}
  if (us) {
    try {
      const alerts = await getJson(fetch, `https://api.weather.gov/alerts/active?point=${lat},${lon}`)
      out.alerts = (alerts.features || []).slice(0, 3).map((a) => ({ event: String(a.properties.event || '').slice(0, 80), headline: String(a.properties.headline || '').slice(0, 200) }))
    } catch {}
    try {
      const range = `[${day(since).replace(/-/g, '')}+TO+${day(now).replace(/-/g, '')}]`
      const food = await getJson(fetch, `https://api.fda.gov/food/enforcement.json?search=report_date:${range}&sort=report_date:desc&limit=20`)
      out.foodRecalls = (food.results || []).filter((r) => r.classification === 'Class I').slice(0, 3).map((r) => ({
        product: String(r.product_description || '').slice(0, 90),
        firm: String(r.recalling_firm || '').slice(0, 60),
        date: String(r.report_date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
        reason: String(r.reason_for_recall || '').slice(0, 140),
      }))
    } catch {}
    try {
      const products = await getJson(fetch, `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${day(since)}`)
      out.productRecalls = (Array.isArray(products) ? products : []).sort((a, b) => String(b.RecallDate).localeCompare(String(a.RecallDate))).slice(0, 2)
        .map((r) => ({ title: String(r.Title || '').slice(0, 160), date: String(r.RecallDate || '').slice(0, 10) }))
    } catch {}
  }
  return out
}

// Launches: the next two rockets up, from The Space Devs' Launch Library 2
// (keyless, rate-limited, one call a print). "Rocket | mission" is split;
// a leading launch-complex name is dropped from the place, a town is kept.
async function launches (fetch) {
  const found = await getJson(fetch, 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=2&mode=list')
  const next = ((found && found.results) || []).slice(0, 2).map((l) => {
    const [rocket, ...rest] = String(l.name || '').split(' | ')
    const parts = String(l.location || '').split(', ')
    const place = parts.length > 1 && /\b(complex|launch|pad|site|slc|lc-)\b/i.test(parts[0]) ? parts.slice(1).join(', ') : parts.join(', ')
    return {
      rocket: rocket.trim().slice(0, 60),
      mission: rest.join(' | ').trim().slice(0, 100) || null,
      provider: String(l.lsp_name || '').slice(0, 60) || null,
      place: place.slice(0, 100) || null,
      at: Math.floor(Date.parse(l.net) / 1000),
      status: (l.status && l.status.abbrev) || null,
    }
  }).filter((l) => l.rocket && Number.isFinite(l.at))
  if (!next.length) throw new Error('no launches listed')
  return { source: 'The Space Devs, Launch Library 2', next }
}

// The tabloid: what the world is searching (Google Trends' daily feed, for
// the reader's country) and saying (Bluesky's trending topics, with their
// one-line whys). Not ranked by anyone the reader trusts, and the digest says
// so; a cooling topic is yesterday's news and is left out.
const SMALL_WORDS = new Set(['vs', 'v', 'and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'de', 'la', 'le', 'y', 'e'])
function titleCase (text) {
  return String(text).trim().split(/\s+/).map((w, i) => {
    const lower = w.toLowerCase()
    if (i > 0 && SMALL_WORDS.has(lower)) return lower
    if (/^\d/.test(w) || /^[A-Z0-9]+$/.test(w)) return w.toUpperCase()
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join(' ')
}

async function searching (fetch, geo) {
  const xml = await getText(fetch, `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`)
  const items = []
  for (const block of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]).slice(0, 8)) {
    const title = firstTag(block, ['title'])
    if (!title) continue
    const traffic = firstTag(block, ['ht:approx_traffic'])
    const story = firstTag(block, ['ht:news_item_title'])
    items.push({
      term: titleCase(xmlText(title.body)).slice(0, 80),
      traffic: traffic ? xmlText(traffic.body).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : null,
      story: story ? xmlText(story.body).slice(0, 160) : null,
    })
  }
  if (!items.length) throw new Error('nothing trending')
  return { geo, source: 'Google Trends', items }
}

async function saying (fetch) {
  const found = await getJson(fetch, 'https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=12')
  const items = (found.trends || []).filter((t) => t && t.displayName && t.status !== 'cooling').slice(0, 6).map((t) => ({
    topic: String(t.displayName).slice(0, 120),
    about: t.description ? String(t.description).replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    category: t.category || null,
    posts: Number.isFinite(t.postCount) ? t.postCount : null,
  }))
  if (!items.length) throw new Error('nothing trending')
  return { source: 'Bluesky', items }
}

/**
 * Everything the reader's settings ask for, or null when they ask for
 * nothing. `fetch` is injected so the tests can stand in for the network.
 */
export async function gatherWires (settings, { fetch = globalThis.fetch, now = Math.floor(Date.now() / 1000), nextArt = 1 } = {}) {
  if (!settings) return null
  const wires = { asOf: now, weather: null, sports: null, almanac: null, headlines: [], cartoon: null, archive: null, serial: null, markets: null, world: null, picture: null, recipe: null, recipes: [], health: null, launches: null, lookedUp: null, tabloid: null, art: [], notes: [] }
  const reason = (error) => String(error && error.message ? error.message : error).slice(0, 120)
  // Pictures the wires bring, numbered after the corpus's own shortlist.
  let artN = nextArt
  const art = { add: (url, byline, from) => { const id = `art-${artN++}`; wires.art.push({ id, url, byline, from }); return id } }

  if (settings.place) {
    try {
      wires.weather = await weather(fetch, settings.place, settings.units, settings.sky, now)
    } catch (error) {
      wires.notes.push(`Weather: could not reach Open-Meteo (${reason(error)})`)
    }
  }
  if ((settings.teams || []).length) {
    const teams = []
    for (const name of settings.teams) {
      try {
        const found = await team(fetch, name)
        if (found) teams.push(found)
        else {
          const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name)
          wires.notes.push(m ? `Sports: TheSportsDB knows no ${m[2].trim()} team called ${m[1].trim()}` : `Sports: TheSportsDB knows no team called ${name}`)
        }
      } catch (error) {
        wires.notes.push(`Sports: could not reach TheSportsDB for ${name} (${reason(error)})`)
      }
    }
    if (teams.length) wires.sports = { source: 'TheSportsDB', teams }
  }
  if (settings.almanac) {
    try {
      wires.almanac = await almanac(fetch, now)
    } catch (error) {
      wires.notes.push(`Almanac: could not reach Wikipedia (${reason(error)})`)
    }
  }
  if (settings.cartoon) {
    try {
      wires.cartoon = await cartoon(fetch, art)
    } catch (error) {
      wires.notes.push(`Cartoon: could not reach xkcd (${reason(error)})`)
    }
  }
  if (settings.cartoon) {
    try {
      wires.archive = await archive(fetch, now)
    } catch (error) {
      wires.notes.push(`Cartoon archive: could not reach the Library of Congress (${reason(error)})`)
    }
  }
  if (settings.serial) {
    try {
      wires.serial = await serial(fetch, settings.serial, now)
    } catch (error) {
      wires.notes.push(`Serial: could not reach Project Gutenberg (${reason(error)})`)
    }
  }
  if (settings.picture || settings.culture) {
    let feed = null
    try { feed = await featuredFeed(fetch, now) } catch (error) { wires.notes.push(`Wikipedia: could not reach its daily feed (${reason(error)})`) }
    if (feed && settings.picture) {
      try { wires.picture = await picture(fetch, now, art, feed) } catch (error) { wires.notes.push(`Picture of the day: ${reason(error)}`) }
    }
    if (feed && settings.culture) {
      try { wires.lookedUp = lookedUp(feed) } catch (error) { wires.notes.push(`Looked up: ${reason(error)}`) }
    }
  }
  if (settings.recipe) {
    try {
      wires.recipe = await recipe(fetch, art)
    } catch (error) {
      wires.notes.push(`Recipe: could not reach TheMealDB (${reason(error)})`)
    }
  }  if (settings.launches) {
    try {
      wires.launches = await launches(fetch)
    } catch (error) {
      wires.notes.push(`Launches: could not reach Launch Library (${reason(error)})`)
    }
  }
  if (settings.health && settings.place) {
    try {
      wires.health = await health(fetch, settings.place, now)
    } catch (error) {
      wires.notes.push(`Health and safety: could not place ${settings.place} (${reason(error)})`)
    }
  }
  if (settings.recipe) {
    try {
      wires.recipes = await recipeAlternates(fetch, now)
    } catch (error) {
      wires.notes.push(`Recipe alternates: could not reach TheMealDB (${reason(error)})`)
    }
  }

  if (settings.tabloid) {
    const geo = settings.country || (wires.weather && wires.weather.country) || 'US'
    const tabloid = { searching: null, saying: null }
    try { tabloid.searching = await searching(fetch, geo) } catch (error) { wires.notes.push(`Tabloid: could not reach Google Trends (${reason(error)})`) }
    try { tabloid.saying = await saying(fetch) } catch (error) { wires.notes.push(`Tabloid: could not reach Bluesky (${reason(error)})`) }
    if (tabloid.searching || tabloid.saying) wires.tabloid = tabloid
  }
  if (settings.markets) wires.markets = await markets(fetch, wires.notes)
  if (settings.world) wires.world = await world(fetch, settings.country || (wires.weather && wires.weather.country) || null, wires.notes)
  for (const entry of settings.feeds || []) {
    const url = typeof entry === 'string' ? entry : entry.url
    try {
      wires.headlines.push(await feed(fetch, entry))
    } catch (error) {
      wires.notes.push(`Headlines: ${new URL(url).hostname} had no headlines to read`)
    }
  }
  return wires
}
