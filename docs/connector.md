# The Brainstorm Observer connector: handoff

For the Brainstorm team and Vitor. This is what is built, how to run it, what
Brainstorm needs to plug in to host it, and what is still open.

## In one paragraph

Each reader's own Claude prints their daily paper. Brainstorm hosts a small MCP
connector. The reader adds it to their Claude once and signs in with Nostr.
Every morning their Claude:
1. checks the reader's trust network;
2. reads the reader's paper settings and the last 24 hours ranked through their
   web of trust;
3. writes the front page;
4. hands the page back.

The connector checks every quote, picture and link against the posts, exactly
as the command-line printer does, and keeps the accepted paper for the reader's
Observer page. The model work runs on the reader's Claude plan, not on
Brainstorm's account.

## The reader's journey

1. **Set up (`/setup`).**
   - Three questions: where are you (city or ZIP), teams, favourite topics.
     Everything else is included by default.
   - Save, and the paper is founded that day (Vol. I · No. 1).
2. **Connect Claude.**
   - **Claude app:** "Add to Claude" opens Claude's add-connector dialog.
     Claude opens Brainstorm's sign-in, and the reader signs one NIP-98 event.
   - **Claude Code:** one command.
3. **Schedule.**
   - A one-line instruction, saved as a daily Claude Code task or routine.
   - For app-only readers, a calendar reminder (`/reminder.ics`).
4. **Every morning.** The paper appears on **Your papers** (`/observer`):
   today's issue, the week, the archive.
5. **Returning readers** see a summary with Edit links. They can also change
   anything by telling their Claude ("I've moved to 60614, add the Bulls").

## Status

- **Built and tested.**
  - `mcp/` (Node 22+): 32 tests at four seams (the tools, the hand-in, the
    page routes, MCP over HTTP).
  - The command-line skills it reuses: 277 tests.
- **Proven end to end.**
  - Real prints through the connector, accepted and dressed.
  - Two runs with different topics produce visibly different "Your topics"
    bands.
  - A ZIP (60614) gives that city's weather; a chosen team gives its fixtures.
- **Local demo only.** A bearer-token map stands in for sign-in, and a folder
  on disk stands in for storage. Nothing is hosted yet.

## What is in `mcp/`

| File | What it is |
|---|---|
| `observer.mjs` | The connector's work as plain functions: `TOOLS`, `INSTRUCTIONS`, `callTool(name, args, reader, deps)`, `submitEdition`, `splitDigest`. No HTTP, no auth. |
| `server.mjs` | MCP over Streamable HTTP (official `@modelcontextprotocol/sdk`, stateless, JSON responses), the two pages, their JSON routes and `/reminder.ics`. `createConnector({ authenticate, deps, readers })`, `relayDeps(…)`, `tokenAuth(…)`, `reminder(…)`. |
| `store.mjs` | `memoryStore()` and `fileStore(dir)`, the storage interface Brainstorm replaces. |
| `pages/setup.html`, `pages/observer.html` | The two demo pages, self-contained, in the paper's own design. |
| `test/` | `tools`, `submit`, `pages` and `http` tests (`npm test`). |

The connector imports the skill's own code from `.claude/skills/nostr-observer/scripts/`:
- `pullCorpus`, `digest`, `cleanPaper` and `cleanTopics` (corpus.mjs);
- `resolve`;
- `check`, the validator;
- `dress`, the living copy;
- `gather` and `assess`, the readiness chain.

There is one source of truth for the paper's rules.

## The tool contract

When Claude connects, the server sends a short routine as MCP `instructions`.
Every call is for the signed-in reader, never a reader named in the arguments.

| Tool | Input | Returns |
|---|---|---|
| `get_readiness` | none | `READY`, or `NOT READY: <state>` with what to do. Also says when today's paper is already in, so a second run doesn't print a duplicate unasked. |
| `get_paper` | none | The reader's settings: place, units, teams, pages, topics, name, founding date. If empty, it tells Claude to ask the reader and save them. |
| `set_paper` | Any of: `place`, `units`, `teams[]`, `topics[]`, `name`, and the page switches (`culture`, `markets`, `recipe`, …) | Saves a change at a time, keeping the rest. The first save starts from the whole paper (every page, plus the house world and culture headlines) and sets `founded`. Readers can't set brand, stamps, imprint or The Tape. |
| `get_brief` | none | The editorial brief (about 30 KB), plus the connector's rules: print the full paper, and don't write CSS. |
| `get_digest` | `topics[]` (optional, overrides the saved ones), or `code` + `part` | The day's reading in parts of at most 90k characters (claude.ai cuts tool results at 100k), plus the edition `code`. The server keeps the full corpus under that code. |
| `submit_edition` | `code`, `html` | Accepted: the paper's link and how full it is ("9 sections and 8 pictures; the digest held 13 desks and 49 pictures"). Refused: each reason with a "How to fix" line, and Claude fixes and hands in again. |

**Checks on hand-in:**
- the same boundary as the skill: QUOTE, IMAGE, LINK, MARKUP, MASTHEAD, FOLIO,
  LAYOUT;
- CODE: the page must be for a digest this reader was given;
- TOPICS: when any topic found posts, the page must carry a
  `<section class="band your-topics">` citing one of them. This is the proof
  that personalisation is real.

**Topics** are at most five plain words, cleaned so that a topic can never add
a search operator. Each topic is its own ranked search through the reader's
lens. search-staging honours keywords alongside `observer:`: "garden" returned
11 ranked posts, against 1 in the day's ranked notes.

## HTTP surface

| Route | Who | What |
|---|---|---|
| `POST /mcp` | signed-in reader | MCP. No or bad token gives `401` with a Bearer challenge. |
| `GET /setup`, `GET /observer` | reader | The two pages. |
| `GET /api/readiness?npub=` | anyone | Is this npub's trust network ready (public information). |
| `GET /api/place?q=`, `GET /api/team?q=` | anyone | City or ZIP to a confirmed place (Open-Meteo); team name to teams (TheSportsDB). Both keyless. |
| `GET` / `POST /api/paper?npub=` | the reader | Read or save settings. POST goes through `set_paper`, so the rules are the same. |
| `GET /api/status?npub=` | the reader | Connected, and the last step their Claude took (it drives the live progress line). |
| `GET /api/today?npub=`, `GET /api/editions?npub=` | the reader | Today's paper in or not; the list of papers. |
| `GET /observer/<npub>/<date>-<code>` | the reader | One paper's living copy. |
| `GET /reminder.ics?time=HH:MM&tz=Area/City&npub=` | anyone | A daily calendar reminder (RFC 5545) at the reader's time in their zone. |

**Locally**, "the reader" is an npub in the token map; `?npub=` stands in for a
session. **On Brainstorm**, every reader route must come from the signed-in
session, never a query parameter. `POST /api/paper` in particular must not be
reachable without sign-in.

## Running it locally

Node 22 or newer. From the repository root:

```bash
cd mcp && npm ci && npm test
```

```bash
OBSERVER_TOKENS="<token>:<npub>" OBSERVER_EDITIONS=editions/connector node mcp/server.mjs
```

| Variable | Meaning |
|---|---|
| `OBSERVER_TOKENS` | `token:npub[,token:npub…]`. Local sign-in only. |
| `OBSERVER_EDITIONS` | A folder for accepted papers and reader settings (`fileStore`). Unset means in memory. |
| `OBSERVER_PUBLIC_URL` | The address readers reach the service at, used in paper links and reminders. Default `http://127.0.0.1:<PORT>`. |
| `OBSERVER_CONFIG` | A skill config file whose brand, stamps and imprint become the house marks under every reader's settings. Default `observer.config.json`. |
| `PORT` | Default `8787`. |

**Connecting Claude Code to the local connector:**

```bash
claude mcp add --transport http brainstorm-observer http://127.0.0.1:8787/mcp --header "Authorization: Bearer <token>"
```

## What Brainstorm plugs in to host it

1. **Hosting.** One Node process at `brainstormserver.nosfabrica.com/mcp`,
   next to relay access. `relayDeps({ relay })` defaults to
   `wss://search-staging.brainstorm.world`; point it at production when ready.
2. **Sign-in.** Replace `tokenAuth` with an `authenticate(req) → hex pubkey | null`
   backed by OAuth. Claude's custom connectors support OAuth 2.0, either via
   Claude's published client identity or dynamic client registration (RFC
   7591). The authorisation step is Brainstorm's page, where the reader signs
   one NIP-98 event. Requirements:
   - Verify NIP-98 against the **configured** public URL, never one rebuilt
     from request headers (as `server/src/main/kotlin/com/nosfabrica/observer/press/Main.kt` already does).
   - The token names exactly one pubkey. The connector never signs or
     publishes as the reader, which is what the consent screen promises.
   - Pass the signed-in readers as `readers` (or replace that check with the
     session) so the page routes serve only the reader's own data.
3. **Storage.** Replace `memoryStore` / `fileStore` with Brainstorm's database,
   same methods:
   - `keepCorpus`, `corpusFor`, `keepDigest`, `digestParts`: short-lived, one
     day. The corpus is about 2.5 MB.
   - `putEdition`, `editions`, `edition`: the Observer page's papers and living
     copies. About 1 MB per living copy, less with shared assets.
   - `paperOf`, `savePaper`: reader settings, small JSON.
   - `touch`, `lastCall`, `record`, `lastStep`: the progress line, ephemeral.
4. **The Observer tab in Brainstorm-UI.** Rebuild `/setup` and `/observer` in
   Brainstorm's stack, or embed them. They read only the JSON routes above.
   They are set in the paper's own design by request ("subtle, simple,
   professional, like an old newspaper"), not as app cards.
5. **House marks.** Set `paperDefaults` (brand `brainstorm`, stamps) so every
   reader's paper carries the Brainstorm edition. Readers can't change it.

## Corrections to the mockups

- **claude.ai has no scheduled tasks today.** Scheduling works in Claude Code:
  a desktop scheduled task, or a cloud routine, which uses connectors added to
  the claude.ai account. App-only readers get the calendar reminder. Switch to
  claude.ai scheduling when it exists.
- **Tool results are cut at about 100k characters in claude.ai.** A real
  digest is about 227 KB, so it comes in three parts; the brief is its own
  tool.
- **Settings live on Brainstorm, not in a Nostr event.** The consent screen
  promises the connector never signs as the reader, so settings are kept
  server-side. A kind 30078 event the reader signs on the page is still
  possible later.
- **Editions are stored.** The Observer page needs them. This reverses the
  original "we generate; we do not host" (docs/PLAN.md). "Publish to my
  Blossom" stays the reader-owned path, and is not built yet.

## Open questions

1. **Lens onboarding on demand.** This is the whole critical path for anyone
   without a lens. The page says "ask Brainstorm", and there is no API yet.
2. **The pre-filled "Add to Claude" link**
   (`claude.ai/settings/connectors?modal=add-custom-connector&mcpName=…&mcpServerUrl=…`)
   is documented but was not tested while signed in. The address is shown
   beside it as a fallback.
3. **Anthropic's terms for this pattern**: a reader's own Claude calling a
   third party's tools on the reader's behalf. Check before a public launch.
4. **Licensing** (details in NOTICE):
   - The Conversation's counter pixel for the Feature;
   - Open-Meteo, xkcd and TheMealDB are non-commercial;
   - share prices (The Tape) stay out until a licensed feed exists.
5. **Retention and quotas:**
   - how long to keep editions;
   - a cap on fresh editions per reader per day;
   - rate limits on the public lookups.
6. **Spam in topic searches.** "lightning" was mostly identical good-morning
   posts that clear the trust floor. This may be worth a higher floor for
   topic desks.

## Where the decisions are recorded

- `AGENTS.md`, under "Not settled": the connector, adoption, reader settings,
  the simpler setup and the fork policy.
- `NOTICE`: marks and licences.
- `docs/PLAN.md`: the original hosted design this departs from.
