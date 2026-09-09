# Classroom Copilot

Real-time understanding checks for live classes. An instructor opens a room,
learners join from their phones with a code, and the instructor can see —
while still teaching — whether the class is following.

Product intent, scope and milestone boundaries live in [`PRD.md`](PRD.md).
This file covers what the product does today and how to run it.

**Milestone: M0 — First Classroom.** The whole classroom flow works without AI.

---

## What it does

Three surfaces, one room.

**Instructor console** (`/r/<CODE>/host`) — private. The join code, link and QR;
who is in the room and whether they have answered; a poll composer and the live
distribution; the class pulse; the anonymous question queue; a participant
picker; and control of what the shared screen displays.

**Learner view** (`/r/<CODE>`) — mobile-first. Join with a name, no account.
Answer the live poll, set a pulse of *Got it / Shaky / Lost*, ask a question
anonymously, and upvote other people's questions.

**Shared screen** (`/r/<CODE>/screen`) — read-only, for screen sharing or a
projector. Join instructions with a QR, the live question, aggregate results
once the instructor reveals them, or whoever was just picked.

**Session summary** (`/r/<CODE>/summary`) — instructor only. Who joined, how
many took part, every poll with its distribution, the questions and their
upvotes, the pulse at the end, and the picker history. Printable.

### Feature detail

| Area | Behaviour |
| --- | --- |
| Rooms | Six-character code from an alphabet with no `I L O 0 1`. Join URL and QR. No instructor account. |
| Learner identity | Anonymous session token in an httpOnly cookie, mirrored in `localStorage`. A refresh rejoins the same identity — it never creates a second roster entry. |
| Roster | Live, private to the instructor: names, presence, and who has been called on. Deliberately no pulse and no per-poll answer flag — see Privacy below. |
| Polls | Yes/No, A–D multiple choice, confidence 1–5. One poll open at a time. One answer per learner, changeable until close. A closed poll rejects answers. |
| Reveal | The instructor always sees the live distribution. Learners and the shared screen see it only after **Show results on screen**. |
| Class pulse | One value per learner, replaced on every tap. The instructor sees aggregate counts and percentages only, never who chose what. |
| Ask again | Putting an earlier question to the class again starts a fresh round rather than reopening the old one, so the projector never shows the previous distribution as the new one. |
| Questions | Anonymous by default. One upvote per learner (a toggle, so tapping can never inflate it). The instructor can mark answered, reopen, or remove. |
| Participant picker | Uniform random. Learners who have not been picked yet come first; nobody is picked twice in a row while anyone else is available. Session history is kept. |
| Session summary | Counts, poll distributions, questions, pulse and picker history. |
| AI Class Read | **Optional and off unless a key is configured.** Reads aggregates only, returns two or three advisory sentences, changes nothing, and fails silently. |

---

## Stack

- **Next.js 16** (App Router) with **React 19** and **TypeScript**
- **PostgreSQL** — any Postgres 14+; a **Supabase** project is the expected host
- **Cloudflare Workers** via the OpenNext adapter, with **Hyperdrive** in front
  of Postgres (see Deployment — Hyperdrive is required, not optional)
- **Server-sent events** for realtime, with automatic polling fallback
- **postgres.js** for database access; no ORM
- Plain CSS with design tokens; no UI framework
- **Vitest** for unit and integration tests, **Playwright** for multi-browser tests

No queue, no cache, no websocket server, no microservices.

### Two architecture decisions worth knowing

**The browser never holds database credentials.** Every read and write goes
through a Next.js route handler that authorises the caller and returns a
projection built for that role. Supabase is used as Postgres and for session
persistence; its client-side SDK is not used. This makes the privacy boundary
application code that can be tested (see `lib/projections.ts` and
`tests/integration/authorization.test.ts`) rather than a set of RLS policies.

**Privacy is enforced in the payload, not in the components.** Learners are told
their pulse is only ever counted and that no individual answer is shown to
anyone, so the instructor snapshot does not carry either — not per-learner pulse,
not a per-learner "answered" flag (watching that flip against a moving unrevealed
tally would reconstruct someone's answer). The shared screen's payload carries a
learner's name only while the instructor has the projector on the pick screen;
`/state?role=public` needs no credential, so hiding it in the component would not
be enough. `tests/integration/authorization.test.ts` asserts the contents of each
role's payload directly.

**Realtime is server-sent events over a version counter, not a change feed.**
Database triggers bump `rooms.version` on every meaningful change; the stream
handler watches that single indexed value and pushes a fresh role-scoped
snapshot when it moves. This works through a connection pooler, on any Postgres,
and behind proxies that would break a websocket. When the stream cannot be
established or goes quiet, the client falls back to polling `/state`
automatically — the class keeps working, it just costs a little latency.

---

## Local development

Requires Node 20.9+ and a PostgreSQL 14+ server.

```bash
git clone https://github.com/iqbalmohamad/classroom-copilot.git
cd classroom-copilot
npm install

cp .env.example .env.local        # then edit DATABASE_URL
createdb classroom_copilot        # or use an existing database
npm run db:migrate

npm run dev                       # http://localhost:3000
```

Open `http://localhost:3000`, click **Start class**, and open the join link in
a second browser (or a phone on the same network) to see both sides.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:reset` | Drop application tables and re-migrate (local only) |
| `npm test` | Unit + integration suites |
| `npm run test:e2e` | Multi-browser Playwright suite |
| `npm run verify` | Typecheck then tests |

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. |
| `DATABASE_POOL_MAX` | no | Pooled connections per server instance. Default `5`. |
| `APP_ORIGIN` | in production | Public origin used to build join URLs and QR codes, e.g. `https://class.example.com`. Without it the app falls back to the request's own host headers. Deliberately **not** a `NEXT_PUBLIC_` variable: those are inlined at build time, so they cannot be changed from a hosting dashboard without rebuilding. `NEXT_PUBLIC_APP_URL` is still read as a fallback. |
| `DATABASE_SSL` | no | `require` (the default for any non-loopback host) or `disable`. postgres.js defaults to no TLS, so this is set explicitly rather than left to a URL parameter. |
| `AI_API_KEY` | no | Anthropic key. **Absent means AI Class Read does not exist** — the panel is not rendered and the route refuses. |
| `AI_MODEL` | no | Defaults to `claude-haiku-4-5-20251001`. |
| `CC_DISABLE_RATE_LIMIT` | no | Test harnesses only. Never set this on a deployment. |
| `CC_ALLOW_INSECURE_COOKIES` | no | Drops the `Secure` cookie flag so a local `http://` run works. Set by `npm run dev` and the test harnesses. Never set it on a deployment — session cookies are Secure by default precisely so a missing `NODE_ENV` cannot silently turn that off. |
| `CC_SKIP_BUILD` | no | Skips the rebuild the test harnesses do before running. Local iteration only. |
| `CC_STREAM_POLL_MS` | no | How often an open event stream checks the room version. Default `400`. Cloudflare sets `1000` — see the cost note under Deployment. |
| `CC_STREAM_LIFETIME_MS` | no | How long a stream lives before asking the browser to reconnect. Default `50000`. |

`.env.local` is gitignored. No secret is committed, and no secret reaches the
browser: everything above is read only in server code (`lib/env.ts` is marked
`server-only`).

---

## Database setup

The schema is a single SQL migration in `db/migrations/`, applied by a small
forward-only runner that records what it has run.

```bash
DATABASE_URL=postgresql://... npm run db:migrate
```

**Run migrations with the same database role the application uses.** The
migration enables row-level security on every table and defines no policies.
A table's owner bypasses RLS, so the application is unaffected while every
other role is denied — in particular Supabase's `anon` and `authenticated`
roles, which would otherwise be able to read these tables straight from a
browser through PostgREST. If you migrate as one role and run the app as
another, the app will be denied by its own backstop.

### Supabase specifically

1. Create a project. Note the database password.
2. **Project Settings → Database → Connection string → Transaction pooler**.
   Copy it and insert the password. Do **not** append `?pgbouncer=true`:
   postgres.js forwards unknown URL parameters to the server as startup
   options, and Postgres rejects the connection outright with
   `unrecognized configuration parameter "pgbouncer"`. The pooler is already
   handled by the driver's `prepare: false` setting.
3. Set that as `DATABASE_URL` and run `npm run db:migrate` from your machine.
4. Nothing else. No tables to create by hand, no policies to write, no
   Supabase client keys to configure — the app does not use them.

`prepare: false` is set on the Postgres client, so the transaction pooler is
supported, and TLS is required for any non-loopback host. Keep
`DATABASE_POOL_MAX` small (the default of 5 is right) because serverless hosts
run many short-lived instances — and either set it to a number or leave the key
out entirely, since an empty value would otherwise mean "no connections".

The migration runner warns if the tables are owned by a different role than the
one you are connected as, because that is what silently breaks the RLS backstop
described above.

---

## Deployment — Cloudflare Workers

The app runs on Cloudflare Workers through the OpenNext adapter
(`@opennextjs/cloudflare`). Everything below has been exercised against the real
Workers runtime (`workerd`) locally; what has *not* happened yet is a deploy to
Cloudflare itself, because this repository has no Cloudflare credentials.

```bash
npm run cf:build     # build the Worker bundle into .open-next/
npm run cf:preview   # build, then run it on workerd locally (wrangler dev)
npm run cf:check     # pre-deployment check: config, secrets, login
npm run cf:deploy    # build and deploy
npm run test:workers # the whole suite against workerd, not against next start
```

### Hyperdrive is required

Not a preference — a Worker cannot reach Supabase directly with this driver.
postgres.js negotiates TLS through `node:tls`, and workerd rejects the options
it passes:

```
ERR_OPTION_NOT_IMPLEMENTED: The options.rejectUnauthorized option is not implemented
  at Object.connect (node-internal:internal_tls_wrap:457:15)
```

Verified on workerd for `ssl` = `require`, `true`, `prefer`, `allow` and
`verify-full`: every one fails. Hyperdrive terminates TLS to the database and
presents a plaintext endpoint inside Cloudflare's network. It also pools
connections, which matters here because each Worker request opens its own (see
below).

### Connection lifetime

Under Node the app keeps one pool per process. On Workers it opens a connection
per request and closes it with the request, because a socket belongs to the I/O
context that created it. Reusing a pooled connection across requests does not
merely leak — the invocation hangs and the runtime kills it. Before this was
fixed, exactly every other request to a Worker returned 500 with *"your Worker's
code had hung and would never generate a response"*.

The event stream holds its connection for the life of the stream and releases it
when the stream ends, cycles, or the learner disconnects (`lib/db.ts`,
`openDatabaseScope`).

This is the second reason Hyperdrive is not optional. A class of forty holds
about forty-two open streams, so without a pooler in front the database would
see forty-two concurrent connections from the Worker — measured at 44 during a
30-minute rehearsal on `workerd`, flat, with no growth. Supabase's direct
connection limit is well below that on smaller instances. Hyperdrive multiplexes
those onto a much smaller origin pool.

### Steps

1. **Create the database.** Any Supabase project. Copy the connection string
   from Project Settings → Database. Run the migrations against it once:
   ```bash
   DATABASE_URL='postgresql://...' npm run db:migrate
   ```
   Run this as the role the application will use — see Database setup above.

2. **Create the Hyperdrive configuration** and put its id in `wrangler.jsonc`:
   ```bash
   npx wrangler hyperdrive create classroom-copilot-db \
     --connection-string="postgresql://USER:PASSWORD@HOST:5432/postgres" \
     --caching-disabled
   ```
   Replace `REPLACE_WITH_HYPERDRIVE_ID` in `wrangler.jsonc` with the id it
   prints. The database password lives in the Hyperdrive config, not in the
   Worker.

   **`--caching-disabled` is not optional.** Hyperdrive caches SQL responses by
   default. The realtime transport works by re-reading one counter
   (`rooms.version`) about once a second, so a cached read means learners keep
   seeing the previous question after the instructor has moved on — the product
   silently stops being live, with nothing in the logs to say so. If a
   configuration already exists without the flag, fix it in place:
   ```bash
   npx wrangler hyperdrive update <id> --caching-disabled
   ```

3. **Set the public origin.** Until the hostname exists this cannot be known, so
   deploy once, note the `*.workers.dev` hostname (or attach a custom domain),
   then add it to the `vars` block in `wrangler.jsonc` and deploy again:
   ```jsonc
   "vars": { "APP_ORIGIN": "https://your-host", ... }
   ```
   It is configuration rather than a secret, so it belongs in the config file
   where it is reviewable. Without it, join URLs and the QR code are built from
   request headers.

4. **Check and deploy.**
   ```bash
   npm run cf:check
   npm run cf:deploy
   ```

`npm run cf:check` refuses to pass while the Hyperdrive id is a placeholder,
`nodejs_compat` is missing, `.dev.vars` is tracked by git, or wrangler is not
logged in.

### Local development against the Workers runtime

`npm run dev` is the ordinary Next.js dev server and is what you want most of
the time. To exercise the deployment target:

```bash
cp .env.example .env.local          # DATABASE_URL for a local Postgres
npm run test:workers                # builds, starts workerd, runs everything
```

`wrangler dev` reads local configuration from `.dev.vars` (never committed) and
uses the Hyperdrive binding's `localConnectionString`, which
`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` overrides per run.

### Plan and cost

The Workers **Free plan will not run this app**, for two independent reasons:

- Free allows **50 external subrequests per invocation**. One event-stream
  connection makes roughly one database round trip per poll interval for its
  whole 50-second life — about 50 at `CC_STREAM_POLL_MS=1000`, and about 125 at
  the Node default of 400ms. Paid allows 10,000 by default.
- Hyperdrive on Free is capped at **100,000 queries per day**. A single
  90-minute class of forty is roughly 227,000 at 1000ms (and ~567,000 at 400ms).

**Workers Paid, $5/month minimum**, covers it: Hyperdrive queries are unlimited
there and included, and 10,000 subrequests per invocation is far above what a
stream uses. For scale: a 90-minute class of forty holds ~42 concurrent streams,
each recycled every 50 seconds, so about 4,500 stream invocations plus a few
thousand ordinary requests — comfortably inside the paid plan's included usage.
CPU time is what Workers bills, and these streams spend almost all of their wall
clock waiting on the database rather than executing.

`CC_STREAM_POLL_MS` is the dial: 1000ms is set in `wrangler.jsonc` and more than
halves the query volume against the Node default, at a measured cost of roughly
550ms rather than 120ms for an update to reach every phone.

**Production URL:** _not yet deployed — see "Known limitations"._

---

## Testing

```bash
npm test           # 163 tests: 71 unit + 92 integration (Node)
npm run test:e2e   # 9 multi-browser scenarios (Node)
npm run verify     # typecheck, then both of the above
npm run test:workers  # integration + browser suites against the Workers runtime
```

`npm run test:workers` is the one that proves the deployment target works. It
builds the Worker, starts `workerd` via `wrangler dev`, and runs the same
integration and browser suites against it. `next start` is Node and cannot
stand in for it: the connection-lifetime bug described under Deployment passes
every Node test and breaks every other request on Workers.

Both suites rebuild the app before running, so a green result always reflects
the working tree rather than whatever was last compiled.

**Unit** (`tests/unit/`) pins the load-bearing rules in isolation: the poll
state machine, tally maths, pulse aggregation, picker fairness, name and code
handling, constant-time token comparison, the rate-limit bucket and the key it
is derived from, and every failure path of the AI provider call.

**Integration** (`tests/integration/`) runs a real Next.js server against a real
Postgres and drives it over real HTTP with real cookies, because the behaviour
that matters only exists once those layers are in play. It covers every
instructor route refusing a learner, one answer per learner under fifteen
simultaneous taps, a poll closing while responses are in flight, upvote
uniqueness under concurrent tapping, duplicate joins, cookie loss and recovery,
cross-room token reuse, presence going stale and recovering, and the exact
shape of each role's projection. The harness creates its own `_test` database
and refuses to run if something else is already on its port.
`tests/integration/rate-limit.test.ts` starts a second server with limits left
on, because every other suite disables them and an unwired limiter would
otherwise go unnoticed.

**Multi-browser** (`e2e/`) runs one instructor, three learners on phone
viewports and a shared screen simultaneously, and asserts that state arrives on
its own — no test reloads a page to make an assertion pass. It covers the whole
lesson, refreshes on all three surfaces, the privacy boundary from a browser
that only knows the code, and mobile overflow and touch-target size.
`e2e/resilience.spec.ts` additionally breaks the network the way a venue does:
the event stream blocked outright, a phone dropping offline mid-lesson, a
backgrounded tab, and the shared screen losing its connection.

**Verified against the Cloudflare Workers runtime.** `npm run test:workers`
runs the integration and browser suites on `workerd` — 92 integration tests and
9 browser scenarios — with the database reached through the Hyperdrive binding.
On top of that, on `workerd`:

| | |
| --- | --- |
| 40 simultaneous joins | 722ms, 0 failures, 40 distinct names |
| poll reaching all 40 phones | 498ms first, 549ms median |
| 40 simultaneous answers | 559ms, 0 failures, tally exactly 40 |
| stream cycling, 160s | 3 clean cycles, 0 errors, transport never left "Live" |

And a **30-minute rehearsal** with one instructor, forty learners and a shared
screen, running 36 poll rounds with pulse changes, questions, upvotes and a pick
each round:

| | |
| --- | --- |
| polls delivered to all 40 | every round, 36 of 36 |
| delivery latency | median 940ms, worst 1148ms |
| stream connections opened | 1,554, zero errors |
| HTTP requests | 3,319, zero failures |
| database connections | flat at 42 throughout, 0 once clients left |

The flat connection count is the one that matters: on Workers each request opens
its own connection, so a missed cleanup shows up here as a number that climbs.
It did not, and everything was released afterwards.

**Verified by hand at class scale.** Forty learners, each holding a live stream,
against one server: forty simultaneous joins in ~400ms with forty distinct
names, a poll reaching every phone in 67–120ms, forty simultaneous answers in
~160ms with the tally exactly right, and the picker covering all forty in one
round — no failures. A separate 150-second soak confirmed the stream-cycling
mechanism a long class depends on: four clean cycles, zero errors, the transport
never leaving "Live", and a poll opened at the end delivered in 331ms.

Both suites need `DATABASE_URL` set; each creates and migrates its own
database from it.

---

## Repository layout

```
app/
  page.tsx, HomeScreen.tsx        start or join a class
  r/[code]/                       learner view
  r/[code]/host/                  instructor console
  r/[code]/screen/                shared screen
  r/[code]/summary/               session summary
  api/rooms/                      every route handler
components/host/                  instructor console panels
lib/
  domain/                         pure classroom rules (no I/O, heavily tested)
  projections.ts                  the privacy boundary: one builder per role
  service.ts                      every mutation, each a short transaction
  auth.ts                         the two token types and how they are checked
  client/useRoomState.ts          realtime transport and fallback
db/migrations/                    schema
tests/, e2e/                      see Testing above
```

---

## Known limitations

These are real and current, not hypotheticals.

- **Local `workerd` is the same runtime, but not the same environment.**
  `wrangler dev --local` runs the real Workers runtime, so the findings that
  matter — the connection-lifetime rule, the TLS limitation, header and cookie
  behaviour — are genuine. What it does *not* exercise is Hyperdrive itself:
  locally the binding is emulated by a direct connection to Postgres, so real
  TLS termination to Supabase, real origin pooling and real network latency are
  still unverified. That is the largest remaining unknown, and the first thing
  to check after the first deploy.
- **No production deployment yet.** The app is verified against the real
  Cloudflare Workers runtime locally — the full suite plus a class-scale load
  test and a stream-cycling soak all run on `workerd` — but no hosted instance
  exists. This environment has no Cloudflare credentials and cannot reach
  `api.cloudflare.com`, so the deploy itself has to be run by someone who can.
  The steps are in Deployment above and `npm run cf:check` verifies the
  configuration before you try.
- **Workers Paid ($5/month) is required.** The Free plan's 50 subrequests per
  invocation and Hyperdrive's 100k queries/day both break under a single class;
  the reasoning and numbers are under Deployment.
- **Rooms are never cleaned up.** There is no retention policy or expiry job.
  Rows accumulate; for a handful of classes this does not matter.
- **A lost instructor cookie needs the instructor link.** The instructor
  credential lives only in an httpOnly cookie — it is deliberately not kept in
  `localStorage`, because a console is often opened on a shared classroom
  machine and a copy there would outlive the lesson and be readable by any
  script on the origin. The trade-off is that if that cookie is lost there is no
  account to sign back into. The console's **instructor link** is the recovery
  path; copy it before class. That link is a long-lived credential in a URL, so
  it lands in browser history and any proxy log it passes through — treat it
  like a password.
- **Rate limits are per server instance, in memory.** On a serverless host each
  instance keeps its own counters, so the effective limit is looser than the
  configured one. This is deliberate: it stops a bored learner flooding the
  question queue, and is not an abuse-prevention system.
- **Presence is a 90-second window.** A learner whose phone sleeps shows as
  "away" for up to ninety seconds after they come back to a poor connection, and
  is briefly excluded from the pulse aggregate and the picker pool.
- **One class at a time per browser profile.** Tokens are stored per room code,
  so this works, but the app has no "my classes" list — the instructor navigates
  by URL.
- **No export.** The summary is printable; there is no CSV or JSON download.
- **Two tabs joining at the same instant create two roster entries.** Each
  browser gets its identity from the join response, so two simultaneous
  cookie-less joins from the same person appear as e.g. "Sam" and "Sam (2)".
  Cosmetic, and it cannot double-count a poll or a pulse.
- **Chromium only in the browser suite.** Safari and Firefox have not been
  automated. The learner view was designed mobile-first and uses no
  Chromium-specific APIs, but iOS Safari has not been tested on a real device.
- **A poll cannot be edited or deleted.** A mistyped question can be closed and
  the screen set to Blank, but the row stays in the session summary.
- **AI Class Read is untested against a live provider.** The code path, the
  aggregate-only boundary and every failure mode are tested; no key was
  available here to make a real call.

---

## Not in M0

Deliberately absent, per `PRD.md`: accounts and SSO, payments, institutions,
LMS integrations, native apps, chat, video, breakout rooms, slide authoring,
leaderboards and badges, learner analytics over time, and any AI that acts on
the classroom rather than advising the instructor.
