# AGENTS.md

The headless generator (`generator/`) and the web app (`server/`) are both
built and run against the live relay. What has never run is the model call
itself: there is no `ANTHROPIC_API_KEY` in the dev container, so everything from
`Writer.write` onward is untested against the real API. **[`docs/PLAN.md`](docs/PLAN.md) is the design**
— read it before writing code; this file holds only what the plan does not: the
decisions that are settled, the ones that are not, the readings taken off the
live relays, and the conventions to hold to.

## What this is

A service that reads a signed-in Nostr user's web-of-trust view of the last 24
hours and generates a newspaper front page from it, which they then publish to
their own Blossom servers as an nsite.

Sibling project to **[vespa-relay](https://github.com/NosFabrica/vespa-relay)**,
which is the search relay this reads from. That repo's `AGENTS.md` is worth
reading — the commenting conventions, the JitPack pinning trap, and the
"instrument before you theorize" habit all apply here.

## Build

    ./gradlew build                 # compile + test + spotless
    ./gradlew spotlessApply         # run BEFORE committing; formatting alone fails the build
    ./gradlew :generator:installDist
    generator/build/install/generator/bin/generator <npub> --check
    generator/build/install/generator/bin/generator <npub> --dry-run

    ./gradlew :server:installDist
    OBSERVER_INSECURE_COOKIES=true PORT=8099 server/build/install/server/bin/server

`OBSERVER_DB`, `OBSERVER_RELAY`, `OBSERVER_EFFORT`, `PORT`, `HOST` and
`OBSERVER_INSECURE_COOKIES` configure the server. The last one lets the session
cookie travel over plain HTTP and is for local work only — a deployment that
sets it is asserting that TLS terminates somewhere in front of it.

`--check` reports the readiness chain and stops. `--dry-run` does everything
except call the model and writes the digest instead of a page. Neither needs an
API key. A full run reads `ANTHROPIC_API_KEY` from the environment.

## Settled — do not relitigate without a reason

- **There is no fallback lens.** A reader without a resolvable `kind 10040` gets
  the readiness chain and a wait, not a paper. The provisional lens — follows
  plus follows-of-follows, ranked by recency — was built for the 4.5% finding
  and removed on 2026-08-18: it showed a first-time reader the one version of
  the product that cannot demonstrate what the product is for (measured overlap
  with the unranked control: 0 of 400, where a real lens gives 1 of 400), and it
  read up to 120 strangers' follow lists off other people's relays to do it.
  `observer:<pk> sort:rank` with an unresolvable token does not error — it
  silently becomes the anonymous ranking — so the readiness chain is the gate,
  and `Press` refuses with `NO_LENS` rather than building a corpus another way.

- **Nostr goes through quartz. All of it.** `NostrClient` + the `fetchAll` and
  `count` accessories, `Filter`, `Event`, `AdvertisedRelayListEvent`,
  `ServiceProviderTag`, `MetadataEvent`, NIP-19 decoding. The generator once
  carried ~400 lines of hand-rolled bech32, websocket and NIP-01 dispatch; all
  of it already existed in the library the relay itself is built on. What is
  left local is in `nostr/Relays.kt` (timeout and REQ-size policy) and
  `nostr/Tags.kt` (generic tag reads quartz has no named helper for).

- **Window is 24 hours, fixed.** Not "since last login."
- **No prompt caching**, and no shared wire/personal split. Every edition is
  generated standalone from one feed.
- **The model writes the whole document**, markup and optionally CSS. It is not
  filling a schema. Safety is enforced *after* generation by the sanitizer, not
  before it by constraining the writer.
- **No NSFW classification.** The trust provider is the moderator. We honor the
  lens including the parts we would not have chosen.
- **Art is hotlinked**, never fetched, resized, re-hosted or inlined. There is no
  image library in this project.
- **Login required to generate**; no login to read a published edition.
- **The system prompt is fixed, hidden, and never reaches the client.**
- **The paper prints addresses; it does not make them clickable.** No `<a href>`
  to the open web survives — only permalinks back to a source event. An earlier
  version allowlisted any URL that appeared in the corpus; a test caught that
  the corpus is where the attacker writes, so posting a phishing URL was enough
  to allowlist it. Presence in the corpus is evidence of nothing.

## Measured facts about the relays (2026-08-17 — re-measure, do not trust)

- **`search-staging` holds no kind 3 at all**, and `/stats.json` confirms it is
  not a mirrored kind. Follow lists must come from the reader's own write relays,
  discovered from their kind 10002 — which *is* mirrored. The outbox model
  working, not a workaround.
- **NIP-45 COUNT answers** on both `search-staging` and `scores.brainstorm.world`.
  It is still optional, and a null count is a supported answer that must draw
  nothing rather than estimate.
- **`search-staging` sends an AUTH challenge before answering a COUNT**, even
  though `auth_required` is false. Anything resolving on the first non-EVENT
  frame reads the challenge as the answer.
- **The relay is CLOSED to tokenless queries (2026-08-30).** Every REQ and
  COUNT whose `search` carries neither an `observer:<64-hex>` token nor
  `include:spam` gets `CLOSED auth-required: this relay answers through a web
  of trust and has no house observer to lend you…` — so a plain lookup (a
  kind 0, a 10002, a 10063) reads as empty, which looks exactly like a reader
  who published nothing. Every unranked query we send now says `include:spam`;
  the ranked desks already name their observer. `include:spam sort:rank` is
  still the anonymous ranking, not a recency cut — measured the same day, its
  top 100 shares 0 events with plain `include:spam` at the same limit — so the
  control run keeps its meaning. The gate is the search relay's alone:
  `scores.brainstorm.world` and `nip85.nosfabrica.com` answered tokenless
  queries the same day, and a reader's own relays may refuse a `search` field
  they do not implement, so the token goes only on the search-relay leg of any
  fan-out. `Relays.INCLUDE_SPAM` / `INCLUDE_SPAM` in `nostr.mjs` hold this.
- **A NIP-50 search with no `since` times out** on this store; the same search
  with a 24-hour `since` answers immediately.
- **`observer:` RANKS, it does not filter.** The candidate set for a query is
  the whole window — 35,084 kind-1 notes in 24 hours, measured 2026-08-18 — and
  `limit` is what turns that into a top-N. So `limit` is the lens's cutoff, not
  pagination, and "just ask for everything" is a request for the firehose.
- **Selection is by score; delivery is by `created_at` descending.** Measured:
  a `limit=400` read spans the full 23.5 hours and shares only 48 events with
  the newest 400 of a `limit=3000` read, so it is not a recency cut — but 2999
  of 2999 consecutive pairs arrive in time order, and quartz's `EventCollector`
  appends without sorting, so that ordering is the relay's. **The score is not
  recoverable from the response**, which is why a client cannot do its own
  ranked cut and why `limit` has to carry that job.
- **`filter:rank:gte:N` is the trust floor, and it is NOT redundant with
  `limit`.** Counts over one 24-hour window for the prototype observer: no floor
  35,084 · gte:5 22,899 · gte:10 16,265 · gte:20 11,838 · gte:30 9,607 · gte:50
  6,834. At `limit=400`, adding `gte:20` replaced 49 of the 400 notes — so the
  top-N is not a strict top-N by the same score the floor uses. The pipeline
  sends `gte:20`; the control run gets no floor and no observer, deliberately.
- **The floor bites hardest on the small desks.** Same window: long-form 94 → 22,
  calendar 100 → 28, file metadata 29 → 10, wiki 20 → 11, and what survives is
  concentrated in very few authors (wiki: 11 entries from 1 person). That is
  "sections are earned, not fixed" working as the plan intends, but it is a
  visible editorial change and not only a quality gate.
- **COUNTs must go one at a time.** Issuing the readiness chain's four COUNTs
  concurrently was tried and `--check` went from ~3s to hanging. Probably the
  AUTH challenge above, racing on one socket. The fetches around them do run in
  parallel; the counts do not.
- **The relay goes through spells of not answering COUNTs at all.** Seen
  2026-08-18: `--check` blocked until killed on roughly half of consecutive
  runs, and reproduced identically on the previous commit, so it is the store
  and not the client. `Relays.deadline` bounds every read so a request handler
  cannot block forever, but the underlying cause is undiagnosed. **This is the
  reason not to hammer it** — the audit itself did, and should not have.
- **Neither `nip85.nosfabrica.com` nor `scores.brainstorm.world` exposes an HTTP
  API.** Both answer NIP-11 as plain strfry relays, so minting a lens is an
  operator step, not a call.
- **A REQ over `max_message_length` is dropped in silence.** `search-staging`
  advertises 262144 bytes and enforces it with no NOTICE and no CLOSED: the
  subscription stays open saying nothing, the idle timer expires, and quartz
  reports an empty list. An edition built from a 600-pubkey author list across
  nine desks — ~353 KB — returned zero events this way while every one of those
  queries answered normally on its own. Six desks at 235 KB answered; nine at
  353 KB did not. `Relays.batches` splits under a budget. That caller has since
  been removed with the provisional lens, so the split is now a guard nothing
  exercises in production.
- **Read NIP-11 before theorising about a relay.** `limitation` states the
  message cap, filter count, subscription count and default limit. All of the
  above was one `curl -H "Accept: application/nostr+json"` away.

## The Claude Code skill (`.claude/skills/`)

**It lives in `.claude/skills/` and not in a `plugin/` wrapper, deliberately.**
It was a plugin first. That bought nothing: no `marketplace.json` existed
anywhere, so nobody could install it as one, and the skill ships no commands,
agents, hooks or MCP servers — the only things a plugin adds over a skill. What
it cost was the install step. `.claude/skills/` is where Claude Code looks for
PROJECT skills, so a checkout of this repository now has the Observer skill
loaded already, in the terminal, in the desktop app, and at claude.ai/code —
which is the whole browser path, and it needs no terminal at all. One copy, so
nothing to mirror and nothing to drift. If a marketplace listing is ever wanted,
a `.claude-plugin/plugin.json` is ten lines and can be added then.

Plain claude.ai chat is NOT a substitute, and the blocker has no workaround.
Custom skills do upload there (Customize → Skills, as a ZIP, with code
execution enabled), but the sandbox reaches an allowlist — Anthropic, the
package registries, github, ubuntu — that does not include the relay. The
"all domains" setting opens HTTP egress through a proxy; the ranked query is a
websocket. Measured 2026-08-22: `search-staging` serves its NIP-11 document
over HTTPS and 404s `/req`, `/api/search` and `/search`, so there is no HTTP
form of `observer:<pk> sort:rank` to fall back to.

A second, much smaller implementation of the read path, in Node, shipped as a
Claude Code skill. It exists because it is the only distribution of this product
that can legitimately run on the reader's own Claude subscription: Anthropic's
[legal-and-compliance page](https://code.claude.com/docs/en/legal-and-compliance)
says OAuth is for "ordinary use of Claude Code and other native Anthropic
applications" and that third-party developers may not "route requests through
Free, Pro, or Max plan credentials on behalf of their users". Distributing a
skill is distributing text; the reader's own Claude Code makes the call. A
desktop app that spawns their `claude` CLI would not clear that bar, and neither
would a `CLAUDE_CODE_OAUTH_TOKEN` pasted into anything of ours.

- **NO NIP-45 COUNT ANYWHERE.** Every question it asks is a REQ. That is what
  sidesteps the AUTH-challenge-before-COUNT behaviour, the four-concurrent-COUNTs
  hang, and the spells of not answering COUNTs at all — all three recorded above.
  The cost is stated in `readiness.mjs`: link 3 becomes present/absent instead of
  a percentage, so the skill never reports `importing` and never prints a bar.
  That is the existing contract (`Readiness.fraction` already returns null with no
  honest denominator), not a new one.

- **The readiness chain is a GATE, not a warning.** Same reason as everywhere
  else: an unresolvable observer degrades silently. Measured 2026-08-21 against
  `search-staging` with an npub that has no cards for its provider: the fourteen
  desks returned 0 events while the control run returned 400 — the `filter:rank:gte:20`
  floor bites where the bare `sort:rank` probe would have degraded quietly. Do not
  read that as the floor making the gate unnecessary; the readiness probe itself
  sends no floor, precisely so it can see the degradation.

- **`validate.mjs` does two jobs, because there is no sanitizer.** In the Kotlin,
  `Sanitizer` strips and `Validator` verifies. The skill has no stripping half, so
  forbidden markup is REFUSED rather than removed — a silent strip would hide a
  successful injection. Its haystack is the ranked desks only, matching
  `Validator.kt`'s `corpus.all()`; the control run is not quotable.

- **Permalinks are brainstorm.world `nevent1` URLs** (since 2026-09-25; they
  were jumble.social before, and `resolve.mjs` still upgrades old jumble and
  njump hex forms), decoded rather than captured. Articles (30023/30818) go to
  `brainstorm.world/a/<naddr>` by address, for the calendar reason: edited in
  place. Names link to `brainstorm.world/p/<npub>`; the writer form names one
  of the person's POSTS (`/p/<64-hex-event-id>`) because the digest carries no
  pubkeys, and the checker refuses a profile of anyone who did not post in the
  window. Brainstorm routes were read from its live bundle and
  `NosFabrica/Brainstorm-UI` `client/src/App.tsx` on 2026-09-25 — production
  renders every naddr at /a/ as an article, which is why streams, listings and
  calendars keep their own hosts.
  The writer cites `https://brainstorm.world/e/<64-hex>`; `resolve.mjs` encodes
  the nevent; `validate.mjs` decodes it and checks the id against the corpus.
  The Kotlin regex once allowed `nevent1…` in a branch that captured nothing, so
  every such link compared against the empty string and a page citing its sources
  the normal way failed its own check. Decode, or do not accept the link. The
  full Observer still uses njump.me; this is the skill's host.

- **Three desks get a real destination, and nothing else does.** Broadcasting
  links to zap.stream, Classifieds to Shopstr, Diary & Calendar to
  brainstorm.world `/a/` (njump until 2026-09-25; see below) — each
  one an `naddr` the boundary derives, never a URL the writer composed. The
  shape is the art-id shape: the digest hands the writer a writer-form URL, the
  resolver re-encodes it to the host's canonical address, and the validator
  decodes it back and checks the id against the corpus. A fabricated watch or
  listing link is therefore structurally impossible rather than merely
  detectable, which is why these three are not an exception to "no links to the
  open web" so much as an application of the same rule. Only events carrying a
  `d` tag qualify: without one there is no address to build, and printing a link
  the sanitizer will unwrap is worse than printing none. Calendar went to njump
  rather than jumble because jumble has no calendar view, and goes by address
  because an `nevent` would freeze one revision of a replaceable event.

- **`reference/` is generated.** `tools/sync-skill.sh` copies `system-prompt.md`
  and `house.css` in and prepends a banner correcting the three statements in the
  brief that are true only of the Messages API harness (a sanitizer runs after
  you; the corpus is a `<corpus>` block; return HTML and nothing else). Run it
  after editing either resource — the copies are committed, so `git diff
  --exit-code` after running it says whether they are current.

- **Artifacts block remote images, so the artifact gets its own copy.** The
  viewer's content policy refuses every external host, so a hotlinked picture
  never loads there however correct its URL — the first edition shipped three
  empty boxes proving it. Since 2026-08-30 `scripts/embed.mjs` builds a
  separate `.artifact.html` with the pictures inlined as `data:` URIs, and
  `SKILL.md` step 7 publishes that copy while the reader keeps the hotlinked
  file. The settled hotlinking decision is not repealed: the EDITION never
  inlines art — the artifact copy is a delivery envelope. Two guards, because
  fetching is new attack surface: only shortlist URLs are fetched at all (the
  corpus is where the attacker writes, and "fetch what the page says" is an
  outbound request on their behalf), and the bytes are admitted by magic
  numbers rather than the server's Content-Type, raster formats only — an SVG
  is a document. A picture that cannot be embedded stays a hotlink and
  degrades to caption and alt, reported loudly, which is that rule earning its
  keep rather than being theoretical.

- **`resolve.mjs` exists because the brief promises it.** The brief says
  `<img src="art-3">` and "the id is replaced with the real URL afterwards", and
  "never write a raw URL in `src`". The first version of this skill told the
  writer the opposite and validated URLs only, so a page written to the brief
  would have had every picture rejected — the same two-halves-disagreeing bug as
  the `nevent1` branch that captured nothing. `resolve.mjs` is that afterwards:
  ids to URLs, unknown id loses its whole figure, hex permalinks encoded to
  jumble.social nevent URLs, stream / listing / calendar links encoded to their
  host's naddr, and every other link to the open web unwrapped to plain text. It
  PRINTS every change that is not a plain resolution, because a dropped figure
  or an unwrapped link is the visible edge of an injection attempt and a
  sanitizer that tidies up in silence hides the one event worth seeing.

- **Tests: `node --test ".claude/skills/*/test/*.test.mjs"`,** wired
  into `build.yml` alongside a `git diff --exit-code` on the generated
  `reference/`. `test/fakerelay.mjs` is a dependency-free websocket server that
  reproduces the AUTH-before-answer challenge, a mid-stream NOTICE, a silent
  subscription and a CLOSED-with-reason, so the relay hazards above are held to
  the same no-network rule as the rest of CI. The golden-edition test runs the
  56 KB prototype broadsheet through `resolve` + `validate` with a corpus derived
  from the page itself and asserts nothing is flagged: the adversarial tests ask
  whether the boundary stops bad pages, and that one asks whether it damages good
  ones, which is the likelier way to ship something broken.

- **The living layer is script, added after the boundary and never by the
  writer (2026-09-25).** `scripts/dress.mjs` runs `check()` first and refuses a
  page with any violation, then inlines `reference/living.css`, the fonts in
  `reference/fonts/` (OFL: Playfair Display, Source Serif 4, IBM Plex Mono,
  Figtree) and `reference/living.js` into a separate `.living.html`. The rule that the page
  runs nothing is about content from the corpus, and it still holds: no byte
  of script comes from the writer or from a post. The corpus rides along as a
  JSON island with every `<` escaped, and `living.js` puts it in the DOM with
  `textContent` only. Profiles now keep `picture` (https only) and `about` for
  the hover cards; the digest does not print them, so a bio cannot steer the
  writer. Hover cards ask three public relays (damus, nos.lol, primal) for
  reply / repost / reaction / zap counts, on hover, once per note — the one
  network read the paper makes after it is printed, stated here so it is a
  decision and not a surprise. The accent comes from the lead photo when its
  host allows CORS, else from the date. Tests: `test/dress.test.mjs`.

- **A reader can name and brand their paper (2026-09-25).** `observer.config.json`
  in the working directory (`name`, `motto`, `brand`; short strings, no
  markup) is read by `corpus.mjs` into `corpus.paper`. `digest()` prints it as
  a Masthead block — the brief always said the writer "will be given the
  paper's current name" and nothing gave it — and `check()` flags `MASTHEAD`
  when the nameplate or `<title>` drifts from it. `dress.mjs` applies
  `reference/brands/<brand>/{brand.css,mark.svg}`; an unknown brand is refused.
  The Brainstorm brand's tokens, mark and rules come from
  `NosFabrica/Brainstorm-UI` (`docs/design-system.md`, `BrainLogo.tsx`), read
  2026-09-25. No file, no change: The Nostr Observer as before.

- **Reading through Brainstorm (2026-09-25).** `living.js` opens brainstorm.world
  links in a panel (an iframe; a FRESH iframe per page, because repointing one
  frame's src adds a joint-history step and Back then walks the frame instead
  of closing the panel). `#read=<path>` only ever names a path on
  brainstorm.world's origin, so a shared address cannot frame another site.
  Framing works because Brainstorm sends no `frame-ancestors` today — by
  omission, not decision; inside the frame the reader is signed out (storage
  partitioning), so zap/follow stay one click away in a real tab and are never
  faked on the page. `embed=1` is sent already for an embed mode that does not
  exist yet. The "since this edition" strip re-asks the corpus's own ranked
  filter (`filterFor`, from `until`) of the corpus relay, on load and every
  five minutes while visible. What Brainstorm would need to make this seamless
  is written up for its team in `BRAINSTORM-TEAM-REQUEST.md` (local).

- **Access and devices (2026-09-26).** Audited at 320, 375, 768, 1024 and
  1920 px, light and dark: no sideways scroll anywhere, 200% text zoom holds,
  the reader panel is a labelled modal that traps and returns focus. Fixed and
  held by tests: colour contrast is a rule (`test/contrast.test.mjs` checks
  every text token on its ground at 4.5:1, light and dark, brand and house;
  the brand teal went #287E89 → #267882 for 4.61 on the paper); the living
  copy opens with a skip link to a "Front page" heading that screen readers
  hear (and that keeps headings from jumping h1 → h3); the wordmark link is
  named; the browser toolbar takes the paper's colour (`theme-color`, light
  and dark, following the ostrich too). Reader settings on "Aa" by the date:
  text size 100/112/125/150% (the page is in rem, so the root scales it),
  high contrast (7:1 AAA tokens, links underlined; on by itself when the
  device asks for more contrast or forced colours), and motion on/reduced.
  `scripts/settings.mjs` (`readingSettings`) takes only known values and
  follows the device for anything not chosen; living.js carries it byte for
  byte and applies it before the first paint. No libraries: about 3 KB. On a
  phone the folio is two rows: the date, then the issue number and "Aa".

- **The Feature in two tabs (2026-09-26).** Both pieces arrive every day:
  the day's lead (the story on Sunday, the article otherwise) is what the
  writer heads and the printer sets; the other is `wires.featureAlt`, carried
  in the island as plain text (`feature.alt`: tab, kicker, title, byline,
  credit, https link, blocks) and swapped in by living.js with textContent
  only ("The Story · The Feature" on the kicker line). The story now changes
  on Sunday and holds through Saturday (weeks counted from Sunday, not the
  epoch's Thursday), so a weekday reader has "This Week's Story" a tab away.
  Switching from deep in a long piece brings its top back into view.

- **The Tape (2026-09-26).** A few share prices in The Wire, just before
  Conditions. `tape: true` gives the defaults (NVDA, AAPL, TSLA, MSTR: an AI
  maker, two household names, and the bitcoin-treasury company this network
  watches), or a list of up to six tickers. There is no openly licensed source
  of share prices; Yahoo's chart feed is free and keyless, fine for a paper on
  the reader's own machine, and the page says delayed, not live, not advice.
  Swap it for a licensed feed before the paper is ever published. The day's
  move is the last close against the one before (the feed's own "previous
  close" is the start of its five-day window). The page prints ticker, close
  and the percentage with ▲/▼ — points wrapped in a fifth of the page. The
  agate now sizes itself to four, five or six cells on a desk, so a day
  without classifieds leaves no empty column.

- **The Feature replaces the serial (2026-09-26).** Benjamin found a novel in
  204 slices a hard sell. `feature: true` prints one thoughtful piece a day,
  whole: on weekdays the newest article on The Conversation's technology feed
  that carries CC BY-ND in its `<rights>` (researchers writing for the public,
  meant to be republished whole and unedited; figures and the counter pixel
  are left out, text only); on Sundays a complete Philip K. Dick story from
  Project Gutenberg, public domain in the USA, one of eight checked for length
  (`SUNDAY_STORIES`, 2,500–8,700 words), a different one each week. The writer
  never types it: the digest gives the title, byline, word count and the exact
  credit, the writer leaves `<div class="feature-text"></div>` empty, and
  resolve.mjs sets the text word for word from the corpus (escaped; a story's
  Gutenberg `_italics_` become `<em>` and `--` a dash). That is both what a
  no-derivatives licence needs and cheaper than retyping 2,000 words. The
  serial still works for a paper that asks for it, and its `_italics_` now read
  as italics in the living copy.

- **Pictures open their post (2026-09-26).** dress marks every picture that
  came with a post the corpus holds (`data-ev`, from the art shortlist's
  `eventId`) and every wire picture with its own page (`data-href`: the xkcd
  strip by number, the Commons file page and the TheMealDB dish, both now kept
  by wires.mjs as `link` and never printed). living.js makes them focusable
  links: a post picture clicks the story's own "Read" link, so the panel,
  history and arrows behave alike (an article's cover opens it by address); a
  wire picture opens its page in a new tab; a modified click opens a new tab
  either way. The cartoon and recipe tabs keep `data-href` current. Pointer and
  a slight fade on hover; nothing drawn over the picture.

- **What's On replaces the Diary (2026-09-26).** The calendar desk already
  pulled dozens of meetups a day (73 on 2026-09-25), nearly all on other
  continents; the Diary printed three at random. `scripts/whatson.mjs` sorts
  them for the reader: upcoming within three weeks, each title-and-start once,
  then near (within 150 km of the weather wire's point, which now keeps its
  two-place `lat`/`lon`, or naming the town when there is no geohash), online
  (the location, or with none the title, says online/Jitsi/Zoom/a URL), and
  the rest nearest first. The digest prints a "What's On — near <town>" part
  with day and time in the reader's clock and distance in their units; the
  agate's fourth cell is "What's On": the next public holiday, then near,
  online, and one or two farther if there is room. Less is more: the other
  kinds measured that day (reposts, comments, web bookmarks, follow packs,
  statuses, P2P offers) were left out on purpose.

- **Long Reads (2026-09-26).** Every edition gets a slow shelf when the
  Long-form desk has two worth reading: `<section class="band longreads">`
  after the second front, three or four articles, one per author, people over
  news-republishing bots, none the front already carries. The digest gives
  each article its reading time (230 words a minute), its author's `summary`,
  and its cover by art id: an article's NIP-23 `image` tag, which the
  shortlist now reads, up to six on top of the 40-picture cap (they came last
  in desk order and never made it). The validator lets an article's own
  summary be quoted word for word (its tags only; a note's tags are not
  speech). Covers crop to 16:9; no cameo beside a Long Read.

- **Stop Press (2026-09-26).** The strip's drawer is edited like late news,
  not dealt out as cards: `scripts/press.mjs` (`pressText`, `headlineOf`,
  `stopPress`, copied into living.js byte for byte and tested) leaves out
  small talk (under five words), replies the page cannot place (an `e` tag not
  marked `mention`) and a trailing run of hashtags; keeps one line per person
  (their latest, "3 posts"); sets the wordiest as the lead with its first
  sentence as a headline (a long one is cut at a word and carries on beneath);
  and sets the rest as briefs in ruled columns with wire times, eight shown and
  the rest folded. The button counts stories that made the cut. The foot is
  plain brainstorm.world: the old "See everything" link opened a search of a
  dozen raw `from:npub` terms that Brainstorm printed in its search bar. The
  island's `since.seeAll` stays unused until Brainstorm gives a short link for
  a view (team request #8).

- **The page is set as a newspaper, not an app (2026-09-25).** Tried and
  taken out the same day, at the reader's request, as too distracting: a
  Three.js "voices constellation" behind the nameplate (then shrunk to a still
  plate in a boxed ear), boxed ears either side of the name, a "Voices of the
  day" list filling short columns, and stacks of faces on bylines. What stays:
  the nameplate alone between rules; ONE halftone cameo per story, floated
  into the paragraph that quotes that person (a newspaper's column cut, never
  a row of faces); justified, hyphenated columns; "Inside today"; pictures
  cropped 3:2 / 4:3; and for a branded paper a colophon of plain small print
  (`footer.html`, `{{name}}`, `{{mark}}`) as the last thing on the sheet.
  White space is the WRITER's to fix — the brief tells it to balance the
  columns — not something to paper over with generated boxes. No 3D engine is
  inlined any more; the living copy went from 1.1 MB to about 400 KB.

- **The wireless and the classifieds play inside the paper (2026-09-25).**
  `dress.mjs` tags links `validate.mjs` already accepted as a live stream or a
  listing (`data-stream` / `data-listing`) and carries their metadata in the
  island — https pictures only, and only an https `.m3u8` as a playable feed.
  `living.js` sets those rows as a period wireless programme and small ads
  (halftone stamp, small caps, dotted leaders to the price) and opens them in
  the reader panel as the paper's own sheets: `#read=stream:<id>` /
  `#read=listing:<id>`, walked by the same arrows. A station plays through
  hls.js 1.5.20 (`reference/vendor/hls.light.min.js`, Apache-2.0, ~297 KB),
  inlined as inert text ONLY when the page has a playable station and run only
  when the reader presses Tune in; leaving the station stops it. The zap.stream
  feed sends CORS for any origin (measured 2026-09-25). On-air marks and
  listener counts are re-read from the corpus relay once on load. A listing
  sheet offers ONE open-web link — the listing's own `r` tag, https only,
  from the structured tag and never from its text, shown with its hostname
  as "Buy at <host> ↗" — because a classified is an offer and the offer lives
  there. That is the deliberate exception to "no links to the open web", made
  at the reader's request on 2026-09-25, and it is in the living copy only,
  never in the checked edition. Credits for the wires are set ONCE, small —
  in the weather box (a licence condition) and one `note credits` line at
  the foot of the tinted band — not in every box.

- **From the Wires: pages from outside Nostr (2026-09-25).** `scripts/wires.mjs`
  `gatherWires(settings, { fetch, now })` fetches, on the reader's machine at
  print time, from `observer.config.json` (`place`, `teams`, `feeds`,
  `almanac`; the skill asks once and sets `wiresAsked`). Sources, all keyless,
  measured 2026-09-25: Open-Meteo geocoding + forecast (CC BY 4.0; the credit
  "Weather data by Open-Meteo.com" is a licence CONDITION; coordinates rounded
  to 2 places), TheSportsDB free key `123` (one last + one next event per team,
  and on the free key HOME matches only — a real gap; its terms call the free
  tier development use), Wikipedia `rest_v1/feed/onthisday` (CC BY-SA; the feed
  service is scheduled for gradual deprecation from July 2026 — it fails
  quietly), and RSS/Atom titles (AP and Reuters have no public feeds). Every
  source fails into a note, never into the paper. `digest()` prints them under
  "From the Wires" BELOW the data warning, marked as not the lens; `check()`
  lets a headline or almanac line be quoted word for word (each its own
  source, so elision cannot stitch one to a note). The brief tells the writer
  to set them apart and credit each. Tests: `test/wires.test.mjs` (fake
  network), plus digest / check / readPaper cases.

- **The construction (2026-09-25).** A front page fills positions from the
  top: lead (`lead-head`, centre), off-lead (`main-head`, top of the right
  column, own picture), rail (left: `small-head` briefs, pull quote, `box
  weather`), then `band seconds` (a `cols4` of `sub-head` stories, no
  heading), a `spread` of four figures (first largest), an `agate` of five
  cells, and `band tinted` for the wires. `check()` holds the first rule —
  exactly one `lead-head`, at most one `main-head`, on any page with a
  `.fold` (`LAYOUT`); a fragment or single-column edition is exempt, and the
  golden edition already obeys it. The DATELINE IS GONE from the brief: the
  reader found five stacked rules before any news. In its place `dress.mjs`
  PRINTS "Inside today" (`indexRow`: kickers' last segments and headed bands —
  not the seconds, which made it a contents page; ids `lv-section-N`) with a slot at the right that
  `living.js` fills with the since-count — so the index works on paper and
  without script. Live ages moved from the kicker to the byline.

- **The back page and the readings (2026-09-25).** Eight more wires, all
  keyless, all in `wires.mjs` behind switches in `observer.config.json`:
  xkcd (`cartoon`; CC BY-NC 2.5 — credit), a Project Gutenberg serial
  (`serial: <number>`; cut into ~550-word instalments at paragraph breaks,
  the day of the year since 2026-01-01 picks one, so no state), a sudoku made
  locally from the edition code (`puzzle`; `scripts/puzzle.mjs`, seeded, the
  solution rides in the island for the living copy, uniqueness not proved),
  markets (`markets`; mempool.space prices/fees/tip + ECB rates via
  api.frankfurter.dev, rounded to 4 places), the world (`world`; USGS 4.5+
  past day, Nager.Date next holiday for the weather's `country_code` or
  `country`), Wikimedia's featured picture (`picture`; any `*.wikimedia.org`
  thumbnail host — it moved off upload.wikimedia.org on 2026-09-25), TheMealDB
  (`recipe`; free key 1, source URL deliberately dropped), and air + moon
  (`sky`; Open-Meteo air on the US or European index by place, the moon from
  the synodic month counted from 2000-01-06 18:14 UTC). WIRE PICTURES JOIN
  THE ART SHORTLIST (`gatherWires(…, { nextArt })`, merged in `corpus.mjs`)
  so the writer cites ids and resolve/validate treat them as photographs; no
  URL reaches the digest. The serial, recipe method, cartoon caption and
  picture caption are quotable. The construction gained position 8, `band
  back` (`back-grid`: cartoon span-6, puzzle span-3, recipe span-3; `serial`
  across, three CSS columns); the writer prints the sudoku as nine lines in
  `pre.sudoku` and `living.js` draws the grid over it. Readings go into the
  agate's Conditions, the Diary, and the weather box. A feed may carry a
  `section` (`{ "url", "section": "Culture" }`; plain strings are Wider World),
  the digest groups headlines by it, and `culture: true` adds Wikipedia's
  most-read pages (`lookedUp`, Main Page filtered) from the same featured feed
  the picture uses. A feed titled "RSS: News" is credited to its outlet name.

- **The Tabloid, and the puzzles played (2026-09-25).** The reader asked for
  X / Facebook / TikTok / Instagram trends; measured that day, X's trends API
  is paid (401), Meta publishes none, TikTok's answers "no permission",
  YouTube's chart needs a key, Reddit blocks unsigned readers (403) — and
  scraping any of them would put a stranger's planting under the reader's
  masthead. What IS open and keyless: Google Trends' daily RSS
  (`trends.google.com/trending/rss?geo=`), Bluesky's
  `app.bsky.unspecced.getTrends` (topic, description, category, postCount,
  status — `cooling` is left out), Mastodon's trends (not taken up), Google
  News RSS (not taken up: overlaps the feeds). `tabloid: true`; the geo is the
  reader's `country`, else the weather's, else US. Position 8 of the
  construction, `band tabloid`, a black bar and a strap that says it is not
  the lens. PUZZLES: the sudoku's solution never reaches the page —
  `hashedPuzzle` ships sha-256 of `code:r:c:digit` per cell; the living copy
  checks by hashing, reveals a cell by trying nine. FIVE, the word of the day
  (`five: true`; `scripts/five.mjs`; answers in `reference/five-answers.txt`,
  ours; guesses in `five-guesses.txt`, web2 five-letter words, public
  domain), ships as hashes too: one per position, one per letter occurrence,
  so scoring handles repeats the Wordle way and a lost word is found by
  trying the answer list. Play is saved in localStorage per edition / day;
  stats (played, won, streak) likewise. WORD5 is otherstuff.ai's game, hence
  the name Five. The back page is two balanced rows (cartoon 8 + sudoku 4;
  Five 4 + recipe 8, method in two columns) because the first cut left the
  cartoon and puzzle columns half empty.

- **The paper on a phone and a tablet (2026-09-25).** Measured at 375 and
  768 before touching anything. Phone: the fold is typed rail-lead-rail, so
  one column read the Markets rail before the lead — `order` puts the lead
  first, the off-lead second, the rail last. The section bar wrapped into
  four rows; it is now one row the thumb slides (`.lv-sections`, a wrapper
  `indexRow` prints), sticky at the top because a 17,000px page needs its
  sections within reach, with `scroll-margin-top` on the targets. Hover
  cards are off under `(hover: none)`: no pointer to hover with, and a card
  parked off the right edge was widening the page. Every key on the plates
  is 44px tall under `(pointer: coarse)` — the Five keyboard's aspect ratio
  is dropped there or the keys widen past the screen. Tablet: house.css
  turns span-3 into span-6, which dropped the third fold column under the
  first with half the screen empty; between 721 and 1000px the lead takes
  the full width and the two rails sit beneath it, and the two puzzle plates
  share a row instead of each running the width at 80px a cell. PICTURES:
  `dress.mjs` marks the first picture `fetchpriority="high"` and every later
  one `loading="lazy" decoding="async"` (a phone was fetching a 4032px
  spread photograph to read the front); it never doubles an attribute the
  writer set. Reserved boxes come from the ratios in `living.css`, so no
  picture shifts the page as it arrives. Desktop was left alone: one-row
  bar, 3-6-3, no overflow at 1420.

- **Sharing Five (2026-09-25).** WORD5 (otherstuff.ai) is not used: Five is
  ours, modelled on it. WORD5 posts a kind-1 note tagged `#word5` and a
  kind-5555 score for leaderboards, loading nostr-tools from esm.sh and an
  analytics script from unpkg — none of which a dressed page may load. So:
  SHARE opens the system share sheet on a touch screen (`navigator.share`,
  a cancel is silent) and copies elsewhere. POST appears only when the
  browser has a NIP-07 signer; after the word is finished it asks the
  reader's extension to sign a kind-1 note — the grid and `#five`, never the
  word, never `#word5` (their word is not ours) — and sends it to the
  reader's own write relays (`getRelays`), else the paper's public three,
  never to `search-staging`. Only relays that answer OK true count; the note
  id is remembered per day so Post becomes "Posted" and opens the note on
  Brainstorm. It is the one thing the paper writes, and only on a click.
  `shareGrid`, `shareNote` and `publishNote` live in `five.mjs`, tested there
  with a fake socket; `living.js` carries copies that
  `five.test.mjs` holds to byte-for-byte equality.

- **The nameplate is flush left, with an ear (2026-09-25).** The reader
  found the centred stack generic. The name is set flush left and large,
  the motto under it; the folio the writer typed above the header becomes
  the ear on the right (date first and darkest, then the number, then the
  24h window) by a grid on `.sheet` — the edition's markup is not touched,
  so undressing still gives back the checked page. One heavy rule under
  both, the section bar's rule a hair below (thick-and-thin). On a phone
  the ear is a single line beneath the name and drops the window. The
  paper was renamed twice the same day, from "Across the Network": first
  to "Word of Mouth", then — the reader wanting a news source's feel and
  no talk of trust — to "The Morning Herald", then the reader's pick "The
  Daily Dispatch" ("The day’s news, front to back."), and at last **News
  and Other Stuff**, "The observer for your network." The nameplate is set
  `text-wrap: balance`, so on a phone it breaks "News and / Other Stuff". Mottos say what is in the paper, not how it is
  ranked; the ranking is the colophon's job.

- **The section bar slides at every width; no scroll bars are drawn
  (2026-09-25).** On a desk the bar was `overflow: hidden`, which clipped
  The Back Page and Weather out of reach. It is now one row that scrolls
  sideways everywhere; a fade marks the side with more (`lv-more-left` /
  `lv-more-right`, set by `sectionBar()` in living.js), and a vertical
  mouse wheel over it slides it until an end, then lets the page scroll.
  At the reader's request no scroll bar is drawn on the page, the bar, the
  panel, the drawer or the tables; all of them still scroll by wheel,
  trackpad, touch and keys.

- **The hover card has one quiet link, and it stays in the paper
  (2026-09-25).** It had a black pill button (open in the panel) and a blue
  link (leave for Brainstorm), and readers took the pill on a person's card
  for the story. Now: one left-aligned link in the accent, "Read post →" or
  "View profile →", that opens the reader panel. Brainstorm proper is one
  deliberate click further, in the panel's "Open full page to zap or
  follow ↗", or at once by modifier-click, since the link is a real link.
  The arrows mean what they say: → stays in the paper, ↗ leaves it.

- **The panel steps through stories; people get "In today's paper"
  (2026-09-25).** ‹ › walked every link — names, cameos, stations,
  listings — so "3 of 61" landed on profiles between stories. `dress.mjs`
  now bakes `sequence`: each cited post and article once, in the order the
  page first meets it (26 in the 13C931 edition), and each person carries
  `stories`, theirs in that order; both tested in `dress.test.mjs`. The
  arrows walk `sequence` only and hide on a profile, a station or a
  listing; a profile shows "In today's paper" with the person's stories to
  step into. NEW READERS get one note at the panel's foot — "You're reading
  Brainstorm inside your paper. To zap, follow or reply, open the full page
  ↗" — on their first three Brainstorm pages or until "Got it". On a phone
  it is the only way out to the full page, since the header's link is
  hidden there. RETURNING READERS: an opened story is remembered per
  edition on their device (`lv-read-<path>`), marked ✓ where the paper
  links it, and counted ("3 of 26 stories · 5 read"). SIGNED-IN state is
  NOT shown: the panel is a cross-origin frame with partitioned storage, so
  the paper cannot know it and a signed-in reader appears signed out inside
  it. That waits on Brainstorm's postMessage and requestStorageAccess
  (team request #4, #5); until then zap, follow and reply go through the
  full page.

- **The Diary opens on Brainstorm; kick-offs in the reader's time; the page
  closes its last gaps (2026-09-25).** brainstorm.world's `/a/<naddr>`
  renders calendar events (checked live on the Bitcoin Bologna meetup), so
  `toCalendarLink` is `toBrainstormCalendar` now; `CALENDAR_NADDR` still
  accepts an njump naddr so earlier editions validate. `dress.mjs` marks
  calendar links `data-ev`, so a Diary entry opens in the panel, gets a
  card, and joins the story sequence. KICK-OFFS: the weather wire keeps
  Open-Meteo's `timezone` (geocoder's as fallback) and the digest prints a
  kick-off in it — "Saturday, September 26, 7:30 p.m. CDT" for a US paper
  (°F), "Saturday 26 September, 17:00 BST" elsewhere, UTC only when there is
  no time zone; a late UTC kick-off is often the evening before at home.
  PHONE: the panel's way out stays in the header as "Full page ↗"
  (`.lv-out-short`); it was hidden there, so after "Got it" a phone reader
  had no door. GAPS: on a desk the back page runs as two columns, not two
  rows — the recipe rises under the cartoon, the sudoku and Five stack on
  the right, the recipe's square photo shown whole and its method in two
  columns (only when all four are present); the columns end 22px apart
  where the cartoon row had a 138px hole. "Looked up" moved from Culture to
  the Almanac, in the brief too, which brings the four wire cells within
  71px of each other instead of 150.

- **The panel feels instant (2026-09-25).** Measured: Brainstorm boots its
  whole app in every frame (1.5 MB of script, from cache after the first
  time — and the browser keeps a separate cache for a framed site, so the
  paper's first open downloads it even for a daily brainstorm.world user),
  then asks relays for the post, which lands ~400ms after the frame reports
  "loaded". The panel used to drop its loading line at "loaded", so the
  reader saw Brainstorm's empty chrome. Now: (1) the paper's own copy of the
  post or person — author, time, title, text — shows in the panel at once
  (measured 6ms) and the live page fades in 650ms after its load; (2) up to
  two frames load unseen — the page the hover card points at, and the next
  story in `sequence` — and are shown by swapping visibility, never moved
  (moving an iframe reloads it); › measured 11ms, hover-then-click 13ms,
  against 0.5–1s before; a waiting frame's first load adds no history, so
  Back still closes the panel; closing frees every frame; (3) preconnect to
  brainstorm.world and api.brainstorm.world on load. A `brainstorm:ready`
  postMessage from Brainstorm (a cousin of team request #4) would let the
  live page fade in the moment it has drawn instead of on a timer.

- **The paper keeps the reader's clock (2026-09-25).** With the weather's
  time zone known, the digest prints every time in it, labelled — the
  window, each post, the wires' fetch: "2026-09-24 11:09 p.m. CDT" for a US
  paper (12 hours), "2026-09-25 05:09 BST" elsewhere; UTC only when no zone
  is known. The brief already said reader-local times arrive converted and
  are printed as handed over; it now says so for bylines and prose too, and
  the Conditions stamp carries the folio's label. The living copy carries
  `clock: { timezone, hour12 }` for its own times ("since 11:09 p.m. CDT",
  the timestamps' tooltips). Diary entries keep the organiser's own zone,
  as the brief has always said. Converting 13C931 turned "In the half hour
  after 04:30 UTC" into 11:30 p.m. CDT the night before — the headline's
  "Before Breakfast" is Gigi's breakfast, in Europe, and was left as set.

- **A stamp beside the nameplate (2026-09-25).** `observer.config.json`
  `"stamp": "ostrich"` names `reference/stamps/ostrich.webp` (a name, never a
  path; an unknown stamp is refused like an unknown brand). The reader's
  engraved ostrich was cropped to the bird, set as the paper's ink
  (#0A0E18) on transparency with its tones kept, its cut neck faded into
  the page over the bottom third, and shrunk from 1.4 MB to 21 KB at
  194×240. `dress.mjs` inlines it as `--lv-stamp` in `<style
  id="living-stamp">` and marks `<html data-stamp>`; both undress away.
  First set as an 84×104 cut leading the ear — the reader found it
  overpowering beside the date, with dead space to its left. Three layouts
  were sketched (a device on a dateline strip, a seal in the ear, a mark by
  the motto) and the seal was chosen: a 46px double-ruled roundel showing
  the engraved head, centred on the three date lines and 14px before them,
  so it is one of the ear's parts, not a picture beside it; on a phone the
  same seal (40px) ends the nameplate. On a dark page the roundel keeps a
  pale ground so the ink still reads. Checked at 1519, 820 and 375. The
  seal was refused too (the ring, the placement), then a crest set in the
  nameplate between the halves of the name, like The Times's arms
  (`dress.mjs` wraps the middle word and a `.lv-crest` span, undressed
  away) — refused as well. The conclusion: the picture, not the place. A
  front-on portrait with a glossy eye reads as a smudge at 40–70px wherever
  it goes. The reader then supplied the right picture: a strict profile
  facing right, in engraving, with a ruled cut-off under the neck. It is
  set as a CUT before the nameplate, looking into the name — `dress.mjs`
  puts `<span class="lv-cut">` first in the header (the name's text is not
  touched; the crest code is gone), the masthead becomes a two-column grid,
  and living.js measures the cut to exactly the name and motto on a desk
  (101px at 1100, 113 at 1519, 125 at 768 where the name wraps) and to the
  name alone on a phone (70px), the motto running beneath both. The
  cut's width changes the text's width, so the sizing settles in at most
  four passes and stops. The file had a transparent background: composite
  onto white before reading its ink, or the crop takes the whole frame.
  298×280, 43 KB.

- **The header, settled (2026-09-25).** The reader wanted the name flush
  left and the ostrich at the far right, and a home for the date. On a
  desk (≥1001px) the cut stands at the right edge, mirrored so it looks
  back into the name, and the folio rides the motto's line — motto left,
  "FRIDAY, SEPTEMBER 25, 2026 · No. 13C931 · 24h to 11:09 p.m. CDT" right,
  on the same baseline (measured within half a pixel) and stopping 18px
  short of the cut (it reads `--lv-cut-h`, which living.js now sets on the
  sheet). The folio overlaps the header's grid cell rather than taking a
  column, so the name has the width. At 1000px and below there is no room
  on that line: the folio is its own ruled strip under the header, date
  left, number and window right; the phone drops the window. The brand's
  gradient hairline stays on the header, and on the strip only when the
  strip exists. Checked at 1519, 1020, 768 and 375. The reader then asked for
  the cut faded, old-timey and less distracting: it is printed in a warm,
  faded ink (#7A6F61 at .72, then a touch stronger at the reader's word: #675C4F at .86) through the stamp as a mask, not the stamp's
  own black — an old engraving on aged newsprint. Dark mode swaps the ink
  for #C9BFAF rather than inverting. FINALLY the folio moved to the top:
  the date on the motto's line read as misplaced, and both print (the
  folio line by the nameplate) and news homepages (the NYT's and the
  WSJ's date strip) open with it. It is one thin line above the header's
  rule at every width — date left and darkest, number and window right,
  the phone dropping the window — so nothing moves between a desk and a
  phone, and the motto has its line to itself. The brand's hairline is
  the header's alone. TWO STAMPS are bundled, so the reader can
  compare in one word: `ostrich-profile` (the engraved side view, 298×280)
  and `ostrich-portrait` (the first, front-on Grok picture, cropped with its
  neck faded, 223×280). `dress.mjs` reads each webp's width and height from
  its header (VP8X or VP8) and emits `--lv-stamp-ratio`, which the cut's
  aspect-ratio uses, so each is drawn at its true shape. Compared side by
  side in the header, the reader CHOSE THE PORTRAIT (softer, narrower, and
  it reads as a vignette rather than a logo). `ostrich-profile` stays
  bundled as the alternative.

- **A dark edition, switched by the ostrich (2026-09-25).** `readPaper`
  takes `stampDark` (a name, like `stamp`); `dress.mjs` inlines it as
  `--lv-stamp-dark` with `--lv-stamp-dark-ratio`, refuses an unknown one,
  and it undresses away (both tested). living.js runs `theme()` first: the
  reader's saved choice (`lv-theme`) wins, else their device setting (and
  follows it live until they choose); the edition's printed
  `data-theme="light"` is overwritten either way. The cut becomes a real
  button (role, tab stop, "Switch to the dark/light edition", Enter/Space),
  lifting 2px on hover. Light prints `ostrich-portrait` in faded ink; dark
  prints `ostrich-profile` in chalk (#D8CFC0), each at its own shape. The
  Brainstorm brand gets its night palette FROM BRAINSTORM-UI'S OWN `.dark`
  TOKENS (client/src/index.css and docs/design-system.md, staging,
  2026-09-25; HSL converted): Ink #0A0E18 ground, card #151C29, border
  #2A3441, foreground #F3F3F1, muted #A1A1AA, links #A78BFA, Aurora Cyan
  #13D2E5 unchanged for kickers ("the bright brand fills already pop on
  dark"), deeper shadows, `color-scheme: dark`. Their rule "on dark grounds
  don't use bg-brand-deep; use primary/15 + accent/25 border" sets the
  Tabloid bar; Five's near tile is the sanctioned cyan hover #287E89 and
  its miss tile the border colour, not off-palette hues. The warm chalk of
  the ostrich (#D8CFC0) is the paper's own, like its serifs. Its three fixed
  whites (boxes, cards, the tinted wire band) follow `--paper-2`. In dark:
  the Tabloid bar is not a white slab; the xkcd
  line art is inverted to chalk; Five's near/miss tiles use colours that
  hold white letters. BRAINSTORM ITSELF: its theme lives in its own
  `localStorage['brainstorm_theme']`, which the paper cannot set and which
  is partitioned in the frame, so the panel stays light unless the reader
  flips it there; every panel URL now carries `theme=` for team request #7.
  A dark reader may see a light flash on load: the paper's one script runs
  at the end of the page. Checked every band on a desk and the header on a
  phone, both editions.

- **The cartoon has tabs (2026-09-25).** Asked for "open-source cartoons,
  current events or tech culture". Checked licences: xkcd CC BY-NC 2.5
  (kept); Pepper&Carrot CC BY 4.0 (not topical, not taken up);
  CommitStrip has no clear licence (left out); nothing current AND open
  exists for editorial cartoons. So: today's xkcd (the writer's), FROM
  THE ARCHIVE — `wires.archive`, one Puck lithograph a day from the
  Library of Congress (`loc.gov/photos/?q=puck&dates=1877/1918`,
  keyless; published before 1929, so public domain; the day picks the
  page and item; later years and pictureless items skipped; tested) —
  and FROM YOUR NETWORK, comic- or meme-tagged posts with an https
  picture, credited to the poster and opening in the reader panel.
  `dress.mjs` assembles `cartoons` in that order (tested); living.js puts
  a quiet tab row on the Cartoon line (small caps, the showing one
  underlined in the accent, arrow keys) and swaps the picture and caption
  in a box held at the first cartoon's height, so nothing else moves. In
  the dark edition only the xkcd line art is inverted (`.lv-line-art`);
  the lithograph and network pictures keep their colours.

- **The Tabloid in step with the other bands (2026-09-25).** It opened
  with no space above its bar, butting the From the Wires band; it now
  has every band's 22px, and its slab centres the name and strap on one
  line on a desk and stacks them on a phone. Dark keeps the brand's deep
  purple.

- **The colophon leads with Brainstorm's wordmark (2026-09-25).** The
  reader asked for Brainstorm to lead the footer, in its own lettering.
  Brainstorm-UI's handwritten gradient wordmark (client/public/brand/
  wordmark.svg, 328×73; its design system calls it "the default brand
  signature" and it reads on light and dark) is bundled as
  `brands/brainstorm/wordmark.svg`, its gradient id namespaced; dress
  fills `{{wordmark}}` and refuses one with script (tested). The footer:
  the wordmark as the subject — "[Brainstorm] prints News and Other Stuff
  each morning…" — beside "Your network has news too" and one button in
  Brainstorm's style (Aurora Purple, white Figtree, 0.75rem radius) to
  brainstorm.world/login; small print beneath. On a phone it stacks and
  the button runs the width. THE PUBLISHER'S IMPRINT: `observer.config.json`
  `"imprint": {name, url, logo}` (https address, logo a name in
  `reference/imprints/`; all three or none, tested) puts the publisher's
  mark first on the colophon's small-print line via `{{imprint}}`, linked
  to their site in a new tab (tested). For this paper: Megistus's icon —
  the meditating figure under the star-and-circuit halo, without the word
  (the word version read as a smudge at 20–28px, and the reader asked for
  the mark alone) — drawn as a mask in the page's secondary ink so it reads
  in light and dark, no divider, and set IN the line like a glyph (1.45em,
  about 14px, on the baseline) rather than a 28px block centred beside it.
  THE B ON THE ISSUE: the Brainstorm B mark opens the folio's issue number
  between "No." and the digits ("No. B 13C931", Benjamin's call), in its own
  gradient at the folio's cap height, a little muted, with air either side so
  it reads as the printer's device. A pseudo-element cannot reach the middle
  of the writer's span, so dress sets an empty `lv-issue-mark` link there,
  to brainstorm.world in a new tab like the colophon's wordmark (2026-09-26);
  brand-only, and it undresses away. Every link that leaves the paper opens in
  a new tab; only stories, people, stations and listings open in the panel.
- RECIPE TABS, HEALTH & SAFETY, LAUNCHES (2026-09-25): three more keyless
  wires. Recipe: beside the dish of the day, a vegetarian dish and something
  sweet from TheMealDB's categories, picked by the day index so they hold all
  day; the writer prints only the dish of the day, dress carries the others
  as plain text (`recipes` in the island, https pictures and links only), and
  living.js swaps them into the same box under Today · Vegetarian · Something
  sweet, holding at least Today's height. Health & Safety (`health: true`,
  needs a place): the UV peak and its hours (Open-Meteo); for a US place the
  NWS's active alerts, Class I food recalls of the past two weeks (openFDA)
  and CPSC product recalls. Facts to act on, never advice; a quiet day says
  "No weather alerts in force." The box goes at the foot of whichever front
  column runs shortest (under the lead, its two lists side by side, when the
  rail is already long). Launches (`launches: true`): the next two from The
  Space Devs' Launch Library 2, as the last rows of Conditions, in the
  reader's clock. Pollen was left out: no keyless US source.

### The public shelf (`.claude/skills/observer-pages/`)

A second skill, and a second folder, because printing and publishing are
different decisions and only one of them is the reader's to make twice.

- **`editions/` is private, `dist/` is public.** Every run of the print skill
  writes its paper, `corpus.json`, `digest.md` and `readiness.json` into
  `editions/`. Both are gitignored. The corpus is the reader's whole ranked
  window — who they follow, what those people said — and it has no business on
  a static host. Keeping the run's output and the published shelf in one folder
  meant the only thing standing between the corpus and the open web was the
  deploy command's argument, which is not a boundary.

- **`site.mjs check` is that boundary, and it runs before Vercel sees the
  folder.** Anything in `dist/` that is not an edition or site furniture is a
  non-zero exit. There is no `--force` worth using.

- **Named editions only.** The skill refuses to publish a paper the reader did
  not name. `editions/` is an archive, not a queue; two papers on one day is
  normal, and choosing between them is the entire point of the skill.

- **CLI only, and it asks for help rather than routing around a failure.** One
  `npx vercel deploy` from the agent shell. If that fails — proxy, DNS, token,
  an approval block — the skill stops and hands the reader the exact command.
  No MCP deploy, no second attempt through another tool, no alternate host: a
  deploy path that reroutes itself is a deploy path nobody can audit.

- **No Git-connected Vercel project.** A git link would deploy the source tree,
  which contains neither the editions nor any intention of being a website.


### Audit, 2026-09-21

The desk-link work ported from the fork, read the way the 2026-08-22 audit read
the boundary. Two halves disagreeing, twice, and one cost nobody had measured.

- **`resolve.mjs` was quadratic, and most of the work was for links it had
  already decided not to touch.** Each of the six target helpers opened with a
  full pass over the corpus — `Object.values(corpus.desks).flat()`, then a
  filter — and only then tested its own regex, so asking "is this a zap.stream
  address?" about an ordinary paragraph link cost a scan of every desk.
  `resolve` asks all six about every anchor. Measured on a busy window (4,800
  ranked events, 528 anchors, a 102 KB page): **585 ms, about 440 ms of it
  scans for URLs that never matched**. The regex now runs first, and the three
  lists are indexed once per corpus and keyed on the object — with a
  `kind:pubkey:d` map, because a linear `find` over every stream is the same
  mistake one level down. **585 ms → 27 ms**, and linear rather than quadratic;
  `check()` on a page of open-web links, 209 ms → 18 ms. `resolve` also built
  its own second set of corpus maps, which is both the same work twice and a
  chance for the two to disagree about what counts as linkable; it uses the
  shared index now.

- **The unwrap step lowercased the whole document, once per anchor.** Finding
  `</a>` was `out.toLowerCase().indexOf('</a>', anchor.end)` — 54 MB of copies
  nobody reads twice, on that same 102 KB page. A sticky case-insensitive
  search costs nothing and also accepts `</a >`, which the literal missed.

- **`validate.mjs` accepted a frozen calendar citation that `Validator.kt`
  refuses.** A jumble nevent naming a 31922/31923 listing passed the skill's
  boundary: the event is in the corpus and the citation is well formed, but an
  nevent freezes ONE revision of an event whose whole nature is to be replaced,
  so the reader clicks through to a meetup whose time has since moved. The
  Kotlin has had `id !in calendarIds` since the desk landed. `resolve.mjs`
  rewrites these correctly, so nothing shipped — but that is exactly the
  argument that let the `nevent1`-capturing-nothing bug live, and a guard whose
  only job is to catch a regression in the step before it has to be present to
  do it.

- **And the same rule failed the other way round in the Kotlin.** The brief
  tells the writer to cite sources with njump permalinks, and njump's canonical
  form is an nevent. Point one at a calendar listing — the natural thing to
  write — and `Sanitizer` kept it (no njump-hex match, so it fell through to
  the permalink keep) while `Validator` refused it. The edition was **thrown
  away rather than repaired**: a boundary that rejects good pages prints
  nothing that morning, which is the failure the golden edition exists to
  catch. The sanitizer now encodes a cited calendar id to its address, as
  `resolve.mjs` always has.

- **The shelf's link-preview tags were stripped by line, so stamping was not
  idempotent.** `stripSocialMeta` anchored to `^…$`, which only matches a tag
  that owns its line. A paper whose writer put them inline kept the stale set,
  `add` inserted a fresh one, and the page went to press carrying two `og:url`
  values — one of them the `observer.invalid` placeholder every freshly printed
  edition is born with, which is a dead hostname in the preview of a shared
  paper. Dropping the anchors and keeping `[^>]*` would have been the
  2026-08-22 bug again (`content="Signal > Noise"` cuts its own tag in half and
  corrupts the document), so `site.mjs` got the scanner treatment `html.mjs`
  already gives the boundary. Copied rather than imported: the shelf is
  documented as standing on its own, and a skill that breaks when its neighbour
  is not installed is not standing on anything.


### Audit, 2026-08-22

Five bugs, three of them one root cause, plus the two costs nobody had measured.

- **A `>` inside any attribute value made the boundary FAIL OPEN.** Element
  lookup was `<img\b[^>]*?\bsrc=…`, and `[^>]*?` ends at the first `>` wherever
  it is — so `<img alt="a > b" src="https://evil.example/x.jpg">` was never
  matched and never checked, and `<a title="1 > 2" href="…">` slipped the link
  rule the same way. Captions come from the corpus, and the corpus is where the
  attacker writes. `resolve.mjs` was blind in the same place, so an id inside
  such a tag shipped as a literal `src="art-3"` that validate could not see
  either. All three now go through `html.mjs`, a scanner that tracks quoting.
  A regex cannot do this: knowing where a tag ends means knowing whether you
  are inside a quoted value.

- **`/\son[a-z]+\s*=/` over the raw document read prose as an attack.** "we ran
  it once=twice" and "the flag is only=set" both tripped it. That fails CLOSED,
  so it is the golden edition's failure mode — a boundary that rejects good
  pages prints nothing every morning — and it walked past the golden test only
  because the fixture happens to contain no such phrase. Markup checks now run
  against parsed tags and attribute names. Two holes closed on the way past:
  `<base href>` rewrites every relative URL on the page and `<meta refresh>`
  redirects it, and neither was refused.

- **The REQ budget counted characters where the relay counts bytes.** A filter
  up to twice `max_message_length` passed the guard and was then dropped in
  silence — precisely the failure the guard exists to prevent. `Buffer.byteLength`.

- **One socket per read.** Six for the readiness chain, sixteen for a corpus
  pull, each a fresh handshake to a host this file says not to hammer, and
  which advertises a subscription limit of fifty. `nostr.mjs` now pools one
  connection per relay and multiplexes subscriptions over it, as `Relays.kt`
  does with quartz's single `NostrClient`; it closes on an unref'd linger so
  consecutive reads reuse it and an idle process still exits. The fake relay
  counts connections so the rule stays true. Readiness also stopped fetching
  the 10002 and the 10040 one after the other — they are independent — and the
  storage chain rides along instead of costing a seventh round trip. Measured
  after: readiness 0.8s, a full fifteen-desk corpus pull 3.0s.

- **The digest was unbounded, and the reader pays for it.** Measured on a
  realistic busy window it came to 335,000 characters — about 84,000 tokens —
  before the writer had done anything, most of it long-form excerpted at the
  same length as a one-line note. Now per-desk excerpt lengths and a 200,000
  character budget, which lands a busy day at ~50,000 tokens and leaves a quiet
  day untouched. Trimming has a floor per desk, because trimming purely by size
  cut the notes to 64 of 400 to protect a long-form column nobody asked for —
  the budget making an editorial decision, which is not its job. **Whatever
  comes off is named in the digest**: a digest that quietly drops half the
  long-form reads as a quiet day for long-form, and a thin honest paper is
  supposed to mean one.

### First real edition, 2026-08-22

The chain passed for the first time, against the key in `Fixtures.OBSERVER`, and
`system-prompt.md` met a model. Readiness green on all four links; 671 events
across 13 desks in 3.0s; 247 voices; **overlap 0 of 400**. The boundary came
back clean on the first pass — 21 quotes verbatim, 3 art ids resolved, nothing
dropped or unwrapped. Edition D8C3EA.

Three things the run found that no test could:

- **Banning `<meta>` outright rejects every real page.** The audit added it to
  stop `<meta http-equiv="refresh">` and took `charset` and `viewport` with it.
  Narrowed to the http-equiv form. The golden fixture is a body fragment, so it
  has no `<head>` and could never have caught this — the same false-positive
  class as the prose that read as an event handler, found the same way, by
  running the thing rather than testing it.

- **The Node digest drops structured fields the brief depends on.** `Digest.kt`
  emits `PRICE`/`STATUS` for classifieds, `WHEN`/`LOCATION` for calendar, and
  `AUTHOR`/`SOURCE`/`CONTEXT` for highlights; `corpus.mjs` emits title and
  content only. They were recoverable from the raw tags in `corpus.json` by
  hand, but unaided this prints a shop column with no prices — "everything
  except the news" — and invites attributing a highlight excerpt to the
  highlighter, which the brief forbids outright. Highest-value next fix.

- **No reader timezone, and no denominator.** The brief says never print UTC and
  never convert a time yourself; the digest carries only UTC, so the dateline's
  date is a judgement rather than something handed over. And with no COUNT there
  is no honest `N of M`, so the middle span read "671 events through your lens"
  instead. Both are the cost of the no-COUNT rule and the thin digest, and both
  are visible on the furniture of every edition.

### Alt text is the fabrication channel nothing guards

Reviewing why the first edition's photographs did not appear, 2026-08-22. Three
findings, and the interesting one is not the images.

- **The markup and the URLs were correct.** All three resolved to live hosts,
  HTTP 200, right content-types, two of them serving `access-control-allow-origin: *`.
  The artifact viewer runs a content policy that refuses every external host, so
  the pictures never load there however good the URL is. Not a bug and not
  fixable from inside the page; the saved local file shows them fine.

- **`imeta alt` is a fiction in the wild: 0 of 40 shortlisted pictures carried
  one.** `Art.kt` keeps `alt` on the theory that it is "the difference between a
  missing image degrading to a caption and degrading to a gap". That only works
  if somebody writes it, and on a real 24-hour window nobody did. So the writer
  has to author the alt, and `SKILL.md` never asked it to — the first edition
  shipped three bare `<img>` tags and degraded to three empty boxes, which is
  precisely the outcome the alt rule exists to prevent.

- **THE REAL ONE: nothing checks captions or alt.** `Validator` gates quotes,
  picture sources and links. A caption is prose about a photograph the writer has
  never seen, published under a real person's byline, through the only channel in
  the pipeline with no gate on it. Two of the first edition's three captions
  asserted things not in evidence — one described the contents of a frame, the
  other said a picture was taken close up when the post said you would have to
  zoom in to see anything. Both were caught by reading, which does not scale.
  `SKILL.md` now forbids describing a picture you cannot see and requires caption
  and alt to be derived from the post. **A mechanical check is still missing**,
  and it is a harder problem than the quote rule: there is no source text to
  compare a caption against, only the post it came from.

## The publish path (Phase 3)

- **The server holds no key and can sign nothing.** It builds the two events a
  publish needs (`24242` upload auth, `35128` manifest), hands them to a signer,
  and checks what comes back with `Countersign` — same author, same tags, valid
  signature. Building the template server-side is what makes that check possible
  at all; a flow that just relays whatever the client invented has nothing to
  compare against.
- **`kind 35128` replaces — which is why each edition is its own site.** A `d`
  of `observer-<date>` means a new day replaces nothing, so no publish has to
  first read the archive and merge into it. That hazard (a read that came back
  empty for the wrong reason deleting the back catalogue) is gone along with the
  canary and the fail-closed refusal it needed.
- **The manifest goes out only after a Blossom server has the blob.** A manifest
  pointing at a hash nobody stores is a 404 with a signature on it.
- **NIP-46 runs on the server, NIP-07 in the browser.** A browser NIP-46 client
  needs secp256k1 ECDH, which WebCrypto does not have; and mobile browsers drop
  websockets when the tab is backgrounded, which is exactly when the reader is
  in their signer app. A server-held connection does not get backgrounded, and
  it is what Phase 4's scheduled runs need anyway. The cost is stated in
  `Bunkers`: while a session is open, this process can ask the reader's signer
  to sign the three kinds it asked permission for.
- **`Nip98AuthVerifier.verify` takes `(header, METHOD, URL, body)`.** All four
  are `String`s, so swapping the middle two compiles and fails at runtime with
  "method mismatch: expected http://.../api/session, got POST". It fails closed;
  a test caught it.
- **An empty `kind 10063` is a hard stop, not a default.** Substituting a server
  of our own would make us the host of a page whose whole promise is that the
  reader hosts it.
- **Half the Blossom servers a reader is likely to list will not host HTML**,
  and that is policy rather than a bug: HTML served from their domain is script
  on their domain. Measured 2026-08-18 with a throwaway key, uploading a real
  36 KB edition (`./gradlew :server:blossomProbe`):

  | server | answer |
  | --- | --- |
  | `blossom.primal.net` | 200, and the URL comes back with `.html` on the end |
  | `nostr.download` | 201 |
  | `nostr.build`, `blossom.band` | 415 `File type not allowed` — same backend, same refusal |
  | `blossom.f7z.io` | 401 `Pubkey not authorized by any storage rule` |
  | `cdn.satellite.earth` | no answer inside 60s |

  `nostr.build` answers `text/html` with a 400 whose sentence is nonsense
  ("expected application/json"); send `application/octet-stream` and it gives
  the honest 415. Both arrive in `X-Reason`, which is why that header is read.
- **The archive is read from the reader's relays and nowhere else.** It used to
  ask `hosts.take(3) + searchRelay`, which was wrong twice: an edition could be
  listed because OUR relay resolves it while theirs do not — "resolves for us
  and for nobody else", dressed as a working feature — and a publish goes to
  every write relay while the read looked at three, so an edition that landed
  on the fourth was invisible. `ReadinessProbe.blossomServers` still asks ours
  as well, deliberately: that read only decides where to try uploading, and a
  wrong answer there fails loudly at the upload rather than misleading anybody.
- **A refused upload destroys something, and the console says so.** The page is
  written, checked and paid for, and it lives in `Runs` memory and nowhere
  else. So that path sets the run `FAILED` (leaving it `SIGNING` meant the next
  poll asked the reader's signer for two more signatures for a publish that
  cannot happen), answers with `Lost` rather than a one-line `Problem`, and
  offers the bytes at `GET /api/editions/{id}/page` for as long as the sweep
  leaves them. Served `application/octet-stream` as an attachment, never
  `text/html`: this origin holds the session cookie, and an edition is markup a
  model wrote. `GET /api/editions/current` exists only so a reload finds that
  offer again.
- **An edition is READ at `/view`, and the `sandbox` in its CSP is what makes
  that allowable.** `/page` still hands the bytes over as a download and has not
  changed; `/view` serves the same bytes as `text/html`, because a reader has to
  be able to look at their paper — and an edition that failed its own checks
  will never be published, so nowhere else will ever hold it. The rule above is
  not repealed, it is met a different way: `Content-Security-Policy: sandbox`
  as a *response header* puts the document in an opaque origin however it is
  reached, framed or navigated to directly, so the session cookie is unreachable
  from it. `allow-scripts` and `allow-same-origin` must never both appear —
  together they let a page remove its own sandbox. The rest of the header
  (`default-src 'none'`, `img-src https: data:`) restricts what the page may
  load and would not, on its own, have been enough.
- **Blossom is a blob store, and linking a reader at `server/hash` is not a
  view.** It hands back bytes with whatever `Content-Type` it likes, so the same
  link renders on `blossom.primal.net` and downloads elsewhere — which is what
  the archive's "Read it" did. An nsite is resolved by something that reads the
  manifest and serves the blob AS a site; `GET /api/archive/{day}/view` is that,
  for one signed-in reader's own editions. `Blossom.fetch` tries their servers in
  order (a read needs one copy; only a publish needs all of them) and **checks
  the blob against the hash in the manifest the reader signed** before serving a
  byte of it. A server that answers with something else is refused outright, not
  passed over quietly — it is either broken or lying and both are worth saying.
  Nothing is stored here; the canonical copy stays on their servers.
- **`blossom.primal.net` appends `.html` to the URL it returns.** Concrete proof
  that `server + "/" + hash` was a guess: the hash alone also resolves there
  today, but nothing requires it to. Take the URL from the descriptor.
- **The archive cannot take it from the descriptor, so it does not offer one at
  all.** A manifest names servers and a hash; the descriptor was a response to a
  request made on a different day and we deliberately store nothing. `Past` used
  to carry `servers.first() + "/" + hash` assembled in the route — the same
  guess, one layer along, on the side where there is no descriptor to correct it
  with. It is gone: `/api/archive/{day}/view` reads the edition properly and a
  guessed link had nothing left to do. `Blossom.fetch` builds that same string to
  FETCH with, which is fine and is not the same thing — it checks the bytes
  against the signed hash, moves to the next server on failure, and reports which
  ones failed. A guess that catches itself is not a guess handed to a reader.
- **The whole path has been run against the real network**, once, end to end:
  `./gradlew :server:liveRun`. It mints a throwaway key, publishes its `10002`
  and `10063`, then goes through `writeRelaysOf` -> `servers` -> upload ->
  `Countersign` -> `Announce.publish` -> `editions` and checks that the archive
  names the page that was uploaded. It is a `main()` in the test source set with
  no `@Test`, because it writes to other people's machines.

## Found by audit (2026-08-18) — do not reintroduce

- **Never rebuild our own URL from request headers.** Sign-in compares a NIP-98
  signature's `u` tag against the URL of the request. That check was made
  against `Host` / `X-Forwarded-Host`, both of which the caller chooses: any
  site can ask a visitor to sign an event for a URL it controls and replay it
  here with a matching header to be signed in as them. It is now
  `Config.publicUrl`, and two tests hold it shut. **A deployment MUST set
  `OBSERVER_PUBLIC_URL`** or every sign-in is rejected.
- **The two halves of the link rule must agree.** The permalink regex allowed
  `nevent1…` in a branch that captured nothing, so `groupValues[1]` was empty
  for every real citation. The sanitizer kept those links and the validator
  rejected them — and a validator failure throws away the entire edition. njump
  citations are decoded through quartz's NIP-19 parser now, and the sanitizer
  takes the corpus so an unknown citation loses one link instead of the paper.
- **Check-then-act on a shared map is a race.** Two clicks on the generate
  button started two editions and two model bills. `ConcurrentHashMap.compute`,
  with a test that fails on the old code.
- **A TTL enforced only on access is a leak.** Drafts, sessions and pending
  templates all expired only when something happened to touch them. A timer
  sweeps them now, which also took a per-poll `DELETE` off the read path.
- **One `Writer` per edition leaked an HTTP client** (connection pool and
  threads) for the life of the process. It is one per `Press` now.
- **The archive is not ours alone.** The manifest is rebuilt from the reader's
  own kind 35128 merged with our index, so losing our database — or moving them
  to another deployment — no longer silently deletes every earlier edition on
  the next publish.

## Highlights are somebody else's words (2026-08-18)

A `kind 9802` highlight's content is a verbatim excerpt of another person's
writing. The digest rendered it exactly like a post — byline of the
highlighter, no source, no author — so a model reading it writes *"Gigi wrote:
…"* when Gigi only marked the passage. A real quote, under the wrong name,
signed by the reader.

**The validator cannot catch this.** It checks that quoted text appears
verbatim in a source event, and it does — in the highlight. Text fidelity and
correct attribution are different properties, and only the first was ever
checked. Anywhere the corpus carries one person's words under another person's
signature, the same hole opens.

Measured over 31 highlights in one window: 11 carry a `p` naming the author, 20
an `r` source URL, 7 an `a` long-form address, 18 a `context` with the
surrounding passage. All of it was being discarded. The digest now prints
`HIGHLIGHTED BY`, an explicit EXCERPT warning, `AUTHOR` (resolved to a name, or
"not named" — silence invites the writer to fall back on the byline), `SOURCE`
and `CONTEXT` marked as unquotable. Quoted authors are added to the profile
fetch, since they signed nothing in the window and would otherwise be hex.

## Content added 2026-08-18

- **`30311` live, and only while live.** Replaceable events keep the record of a
  finished stream in the window: 11 `live` against 7 `ended` in one measured
  day. `Desk.keeps` drops the ended ones. "Now" means generation time — the page
  is static, so the prompt tells the writer to say when a stream started rather
  than promise it is still running.
- **`1068` polls.** Options arrive as `["option", id, label]` in two id shapes
  (`"0"` and `"Bu2a9f"`), so the label is always the second field.
- **`30617` git repositories.** Uses `name`/`description` where everything else
  uses `title`/`summary`.
- **`31922` joined the calendar desk** — the all-day half of NIP-52 to 31923's
  timed half. Zero in the measured window, which is how the gap stayed
  invisible.
- **Rejected with numbers:** `1111` comments are the biggest untapped pool by
  people (266 events, 124 authors) but only 15 of 263 point at anything in our
  corpus, so a desk of them is context-free replies. `9735` zap receipts are the
  highest-volume unread kind (407) and are a SIGNAL, not a desk — 22 of 580
  corpus events were zapped in-window, top post 5 times.

## Video (2026-08-18)

- **The current NIP-71 kinds are empty; the deprecated ones carry the video.**
  Measured through the prototype observer, one 24-hour window at floor 20:
  `kind 21` → 0, `kind 22` → 0, `kind 34235` → 6 from 5 authors, `kind 34236` →
  37 from 13. A desk asks for both. This is the mirror of the nsite decision,
  where the CURRENT kind was right — so check, do not assume.
- **A desk may span several kinds now**, which is only safe because each desk is
  one REQ. While they shared a REQ, results were recovered by kind and two desks
  claiming one kind collided — that was the bug that filed the control run as
  news.
- **A video's poster is `imeta`'s `image` field, and it is never sniffed.**
  Every real one measured was extension-less (`media.divine.video/7f4e79…`), so
  an `isImage` check rejected six of seven. `m` describes the video and says
  nothing about the poster, and one real 34235 had a poster and no `m` at all —
  so the event's KIND decides. About one video in six carries a poster; the rest
  are text stories, which is fine.
- **Art slots are allocated per desk first, then by rank.** One pass in corpus
  order gave all forty to notes and pictures, so a video poster could not reach
  the page however good it was. Each desk takes up to four, then rank order
  fills the rest.

## Found by audit (2026-08-19), third pass

- **Playwright is not concurrent, and `Proof` is a singleton.** `Press` holds one
  browser and the server holds one `Press`, so two readers printing at the same
  moment rendered through the same instance. Measured with four threads: one
  succeeded, three threw `Object doesn't exist: tracing@…` and
  `Cannot find object to call __adopt__: browser-context@…`. On the server that
  landed in the catch-all in `Editions.run`, so the second reader lost an
  edition the model had already been paid for. Every call now queues on one
  owning thread, and `check` degrades to `ran = false` rather than throwing —
  by the time it runs the money is spent, so a browser problem must not also
  cost the paper. `ProofConcurrencyTest` holds the line.
- **An expired session left its remote signer connected forever.** `Sessions`
  keys on the SHA-256 of a token, deliberately; `Bunkers` keyed on the raw
  cookie. So the two maps had no name in common, the sweeper could not close
  what it expired, and a live subscription to the reader's signer outlived its
  session for the life of the process — with a map of working cookies next door
  to the one that carefully holds none. Both key on `Sessions.fingerprint` now
  and `sweep()` returns those keys so housekeeping can close them.
- **`removals` grew without bound on authenticated input.** It was keyed by
  reader AND day, with a comment saying a sweep would cost more than the leak.
  True of anybody using it; not true of anybody looping, since
  `/api/archive/{day}/remove` takes any well-formed date and nothing removed an
  entry that was never signed. One per reader now, and swept.
- **`/api/readiness` fetched the reader's entire archive to pick a word.** It
  ran `announce.editions` — a fan-out across every one of their relays, pulling
  every site event they have ever published — to choose between "has published
  before" and "asked at publish" on one link of a chain inside a closed
  `<details>`. Both branches of `Readiness.storage` return the identical
  verdict, and the console asks `/api/archive` moments later, which ran the same
  query again. Removed. `nameOf` and `storage` on that route also ran one after
  the other against the same hosts; they are concurrent now.
- **`blossomServers` asks three of their relays; `editions` asks all of them.**
  Same-looking code, opposite requirement, so it is written down in both: a
  `kind 10063` is replaceable and every relay has the same one, while an archive
  is a union and any relay may hold the only copy of a day.

## Found by audit (2026-08-18), second pass

- **`until` never reached a filter.** It was threaded from the CLI into `Corpus`
  and read by nothing, so a window had a start and no end: `--until` backdating
  asked for "the 24 hours ending last Tuesday" and got everything from last
  Monday to now. Latent on the server, which always passes the present. Both
  ends are in the filters now, verified by a backdated run whose events all fall
  inside the requested day.

## Quartz behaviours worth knowing here

- **`decodePublicKeyAsHexOrNull` decodes an nsec.** Measured: it returns the
  hex of the SECRET key rather than null, because the payload is 32 bytes and
  that is all it checks. `Main.kt` refuses an `nsec1` prefix *before* calling
  it, or a reader who pastes the wrong key has it put into a relay filter and
  sent over the wire. There is a test that pins this.
- **`AdvertisedRelayListEvent.writeRelays()` does not vet schemes.** It returns
  what the tag said, `https://` entries included. `ReadinessProbe` keeps a
  `wss://`/`ws://` filter over its output.
- **`fetchAll` merges the filters.** The hand-rolled client returned one list
  per filter; quartz returns one list. Desks are recovered by kind, which is
  why the anonymous control run is a separate call — it is kind 1 like the
  notes desk, and merged in it would file spam as news. The overlap number the
  CLI prints is the alarm for that: it belongs near zero.
- **Quartz is Kotlin Multiplatform with Android in its graph.** It pulls
  `androidx.sqlite`, published only to Google's Maven, so `settings.gradle.kts`
  needs `google()`. Without it the failure names the missing AndroidX artifact
  and not the reason, which reads like a broken JitPack pin.

## Not settled

The open questions live at the end of `docs/PLAN.md`. The one that gates the
timeline is whether `nip85.nosfabrica.com` can onboard new observers on demand.

## Conventions

Mirror vespa-relay: Kotlin, Gradle version catalog, spotless + ktlint, git hooks
that run `spotlessCheck` pre-commit and tests pre-push. Run `spotlessApply`
before committing or the hook will reject you on formatting alone.

Comments explain *why*, and especially why-not — a comment that restates the code
is noise, a comment recording the thing that cost a day is the point. Stacked
KDoc fails ktlint.

### Numbers in this repo

Every measurement in the plan is a reading taken against a live, moving system on
a stated date. Treat them as evidence, not constants. Re-measure before relying
on one, and when you do, write the new date next to it.

### The relay is shared

`search-staging.brainstorm.world` is a real relay other people read. Read from it;
do not publish test events to it and do not hammer it. This service needs its own
Vespa deployment before it serves anyone.

## Prior art

The reference implementation is a prototype front page built by hand against the
live relay — 773 events across nine kinds, 244 profiles, ranked through one
observer, plus an anonymous control run that turned out to be 52% spam from a
single account. That contrast is the product thesis; keep it on the page.
