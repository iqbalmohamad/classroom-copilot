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
distribution; open-ended activities and the answers they collect; the class
pulse; the anonymous question queue; a participant picker; timers; shared
materials; and one panel, **Presentation screen**, that opens the screen you
share and says what the class is looking at.

**Learner view** (`/r/<CODE>`) — mobile-first. Join with a name, no account.
Answer the live poll, write an open-ended answer (a word, a number, a paragraph,
pasted SQL), read the instructor's private feedback on it, set a pulse of *Got
it / Shaky / Lost*, ask a question about the section you are in, upvote other
people's questions, and open the links the instructor has shared.

**Presentation screen** (`/r/<CODE>/screen`) — read-only, for screen sharing or
a projector. Join instructions with a QR, the live question, aggregate results
once the instructor reveals them, or whoever was just picked. Opening a
question, revealing results and picking a participant move it on their own;
the console always states what is on it, because it is the one tab the
instructor cannot see while sharing it.

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
| Reveal | The instructor always sees the live distribution. Learners and the presentation screen see it only after **Show results on screen** — choosing the results screen does not reveal anything by itself. |
| Named vs anonymous | Polls, pulse and questions are unchanged: aggregate-only, anonymous by default. Activity submissions are the one named surface, and learners are told so on the form before they type. |
| Class pulse | One value per learner, replaced on every tap. The instructor sees aggregate counts and percentages only, never who chose what. |
| Ask again | Putting an earlier question to the class again starts a fresh round rather than reopening the old one, so the projector never shows the previous distribution as the new one. |
| Questions | Anonymous by default. One upvote per learner (a toggle, so tapping can never inflate it). The instructor can mark answered, reopen, or remove. |
| Participant picker | Uniform random. Learners who have not been picked yet come first; nobody is picked twice in a row while anyone else is available. Session history is kept. |
| Sections | Optional. Every room starts with "Section 1"; **Next** makes the following one when you need it. Prepare, rename and reorder them before or during class. Moving between sections publishes no draft and erases nothing — but it does close the pulse round of the section you leave, keeping its answers as history, so nothing further is collected against a part of the lesson the class is no longer in. |
| Pulse rounds | The pulse belongs to a section and a round. **Ask again** closes the round and opens a fresh one, so the answer before an explanation survives to be compared with the answer after it. Moving to a different section also closes the round: its answers are kept as history, and nothing further is collected against a part of the lesson the class has left. A tap aimed at a closed round is refused, not redirected — and so is a quick-start tap sent while no round was open, if the pulse context has changed since that screen loaded: a navigation (even one that returns to the same section) or an instructor starting a round, and nothing else — unrelated joins, questions and answers never invalidate a tap. The learner's phone says which section and round it is rating. |
| Activities | Open-ended exercises: short text, a number, a paragraph, SQL that keeps its formatting, several fields at once, or a choice plus a written explanation. One submission per learner, editable while it is open. **Run again** creates a fresh attempt rather than overwriting the first. |
| Preparing activities | Every field is editable after writing it — prompt, instructions, section, answer fields, private reference answer, suggested duration — and they are grouped by section and reordered with ↑/↓. The arrows move an activity within its section, past the neighbour on screen; moving it to a different section is the Edit form's job. That order is what gets run and what a saved plan carries into the next term. The answer fields are the one part that locks once anyone has answered, because changing them would re-attribute submissions to questions nobody was asked. |
| Review | Named submissions, private per-learner feedback, review states (pending / reviewed / needs follow-up), a filter, and **Invite to explain**, which spotlights the author and records it in the picker's history. |
| Revealing an answer | One at a time, on the shared screen, anonymous unless the instructor deliberately names the author. |
| Timers | A stored deadline, so the console, every phone and the projector count down from the same instant and a refresh costs nobody a second. Start, pause, resume, extend, end; optionally close the activity when it runs out. |
| Materials | Http/https links only, attached to the session or to a section, pinnable to the top of every phone. |
| Session plans | Save this room's preparation and start another class from it, or lift a single exercise across. Learner data cannot travel in one. |
| Earlier classes | Opt-in per class: **Keep this class on this device** stores that class's instructor key in this browser, so it appears under **Your classes** and inside **Prepare & reuse** weeks later. Opening one signs you back in through the same verified link the instructor link uses. Off by default, because a console is often opened on a shared machine. |
| Session summary | Counts, poll distributions, pulse by section and round, activities with named answers and review status, questions with their context, materials, and picker history. Printable, and downloadable as CSV. |
| AI Class Read | **Optional and off unless a key is configured.** Reads aggregates only, returns two or three advisory sentences, changes nothing, and fails silently. |

---

## Running a session

### Quick start — no preparation at all

Start a class, read the code out, teach. The room already has a section called
"Section 1", so polls, activities, questions and pulse rounds all have somewhere
to belong without anyone naming anything. When you move on, press **Next** and
"Section 2" appears. Every quick action is one click from the top of the
console: **Open poll**, **Ask now** for an open-ended activity, a timer preset,
**Ask again** for the pulse, **Pick a learner**.

Nothing below is required to teach a whole lesson.

### Prepared — a deck's worth of structure, before anyone joins

1. **Sections.** In the console, **Plan sections** → add, rename, reorder. For
   Day 30 that is *Why SQL Exists · Database Structure · DDL/DML · Environment
   Setup · DDL Practice*.
2. **Activities.** Type the prompt, then **More options** for the answer fields
   (a choice plus a written explanation, a number and a SQL box, three short
   answers — up to eight fields), your own private reference answer, and a
   suggested duration. **Save for later** keeps it as a draft; **Ask now** puts
   it in front of the class.
3. **Materials.** Paste the dataset, install-guide and LMS links. Pin the one
   the class needs right now and it goes to the top of every phone.
4. **Save the plan.** **Prepare & reuse → Save this session as a plan** stores
   the sections, exercises, polls, durations, materials and reference answers in
   this browser. Next week, **Start a class from it** creates a brand-new room
   with fresh credentials and all of it as drafts. No learner, submission,
   pulse, vote or pick can travel in a plan. To bring across a single exercise
   instead, use **Reuse an exercise** from inside the new room.

### During the lesson

**Next** moves the class on; it never publishes a draft or clears a result.
**Ask again** starts a fresh pulse round and keeps the previous one readable
underneath, which is how a before-and-after comparison works. Moving sections
does the same thing for you, so a round never keeps collecting about a part of
the lesson the class has left. A timer's deadline
is stored on the server, so every surface counts down together and closure
happens on time whether or not the console is awake. **Review** on an activity
opens the named answers: mark them, write private feedback, put one on the
shared screen (anonymous unless you name the author), or invite its author to
talk it through.

Afterwards, **Summary** is printable and has a **Download CSV** for marking.

### Coming back to an earlier class

Two different things, kept apart on purpose:

* **Reading what a class actually wrote.** Turn on *Keep this class on this
  device* in the console (next to the instructor link) and it appears under
  **Your classes** on the home page and under **Prepare & reuse** in any later
  class, with a direct link to its answers. That is how Day 31 revisits the
  business questions collected on Day 30.
* **Asking the same question again.** *Reuse an exercise* copies the prompt into
  the class you are teaching now and collects fresh answers, leaving the
  original session untouched.

Either way the instructor key is what opens it. A room code alone opens
nothing, and the key is stored only when you ask for it.


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
git checkout claude/m0-first-classroom-4lbk0i   # the application lives here
npm ci

cp .env.example .env.local        # then edit DATABASE_URL
createdb classroom_copilot        # or use an existing database
npm run db:migrate

npm run dev                       # http://localhost:3000
```

`main` still holds only the original brief; every command below assumes the
branch above. `npm ci` rather than `npm install` because the lockfile is what
was tested.

Open `http://localhost:3000`, click **Start class**, and open the join link in
a second browser (or a phone on the same network) to see both sides.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:cutover-check` | Confirm no class is running before the 0003 cutover, and that none was lost after it |
| `npm run db:reset` | Drop application tables and re-migrate (local only) |
| `npm test` | Unit + integration suites |
| `npm run test:e2e` | Multi-browser Playwright suite |
| `npm run verify` | Typecheck then tests |

---

## Migrations

Forward-only SQL files in `db/migrations/`, applied by `npm run db:migrate` with
the same database role the application connects as (see the RLS note at the top
of `0001_init.sql`). Running it twice is a no-op.

| File | What it adds |
| --- | --- |
| `0001_init.sql` | Rooms, participants, polls, questions, picks, the version trigger, RLS |
| `0002_participant_references.sql` | Makes a participant deletable without breaking their questions or picks |
| `0003_classroom_workflow.sql` | Sections, pulse rounds, activities and their answers, timers, materials, question context, session plans |
| `0004_activity_order.sql` | Makes the activity sequence deferrable, so a reorder can be one statement |
| `0005_pulse_epoch.sql` | Adds the pulse-context epoch to rooms, so a quick-start tap can be pinned to the visit its screen showed. Additive; applies whenever |

### 0003 needs a window with no class in it

The schema changes are additive — new tables, nullable columns, one widened
CHECK, nothing dropped — but **that does not make the deploy safe to do during a
class**, and the first version of this section wrongly implied it did.

The problem is not the schema, it is that two versions of the application
disagree about where the pulse lives. 0003 copies `participants.pulse` into
`pulse_responses`, and the new build stops writing that column. The old build is
still writing it until the moment the new one is live. Any pulse a learner sets
between the backfill and the deploy is written to a column nothing reads
afterwards: it is not corrupted, it is simply invisible, and the class sees
their answer disappear from the instructor's readout.

There is no way to make the two builds agree, so the cutover is a short window
rather than a rolling upgrade:

```bash
# 1. Establish that no class is running. Exits nonzero if one is.
DATABASE_URL='postgresql://...' npm run db:cutover-check

# 2. Migrate.
DATABASE_URL='postgresql://...' npm run db:migrate

# 3. Deploy immediately — this is the gap that matters, so do not stop here.
npm run cf:check && npm run cf:deploy

# 4. Confirm nothing was written to the old column in between.
DATABASE_URL='postgresql://...' npm run db:cutover-check --after
```

Step 4 is the verification, not a formality: it reports any learner whose pulse
was written to the deprecated column after the migration timestamp, which is
exactly the loss the window exists to prevent. If it finds any, those learners
tap again on the new build — there is deliberately no automatic reconciliation,
because a stale column value carries no round, and guessing one would file an
answer under the wrong section.

`0004` has none of this: it changes one constraint's timing and can be applied
whenever.

### Rolling back

Once the new build has run, rollback is not symmetrical.

- **Rolling back the application** (redeploying the previous build) is
  survivable and loses no rows. Pulse writes go back to `participants.pulse`,
  and everything created since — sections, pulse rounds, activities and their
  submissions, feedback, timers, materials, plans — stops being visible while
  staying in the database. Two rough edges: pulse recorded since the cutover
  will not appear, and a room left with `public_mode` of `activity` or
  `response` shows the old build's join screen, since those values postdate it.
- **Rolling back the migration** is a data-loss operation and there is no down
  script on purpose. Dropping the 0003 tables discards every activity
  submission, every piece of feedback and every pulse round recorded since the
  cutover. If it ever has to happen, export first: `GET
  /api/rooms/<code>/summary?format=csv` for each affected class, which contains
  the named submissions and the pulse rounds in full.

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
(`@opennextjs/cloudflare`), deployed at
<https://classroom-copilot.mohammad-iqbal1304.workers.dev>.

Everything below has also been exercised against the real Workers runtime
(`workerd`) locally. The deploy itself is run by the Product Owner from their
own machine: this repository has no Cloudflare credentials, and the live
Hyperdrive id and `APP_ORIGIN` live in their working copy rather than here.

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

`npm run cf:check` exits nonzero while the Hyperdrive id is a placeholder,
`nodejs_compat` is missing, `.dev.vars` is tracked by git, wrangler is not
logged in, or Hyperdrive caching is on.

It also exits nonzero when a check **could not be run** — no network, no
wrangler, an unreadable answer — and says so as `UNKNOWN` rather than `warn`.
An unverified login is not a working login, and unverified caching is the
failure that breaks a class silently, so neither is allowed to pass as a note
in the margin. Only the last line, *"All checks verified"*, means ready.

### Deploying from Windows (PowerShell)

The same four steps, spelled out for PowerShell and starting from nothing. Run
them in order; each one is a separate command.

```powershell
# 1. Get the code. The application is on the branch, not on main.
git clone https://github.com/iqbalmohamad/classroom-copilot.git
cd classroom-copilot
git checkout claude/m0-first-classroom-4lbk0i
npm ci
```

```powershell
# 2. Migrate the Supabase database, once.
#    Read-Host keeps the connection string out of your shell history.
$env:DATABASE_URL = Read-Host "Supabase connection string"
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

```powershell
# 3. Log in to Cloudflare and create the Hyperdrive configuration.
npx wrangler login
$cs = Read-Host "Supabase connection string"
npx wrangler hyperdrive create classroom-copilot-db --connection-string="$cs" --caching-disabled
Remove-Variable cs
```
Copy the `id` it prints into `wrangler.jsonc`, replacing
`REPLACE_WITH_HYPERDRIVE_ID`. `--caching-disabled` is mandatory — see step 2 of
**Steps** above for why.

```powershell
# 4. Check, then deploy.
npm run cf:check          # must print "All checks verified"
npm run cf:deploy
```

`npm run cf:deploy` prints the `*.workers.dev` hostname. Put it in the `vars`
block of `wrangler.jsonc` as `APP_ORIGIN`, then run `npm run cf:deploy` once
more so join URLs and the QR code are built from it rather than from request
headers.

**What is and is not verified on Windows.** Every command above is Node or
PowerShell only — no Unix shell, no inline `VAR=value` prefixes. Where this
repository has to start another tool it runs that package's own entry point
with the current Node binary (`node node_modules/<pkg>/…`) rather than `npm` or
`npx`, which are `.cmd` shims on Windows and fail with `ENOENT` under
`execFile`: that covers the pre-deployment check, `npm run dev`, and both test
harnesses. That said, none of it has been *run* on a Windows machine from here;
the verification in this repository was done on Linux with Node 22.

If any step above misbehaves on Windows, use the path that was actually
verified — Ubuntu under WSL 2, which is the same environment the whole suite
was tested in:

```powershell
wsl --install -d Ubuntu     # once, then reboot and open "Ubuntu"
```
```bash
# inside the Ubuntu shell
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
git clone https://github.com/iqbalmohamad/classroom-copilot.git
cd classroom-copilot && git checkout claude/m0-first-classroom-4lbk0i && npm ci
npx wrangler login          # opens the Windows browser
npm run cf:check && npm run cf:deploy
```
Clone inside the Linux filesystem (`~/classroom-copilot`), not under `/mnt/c`:
npm on the mounted Windows drive is slow enough to look broken.

One thing genuinely requires Linux or WSL: `npm run test:workers`, the local
Workers test harness, is a bash script that uses `setsid`, `fuser` and `pkill`.
It is a development tool, not part of deploying.

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

### Verifying the production URL

Ten minutes, once the deploy is live and before the class. Everything here is
manual on purpose: the automated suites run against a local runtime, and the
things that only exist in production — real Hyperdrive, real TLS, real phones —
are exactly what they cannot cover.

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 1 | Real Hyperdrive/Supabase | Start a class on the production URL, then look for the room in Supabase | The row is there |
| 2 | Caching off | `npx wrangler hyperdrive get <id>` | `"disabled": true` |
| 3 | M0 flow, no AI | Poll → answer → reveal → close, pulse, question + upvote, pick, summary | All work; no AI panel |
| 4 | Realtime | Instructor opens a poll; a learner phone is watched | Appears in ~1s, untouched |
| 5 | Reconnect | Leave a learner idle 2 min, lock the phone, unlock | Still live, correct state |
| 6 | Refresh | Reload instructor and learner mid-poll | Same room, same answer, no re-join |
| 7 | Desktop instructor | Instructor view on the teaching laptop | Readable at the back of the room |
| 8 | Presentation screen | `/r/<code>/screen` on the projector | No roster, no names, no individual answers |
| 9 | Physical phone | One iOS and one Android, on mobile data, not Wi-Fi | Join by QR, answer, ask a question |

Item 9 is the one no amount of local testing substitutes for.

**Production URL:** <https://classroom-copilot.mohammad-iqbal1304.workers.dev>

The deployed build is the one the Product Owner last pushed; a revision in this
repository is not live until they deploy it.

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
  PresentationPanel.tsx           the shared screen: open it, and say what is on it
  SectionBar.tsx                  where the class is, and how to move it
  ActivityPanel.tsx               compose and run open-ended exercises
  ResponsesPanel.tsx              the marking pile: review, feedback, reveal
components/learner/               the phone: activity form, materials
lib/
  domain/                         pure classroom rules (no I/O, heavily tested)
  domain/screen.ts                what the presentation screen is showing, and why
  domain/activities.ts            answer fields, and what counts as a valid answer
  domain/links.ts                 http/https only, nothing executable
  domain/csv.ts                   quoting, and defusing spreadsheet formulas
  workflow.ts                     sections, activities, review, timers, materials
  plans.ts                        reusable session plans, owned by a token
  export.ts                       the session as a spreadsheet
  projections.ts                  the privacy boundary: one builder per role
  service.ts                      every mutation, each a short transaction
  auth.ts                         the two token types and how they are checked
  client/useRoomState.ts          realtime transport and fallback
db/migrations/                    schema
scripts/
  preflight/checks.ts             what makes a deploy ready, as pure functions
  cf-preflight.ts                 runs those checks (npm run cf:check)
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
- **Deploys are not run from here.** A hosted instance exists and the Product
  Owner has used it. This environment has no Cloudflare credentials and cannot
  reach `api.cloudflare.com`, so every deploy — including of any revision on
  this branch — is run from their machine, and nothing in this repository has
  been observed running on Cloudflare itself. The steps are in Deployment above
  and `npm run cf:check` verifies the configuration before you try.
- **Workers Paid ($5/month) is required.** The Free plan's 50 subrequests per
  invocation and Hyperdrive's 100k queries/day both break under a single class;
  the reasoning and numbers are under Deployment.
- **Timer expiry is applied by requests, not by a scheduler.** There is no cron
  in this deployment, so a timer's deadline is enforced by the next request
  that touches the room — every read, and every write that a deadline could
  affect, including starting the timer that replaces it. A write settles the
  expiry first and commits it even when the request itself is refused: a late
  answer gets its 409 and the closure it was refused under stays in the
  database. In practice enforcement lands within a poll interval, because
  every connected learner phone and the projector are reading constantly — the
  instructor's browser does not have to be awake. With literally nobody
  connected, closure lands on the next request, which is the first moment it
  can make any difference to anyone.
- **A session plan lives in one browser.** Plans are owned by a token kept in
  the instructor's own `localStorage`, because the product has no accounts.
  Clearing site data loses the list; the plan rows survive but there is no way
  to enumerate them without the token. That is the same trade-off the
  instructor link already makes.
- **The instructor review list is fetched, not streamed.** It refreshes whenever
  the room version moves, which is as live as everything else, but a forty-way
  class pasting SQL would be a large realtime payload and it is deliberately not
  one.
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

## Scope

M0 shipped the live classroom: rooms, polls, pulse, anonymous questions, a
picker, a shared screen and a summary. The **classroom workflow expansion**
added what a taught session actually needs around those — sections, pulse
rounds, open-ended activities with review and feedback, timers, materials,
contextual questions, reusable plans and a fuller summary. Both are described
above; the expansion is additive, and a room created before it behaves exactly
like one created after it.

Still deliberately absent: accounts and SSO, payments, institutions, LMS
integrations, native apps, chat, video, breakout rooms, slide authoring,
leaderboards and badges, learner analytics over time, an SQL execution engine,
automated grading, and any AI that acts on the classroom rather than advising
the instructor. Practice SQL stays in DBeaver and PostgreSQL; final assignments
are still submitted through the LMS.
