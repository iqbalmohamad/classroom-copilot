# Current Assignment — M0: End Class + Pulse Polish

**Status:** READY FOR IMPLEMENTATION
**Milestone:** M0 — First Classroom
**Target live usage:** September 13, 2026
**Feature freeze:** September 12, 2026 — this assignment must be implemented and through QA before the freeze. After the freeze, only bug fixes from this assignment's QA are allowed.

This replaces the previous M0 implementation assignment, which is complete
(see git history of this file and `README.md` for what shipped). The
engineering priorities and constraints of that assignment still apply and are
restated below where they matter.

---

# Role

You are the implementation engineer for Classroom Copilot. The Product Owner
teaches a real live class with this product on September 13, 2026.

Optimize, in order, for:

1. reliability in a real classroom;
2. mandatory M0 behavior;
3. realtime correctness;
4. refresh/reconnect resilience;
5. mobile learner usability;
6. avoiding unnecessary scope before first classroom use.

Do not introduce optional AI work. Do not start a desktop redesign — a
dedicated desktop UI/UX audit will be created as a separate assignment after
this one passes QA.

---

# Sources of Truth

Read before implementation:

1. `PRD.md` — product intent, scope, principles, milestone boundaries;
2. this `Current Assignment.md` — the active engineering work;
3. `README.md` — what the product does today and how to run and test it.

If they appear inconsistent, do not silently expand scope. Prefer the narrower
interpretation that protects the September 13 classroom delivery.

## Terminology

This assignment uses the product's requested terms **mentor** and **student**.
In this codebase they map exactly to the existing terms:

- **mentor** = instructor (host token, `/r/<CODE>/host`, `role=instructor`);
- **student** = learner (learner token, `/r/<CODE>`, `role=learner`).

Implement using the codebase's existing `instructor`/`learner` vocabulary.
Do not rename identifiers, routes, or roles as part of this assignment.

---

# Scope

Exactly two workstreams. Nothing else.

## Workstream 1 — End Class behavior

### What already exists — verify and build on it, do not rebuild it

- `POST /api/rooms/[code]/end` (`app/api/rooms/[code]/end/route.ts`) →
  `endRoom` in `lib/service.ts`: closes any open poll, sets
  `rooms.status = 'ended'` and `ended_at`, logs the event. The version
  trigger bumps `rooms.version`, so every connected client receives the ended
  snapshot over the existing realtime transport without refresh.
- `assertRoomOpen` (`lib/service.ts`, `lib/workflow.ts`) refuses every
  mutation against an ended room with HTTP 410 and the message
  "This class session has ended." — this is the server-side backstop and it
  already guards polls, pulse, questions, votes, activities, timers,
  materials, sections, and picks.
- All three surfaces already render an ended state: the host console shows a
  notice and disables its panels (`app/r/[code]/host/HostConsole.tsx`), the
  learner view shows "This class has ended. Thanks for taking part." and
  passes `disabled` to every input card (`app/r/[code]/LearnerView.tsx`), and
  the presentation screen shows a closing message
  (`app/r/[code]/screen/PublicView.tsx`).
- Joining an ended room is refused with 410; the instructor's summary stays
  readable after the end (`tests/integration/room-lifecycle.test.ts`); one
  e2e test proves the connected learner flips to ended without refresh
  (`e2e/classroom.spec.ts`, "ends the class cleanly for everyone still
  connected").

The work below is the gap between that and the required behavior.

### Mentor (instructor)

When the mentor's End Class action **succeeds** (the `/end` request returned
success):

1. The class transitions to the ended state (already implemented — keep it).
2. The mentor is automatically taken to the Class Summary view for that class
   (`/r/<CODE>/summary`). Navigate only on a confirmed successful response —
   never optimistically.
3. Already available session results remain visible on the summary: counts,
   poll distributions, pulse rounds, activities and their review states,
   questions, picks — whatever the summary already shows for that class.
4. If some summary data is still being prepared or still loading, show the
   summary's existing loading/processing state ("Loading summary…") rather
   than blocking the navigation or the page. Do not build a new
   summary-preparation pipeline; the summary is computed on read today and
   that stays.
5. The mentor can return to the dashboard (the home page `/`) using the
   normal product flow. The summary currently links back to the console; make
   sure a route back to `/` exists from the post-class flow using the
   existing navigation conventions (a small link/button is enough).

Auto-navigation applies to the mentor's **own successful End Class action in
that tab**, and only to it. A console that merely observes the room become
ended (a second console tab, a console reopened later) shows the existing
ended notice and keeps the summary reachable — it must not be yanked into a
navigation it did not initiate.

### Student (learner)

Without requiring a manual refresh (i.e., delivered through the existing
realtime snapshot):

1. The live class view changes to a clear **Class Ended** state.
2. Show a clear message equivalent to "Your mentor has ended this class."
   Using the product's own vocabulary, the required copy is:
   **"Your instructor has ended this class."** (A short thanks line may
   follow, matching the existing tone.) The current message does not name the
   actor; this one must.
3. Live activities stop accepting new input: poll answers, pulse taps,
   activity submissions and edits, question submission, and upvotes are all
   disabled in the UI (mostly already wired via `disabled={ended}` — verify
   every input, including inside `ActivityCard`). The server's 410 remains
   the backstop for anything in flight.
4. Already submitted answers remain preserved and visible: the student's poll
   answer, their pulse choice, their activity submissions and any private
   feedback on them, and revealed results they could already see must not
   disappear when the class ends.
5. The student can view whatever personal/session summary they are currently
   permitted to see. Today that is exactly what their own view already
   shows — their submissions, feedback, and revealed aggregates. **Do not
   build a new student-facing summary page**, and do not widen student access
   to the instructor summary.
6. The student can return to the appropriate home/exit destination: give the
   ended state a clear way back to the home page `/`, using existing UI
   conventions.

### Ended state must survive re-entry

The ended state must also be correct when the student:

- **refreshes the page** — a student with an existing session for the room
  lands directly in the ended class view (not the join form), with their
  preserved submissions visible;
- **reconnects after losing connection** — the stream or its polling
  fallback delivers the ended snapshot; the ended UI appears without user
  action;
- **reopens the class URL after the class has ended** — same as refresh for
  a student who had joined. A visitor who never joined gets the join surface
  with a clear "this class session has ended" refusal when they try (the 410
  path — verify the join form surfaces its message legibly, especially on a
  phone).

The same re-entry correctness applies to the mentor's console and the
presentation screen: reopening either on an ended class shows the ended
state, never a live-looking one. In particular, an ended class must not
present anything as still collecting or still counting down (open activity,
running timer, open pulse round). Settle these at end time server-side (the
way `endRoom` already closes open polls) or present them as closed in the
ended projections — choose the smallest change that makes every surface and
the summary read correctly; do not build new lifecycle machinery.

### Failure behavior

If the mentor's End Class action fails (network error, server error, denied):

1. do **not** falsely transition anything to ended — no navigation, no ended
   UI. The room state shown must continue to come from the server snapshot,
   never from an assumed success;
2. keep the mentor in the current class view, still live and functional;
3. show an understandable failure state: a visible error that names the
   action and makes clear the class is still running (e.g. "Could not end
   the class — you are still live. Try again."), not a generic toast;
4. allow the mentor to retry: the End Class control stays available and a
   second attempt works. If the first attempt actually succeeded but the
   response was lost, the retry must be harmless (ending an ended room must
   not error in a way that strands the mentor — treat "already ended" as
   success).

### In-progress input decision (explicit, for M0)

Do **not** introduce new draft-persistence functionality for this edge case.
If a student is typing or has selected something but has not submitted it
when the class ends:

- do not auto-submit it;
- do not treat it as a submitted answer;
- disable further live submission as soon as the ended state is received;
- a submit that was already in flight and is refused by the server (410) gets
  the understandable ended message, not a raw error.

Anything already successfully submitted before the class ended must remain
preserved (server-side this is already true; verify the UI never hides it).

## Workstream 2 — Class Pulse polish

### Labels

Keep the existing English labels, but render them consistently as:

- `✅ Got it`
- `🤔 Shaky`
- `🆘 Lost`

Apply this anywhere the pulse choice or result is **shown on screen** to the
mentor or the student:

- the student's three pulse buttons (`app/r/[code]/LearnerView.tsx`);
- the mentor's Class Pulse panel — current round and earlier rounds
  (`components/host/PulsePanel.tsx`);
- the session summary's pulse readouts (`app/r/[code]/summary/SummaryView.tsx`),
  including its print view.

Labels are defined once in `PULSE_LABELS` (`lib/types.ts`); keep a single
source of truth for the on-screen form rather than sprinkling emoji through
components. Two deliberate exceptions, because they are data rather than UI:

- the **CSV export** (`lib/export.ts`) keeps plain-text labels — emoji in CSV
  risks spreadsheet encoding problems for zero classroom value;
- the **AI Class Read prompt** (`lib/ai.ts`) keeps plain-text labels.

Do not change `Shaky` to `Not sure` in this assignment.

### Selected state — more than color alone

The student's currently selected pulse option must be visually obvious
without relying only on color. Today the selection is shown purely by
color/background/border-color change (`.pulse-btn[data-active="true"]` in
`app/globals.css`) plus `aria-pressed`. Add a non-color signal using the
product's existing conventions — an appropriate combination of:

- border weight/treatment;
- shape/background treatment;
- icon/text treatment (the poll answer buttons' ✓ tick, `.answer-tick`, is
  the established convention for "this is yours");
- selected/pressed state (`aria-pressed` stays).

Acceptance heuristic: the selected option must be identifiable in a grayscale
screenshot. Note the label emoji do not count as a selection signal — every
button has one.

Do not redesign the pulse interaction beyond this polish: same three buttons,
same tap-to-change semantics, same rounds/epoch mechanics, same
aggregate-only privacy. Keep the touch targets at their current size or
larger (≥44px), and keep the three buttons fitting a phone width without
overflow with the emoji added.

---

# Explicitly out of scope

Do not include in this assignment:

- broad desktop UI/UX redesign, alternative desktop layouts, or new
  navigation architecture (a dedicated desktop UI/UX audit follows this
  assignment after QA);
- unrelated visual cleanup;
- new AI features, or any change to AI Class Read beyond the label exception
  noted above;
- a new draft-persistence system;
- unrelated summary redesign (the summary changes only as far as Workstream 1
  requires: reachable after end, correct ended reading, a route home);
- renaming `Shaky`;
- refactors not needed to complete this behavior safely;
- anything in `PRD.md` §15 (M0 non-goals) or the standing exclusions in
  `README.md` (no accounts, no LMS, no SQL execution engine, no automated
  grading, no chat or video, no AI that acts on the classroom).

---

# Verification

## Required setup — two simultaneous clients, minimum

Every End Class QA pass runs with at least:

- **one mentor** (instructor console, desktop browser);
- **one student** (learner view, mobile viewport — a real phone or the
  existing Playwright phone profile).

Both connected to the same room at the same time. The existing e2e harness
(`e2e/`) already drives one instructor plus phone-viewport learners
concurrently — extend it; state must arrive over realtime, and no test may
reload a page to make an assertion pass (existing suite rule — keep it,
except in the scenarios that explicitly test refresh/reopen).

## QA checklist — all must pass

1. Mentor ends class successfully (confirm → success response).
2. Mentor lands on the Class Summary for that class automatically, and
   available results are visible (loading state acceptable while it loads).
3. The connected student changes to the Class Ended state — message naming
   the instructor — without manual refresh.
4. The student can no longer submit live activity responses (poll, pulse,
   activity, question, upvote all disabled; a forced/in-flight submit is
   refused with the ended message).
5. Previously submitted responses remain preserved and visible to the
   student (including activity submissions and any feedback) and countable
   in the summary.
6. Student refresh after class ended → ended state, same identity, preserved
   submissions; never the join form for a student who had joined.
7. Student reconnect after class ended (kill the connection, restore it) →
   ended state arrives without user action.
8. Student reopens an already-ended class URL → ended state; a never-joined
   visitor attempting to join gets a clear "session has ended" refusal.
9. End Class failure (simulate: network offline or server 500) does not
   create a false ended state anywhere — mentor stays in the live class with
   a clear failure message; students see no change.
10. Mentor can retry after a failed End Class, and the retry works; retrying
    an already-ended class does not strand the mentor.
11. Pulse labels render as `✅ Got it` / `🤔 Shaky` / `🆘 Lost` on the
    student buttons, the mentor's pulse panel (current and history), and the
    summary.
12. The selected pulse option is distinguishable without relying on color
    (grayscale check), and `aria-pressed` still reports it.
13. Existing mobile learner usability is not materially regressed: no
    horizontal overflow, touch targets ≥44px, and the existing mobile e2e
    checks still pass with the new labels and ended-state UI.

## Automated tests

Preserved from the previous assignment — these categories still apply and the
existing suites must stay green:

- **Unit/integration** (`npm test`): keep every existing test passing
  (labels changed in UI must not break label-based assertions — update
  assertions, never delete coverage). Extend integration coverage where the
  new behavior is server-visible: end-while-in-flight submission refusal;
  ending an already-ended room behaves as success/no-op; ended room settles
  or presents open collectors (activity/timer/pulse round) as closed.
- **Multi-client e2e** (`npm run test:e2e`): extend the existing end-class
  scenario to cover the mentor's auto-navigation to the summary, the
  student's instructor-named ended message, preserved submissions after end,
  and student refresh/reopen of an ended class. Add the failure-path
  scenario (blocked `/end` → no false ended state, retry works) using
  Playwright request interception.
- **Mobile viewport**: the ended state and the new pulse labels verified at
  the existing phone profile (overflow and touch-target checks stay).
- **Full check before handoff**: `npm run verify` (typecheck + unit +
  integration) and `npm run test:e2e` pass; run `npm run test:workers` if the
  environment allows, since Workers is the deployment target.

No schema migration is expected for this assignment. If you find one is
genuinely required, stop and justify it in the report before writing it —
September 13 is close and `README.md` documents why mid-class cutovers are
dangerous.

---

# Acceptance criteria

This assignment is PASS only when:

- every item in the QA checklist above passes with the two-client setup;
- all automated suites pass as described;
- no mandatory M0 behavior regressed (create/join/poll/pulse/questions/
  picker/public view/summary all still work end-to-end);
- no new scope from the out-of-scope list crept in;
- the diff is reviewable: small, focused on the two workstreams, matching
  existing code conventions.

# Stop condition

When the acceptance criteria are met: STOP. Do not continue into desktop
redesign, AI work, or any future milestone. Then report:

1. implementation summary per workstream;
2. files/components changed;
3. tests added or updated, and the results of each suite;
4. any behavior decision made where this document allowed a choice (e.g. how
   open collectors are settled at end time);
5. known limitations or risks remaining for September 13;
6. recommendation: `READY FOR CLASS`, `READY WITH CAVEATS`, or `NOT READY`.
