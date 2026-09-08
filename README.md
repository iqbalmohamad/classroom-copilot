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
| Roster | Live, private to the instructor. Presence is derived from a heartbeat, so a learner who drops off simply fades to "away" and comes back on reconnect. |
| Polls | Yes/No, A–D multiple choice, confidence 1–5. One poll open at a time. One answer per learner, changeable until close. A closed poll rejects answers. |
| Reveal | The instructor always sees the live distribution. Learners and the shared screen see it only after **Show results on screen**. |
| Class pulse | One value per learner, replaced on every tap. The instructor sees aggregate counts and percentages only, never who chose what. |
| Questions | Anonymous by default. One upvote per learner (a toggle, so tapping can never inflate it). The instructor can mark answered, reopen, or remove. |
| Participant picker | Uniform random. Learners who have not been picked yet come first; nobody is picked twice in a row while anyone else is available. Session history is kept. |
| Session summary | Counts, poll distributions, questions, pulse and picker history. |
| AI Class Read | **Optional and off unless a key is configured.** Reads aggregates only, returns two or three advisory sentences, changes nothing, and fails silently. |

---

## Stack

- **Next.js 16** (App Router) with **React 19** and **TypeScript**
- **PostgreSQL** — any Postgres 14+; a **Supabase** project is the expected host
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
| `NEXT_PUBLIC_APP_URL` | in production | Public origin used to build join URLs and QR codes. Without it the app trusts the forwarded host headers. |
| `AI_API_KEY` | no | Anthropic key. **Absent means AI Class Read does not exist** — the panel is not rendered and the route refuses. |
| `AI_MODEL` | no | Defaults to `claude-haiku-4-5-20251001`. |
| `CC_DISABLE_RATE_LIMIT` | no | Test harnesses only. Never set this on a deployment. |

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
   Copy it, insert the password, and append `?pgbouncer=true`.
3. Set that as `DATABASE_URL` and run `npm run db:migrate` from your machine.
4. Nothing else. No tables to create by hand, no policies to write, no
   Supabase client keys to configure — the app does not use them.

`prepare: false` is set on the Postgres client, so the transaction pooler is
supported. Keep `DATABASE_POOL_MAX` small (the default of 5 is right) because
serverless hosts run many short-lived instances.

---

## Deployment

The app is a standard Next.js server; anything that runs Next 16 on a Node
runtime will host it. Vercel is the shortest path.

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production
vercel env add NEXT_PUBLIC_APP_URL production     # https://<your-domain>
vercel --prod
```

Then run the migration once against the production database:

```bash
DATABASE_URL='<production connection string>' npm run db:migrate
```

Deployment notes:

- The event-stream route (`app/api/rooms/[code]/stream/route.ts`) declares
  `maxDuration = 60` and deliberately ends each stream after ~50 seconds,
  asking the browser to reconnect. That reconnect doubles as a full state
  re-sync, so a platform that caps streaming responses is handled rather than
  worked around. On a plan with a shorter cap, lower `MAX_LIFETIME_MS` to sit
  under it — the client handles the close either way.
- Every client holds one open stream while the class runs, so a class of forty
  is forty concurrent invocations. That is well inside normal limits but worth
  knowing if you are watching function usage.
- API responses are sent `no-store`; nothing classroom-related is cacheable.
- Set `NEXT_PUBLIC_APP_URL` in production. Without it, join URLs and the QR code
  are built from forwarded host headers.

**Production URL:** _not yet deployed — see "Known limitations"._

---

## Testing

```bash
npm test          # 129 tests: 61 unit + 68 integration
npm run test:e2e  # 5 multi-browser scenarios
```

**Unit** (`tests/unit/`) pins the load-bearing rules in isolation: the poll
state machine, tally maths, pulse aggregation, picker fairness, name and code
handling, constant-time token comparison, the rate limiter, and what the AI
feature is allowed to send.

**Integration** (`tests/integration/`) runs a real Next.js server against a real
Postgres and drives it over real HTTP with real cookies, because the behaviour
that matters only exists once those layers are in play. It covers every
instructor route refusing a learner, one answer per learner under fifteen
simultaneous taps, a poll closing while responses are in flight, upvote
uniqueness under concurrent tapping, duplicate joins, cookie loss and recovery,
cross-room token reuse, and the exact contents of each role's projection. The
harness creates its own `_test` database and refuses to run if something else
is already on its port.

**Multi-browser** (`e2e/`) runs one instructor, three learners on phone
viewports and a shared screen simultaneously, and asserts that state arrives on
its own — no test reloads a page to make an assertion pass. It covers the whole
lesson, refreshes on all three surfaces, the privacy boundary from a browser
that only knows the code, and mobile overflow and touch-target size.

Both suites need `DATABASE_URL` set. The e2e suite additionally needs a
`<database>_e2e` database to exist and be migrated.

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

- **No production deployment yet.** The app is verified locally end to end
  against Postgres and in five simultaneous browsers, but no hosted instance
  exists: this environment has no Vercel or Supabase credentials. Deploying is
  the documented steps above and takes a few minutes.
- **Rooms are never cleaned up.** There is no retention policy or expiry job.
  Rows accumulate; for a handful of classes this does not matter.
- **A lost instructor cookie needs the instructor link.** If the browser that
  created the room loses both its cookie and its `localStorage`, there is no
  account to sign back into and no way to recover control of that room. Copy the
  instructor link before class if this worries you.
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
- **Chromium only in the browser suite.** Safari and Firefox have not been
  automated. The learner view was designed mobile-first and uses no
  Chromium-specific APIs, but iOS Safari has not been tested on a real device.
- **AI Class Read is untested against a live provider.** The code path, the
  aggregate-only boundary and every failure mode are tested; no key was
  available here to make a real call.

---

## Not in M0

Deliberately absent, per `PRD.md`: accounts and SSO, payments, institutions,
LMS integrations, native apps, chat, video, breakout rooms, slide authoring,
leaderboards and badges, learner analytics over time, and any AI that acts on
the classroom rather than advising the instructor.
