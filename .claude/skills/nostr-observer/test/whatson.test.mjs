// What's On: the calendar events the reader's network posted, sorted the way
// a paper's listings are — what is near you, what you can join from anywhere,
// and how far the rest is. Upcoming only, each event once.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { whatsOn, geohashPoint } from '../scripts/whatson.mjs'

const CHICAGO = { lat: 41.88, lon: -87.63, place: 'Chicago' }
const NOW = 1790309349 // 2026-09-25 04:09 UTC, the edition's close
const at = (iso) => Math.floor(Date.parse(iso) / 1000)
let n = 0
const event = (title, start, location, g, kind = 31923) => ({
  id: (++n).toString(16).padStart(64, '0'), kind, pubkey: 'a'.repeat(64), created_at: NOW - 100,
  tags: [['d', `e${n}`], ['title', title], ['start', String(start)], ...(location ? [['location', location]] : []), ...(g ? [['g', g]] : [])],
  content: '',
})

const coffee = event('Bitcoin & Coffee', at('2026-09-29T13:00:00Z'), 'The Corner Café, 100 Main St, Chicago, IL, United States', 'dp3wjnpym')
const indy = event('Indy Bitcoin Meetup', at('2026-10-10T22:30:00Z'), 'A hall downtown, Indianapolis, IN', 'dp4dprt9m')
const london = event('Socratic Seminar #53', at('2026-09-30T18:00:00Z'), 'Antidote, The Bindery, 51-53 Hatton Garden, London', 'gcpvje0vq')
const online = event('Webend Coffee Talk', at('2026-09-26T11:00:00Z'), 'Online Nostr Meeting', null)
const jitsi = event('Decentralize The Meetup - working session (Jitsi)', at('2026-10-02T23:00:00Z'), null, null)
const textOnly = event('Chicago BitDevs', at('2026-10-01T00:00:00Z'), 'A coworking space, Chicago, IL', null)
const past = event('MWBTC 5k', at('2026-09-24T12:00:00Z'), 'Columbus, OH', 'dphgrk0fy')
const farOff = event('Bury Town Vs Real Bedford', at('2027-01-30T11:00:00Z'), 'Ram Meadow, Bury St Edmunds', 'u12')
const dupes = [0, 1, 2].map(() => event('Einundzwanzig Ostschweiz', at('2026-10-01T16:30:00Z'), 'Saal im 1. Stock', 'u0qmndq8q'))

test('a geohash is decoded to the middle of its cell', () => {
  const p = geohashPoint('dp3wjnpym')
  assert.ok(Math.abs(p.lat - 41.87) < 0.02 && Math.abs(p.lon - -87.66) < 0.02, JSON.stringify(p))
  assert.equal(geohashPoint('not a geohash!'), null)
})

test('near you, online, and the rest by distance; upcoming within three weeks only', () => {
  const on = whatsOn([london, indy, coffee, online, jitsi, textOnly, past, farOff, ...dupes], { ...CHICAGO, now: NOW })
  assert.deepEqual(on.near.map((x) => x.event.id), [coffee.id, textOnly.id], 'soonest first; a place named in the location counts when there is no geohash')
  assert.ok(on.near[0].km < 10, `The café is in town (${on.near[0].km} km)`)
  assert.equal(on.near[1].km, null, 'named, not measured')
  assert.deepEqual(on.online.map((x) => x.event.id), [online.id, jitsi.id])
  assert.deepEqual(on.elsewhere.map((x) => x.event.id), [indy.id, london.id, dupes[0].id], 'nearest first, each event once')
  assert.ok(on.elsewhere[0].km > 250 && on.elsewhere[0].km < 300, `Indianapolis is a drive (${on.elsewhere[0].km} km)`)
  assert.ok(!JSON.stringify(on).includes(past.id), 'a meetup that has happened is not on')
  assert.ok(!JSON.stringify(on).includes(farOff.id), 'January is not this month')
})

test('an all-day event is on from its date; with no place known, nothing is near and nothing is measured', () => {
  const fair = event('Nostr Book Fair', '2026-10-03', 'Chicago Public Library', null, 31922)
  const on = whatsOn([fair, coffee], { lat: null, lon: null, place: null, now: NOW })
  assert.deepEqual(on.near, [])
  assert.deepEqual(on.elsewhere.map((x) => [x.event.id, x.km]), [[coffee.id, null], [fair.id, null]], 'soonest first when distance is unknown')
  assert.equal(on.elsewhere[1].start, at('2026-10-03T00:00:00Z'))
})
