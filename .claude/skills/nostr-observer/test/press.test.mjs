// Stop Press: the posts that arrived after the paper closed, edited the way a
// late-news column is — small talk left out, replies left out (the page cannot
// show what they answer), one line per person, and the post with the most to
// say set as the lead. The page runs these functions byte for byte.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stopPress, pressText, headlineOf } from '../scripts/press.mjs'

const MARCEL = 'a1'.repeat(32)
const BLITZ = 'b2'.repeat(32)
const AARON = 'c3'.repeat(32)
const CROWN = 'd4'.repeat(32)
let n = 0
const note = (pubkey, created_at, content, tags = []) => ({ id: (++n).toString(16).padStart(64, '0'), pubkey, created_at, content, tags, kind: 1 })

// Newest first, as the drawer hands them over — the evening the screenshot showed.
const fresh = [
  note(MARCEL, 1790360000, 'Autsch 🤣'),
  note(BLITZ, 1790359000, 'Just so we can better debug the issue, do you have Google Play services enabled on GrapheneOS?', [['e', 'f'.repeat(64), '', 'reply'], ['p', AARON]]),
  note(AARON, 1790358000, 'So kinda like the SETI at home project, but for AI? Sounds plausible. One advantage I see is that data center heat is generally wasted, where as heat from my PC goes towards heating my home.'),
  note(MARCEL, 1790357000, '👀'),
  note(AARON, 1790356000, 'GM'),
  note(CROWN, 1790355000, 'I’ve never had much interest in fitting neatly into systems, labels or expectations. The older I get, the less interested I am in explaining that.'),
  note(CROWN, 1790338000, 'ROAM FREELY is live. No store. No checkout. No permission needed. Grab the HQ file. Print it. nostr:nevent1abc https://img.example/roam.png'),
  note(CROWN, 1790337000, 'It’s not for sale, hq PNG files are free/v4v to download and you can do whatever you want with them.'),
]

test('small talk and replies are left out; what is left is one line per person', () => {
  const press = stopPress(fresh)
  const people = [press.lead, ...press.briefs].map((s) => s.event.pubkey)
  assert.deepEqual(new Set(people), new Set([AARON, CROWN]), 'GM, an emoji and a reply the page cannot place are not news')
  assert.equal(press.stories, 2)
  const crown = [press.lead, ...press.briefs].find((s) => s.event.pubkey === CROWN)
  assert.equal(crown.count, 3, 'three posts from one person are one line, marked as three')
  assert.equal(crown.event.created_at, 1790355000, 'and the line is their latest')
})

test('the lead is the post with the most to say; the rest are briefs, newest first', () => {
  const press = stopPress(fresh)
  assert.equal(press.lead.event.pubkey, AARON)
  assert.equal(press.lead.headline, 'So kinda like the SETI at home project, but for AI?')
  assert.equal(press.lead.text, 'Sounds plausible. One advantage I see is that data center heat is generally wasted, where as heat from my PC goes towards heating my home.')
  assert.deepEqual(press.briefs.map((s) => s.event.pubkey), [CROWN])
})

test('a quote is still news, and a note that only mentions someone is not a reply', () => {
  const quoted = note(MARCEL, 1790361000, 'This is the best explanation of the fee market I have read all year.', [['q', 'e'.repeat(64)]])
  const mention = note(BLITZ, 1790362000, 'Blitz Recover now restores wallets from a single backup file on any device.', [['e', 'e'.repeat(64), '', 'mention']])
  const press = stopPress([mention, quoted, ...fresh])
  const people = [press.lead, ...press.briefs].map((s) => s.event.pubkey)
  assert.ok(people.includes(MARCEL) && people.includes(BLITZ))
  const positional = note(BLITZ, 1790363000, 'Yes, that is exactly what I meant by the recovery flow earlier today.', [['e', 'e'.repeat(64)]])
  assert.equal(stopPress([positional]).stories, 0, 'an unmarked e tag is the old way of replying')
})

test('the text is read, not markup: references and links are gone, whitespace closed up', () => {
  assert.equal(pressText('ROAM FREELY is live.  nostr:nevent1abc https://img.example/a.png\n\nPrint it.'), 'ROAM FREELY is live. Print it.')
  assert.equal(pressText('Hold your keys. Train your body. Trust yourself. ⚡️ #RUNSTR #Bitcoin'), 'Hold your keys. Train your body. Trust yourself. ⚡️',
    'a trailing run of hashtags is filing, not writing')
  assert.equal(pressText('Why #bitcoin fixes this, again.'), 'Why #bitcoin fixes this, again.', 'a hashtag inside a sentence is a word')
})

test('markdown is read as the words it marks: no asterisks, no heading marks, a link keeps its text', () => {
  assert.equal(pressText('📰 **In this week\'s issue:** a market, and __more__'), '📰 In this week\'s issue: a market, and more')
  assert.equal(pressText('**BREAKING** Nostr Just Became Bitcoin\'s Swap Discovery'), 'BREAKING Nostr Just Became Bitcoin\'s Swap Discovery')
  assert.equal(pressText('### Why this matters\nEtsy takes [25.9%](https://www.fool.com/x) now.'), 'Why this matters Etsy takes 25.9% now.')
  assert.equal(pressText('2 * 3 = 6, and 4*5 too'), '2 * 3 = 6, and 4*5 too', 'a lone asterisk is arithmetic')
  assert.equal(pressText('snake_case_name stays'), 'snake_case_name stays')
})

test('a headline is the first sentence, cut at a word when it runs long', () => {
  assert.deepEqual(headlineOf('Short one. Then the rest of it.'), { headline: 'Short one.', text: 'Then the rest of it.' })
  const long = 'This first sentence goes on and on about many things that happened today on the network and never seems to stop for breath at all'
  const { headline, text } = headlineOf(long)
  assert.ok(headline.length <= 90 && headline.endsWith('…'), headline)
  assert.ok(!/\s…$/.test(headline), 'cut at a word, not mid-space')
  assert.ok(text.startsWith('…') && long.endsWith(text.slice(1)), 'the story carries on under the headline where it was cut')
  assert.equal(headline.slice(0, -1) + ' ' + text.slice(1), long)
})

test('every brief is kept, newest first, for the page to fold; nothing worth printing gives no lead', () => {
  const many = Array.from({ length: 14 }, (_, i) => note((i + 10).toString(16).repeat(32).slice(0, 64), 1790300000 + i, `Person ${i} wrote a thoughtful post about something that happened today.`))
  const press = stopPress(many)
  assert.equal(press.briefs.length, 13, 'the page shows eight and folds the rest; it does not send the reader off to a raw search')
  assert.deepEqual(press.briefs.map((b) => b.event.created_at), [...press.briefs.map((b) => b.event.created_at)].sort((a, b) => b - a))
  assert.equal(press.stories, 14, 'the count says how many made the cut')
  const quiet = stopPress([note(MARCEL, 1, 'GM'), note(AARON, 2, '👀 👀')])
  assert.equal(quiet.lead, null)
  assert.deepEqual(quiet.briefs, [])
  assert.equal(quiet.stories, 0)
})

test('the living copy carries these functions byte for byte', () => {
  const living = readFileSync(new URL('../reference/living.js', import.meta.url), 'utf8')
  for (const fn of [pressText, headlineOf, stopPress]) assert.ok(living.includes(fn.toString()), `${fn.name} matches press.mjs`)
})
