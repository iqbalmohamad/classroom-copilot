# Current Assignment — M0: Desktop UI/UX Audit

**Status:** READY FOR AUDIT
**Executor:** ChatGPT Work
**Type:** Audit only. This is NOT an implementation assignment.
**Milestone:** M0 — First Classroom
**First real classroom target:** September 13, 2026
**Feature freeze target:** September 12, 2026

This replaces the previous assignment, **M0: End Class + Pulse Polish**, which
is complete and merged behavior as of commit `474ad39` on
`claude/m0-end-class-pulse-polish-y18jlv` (see git history of this file and
`README.md` for what shipped). **That commit is the behavioral baseline for
this audit** — audit the product as it exists there, not an earlier or later
state.

---

# Purpose

This assignment defines the scope, method, and required output of a desktop
UI/UX audit of Classroom Copilot, to be carried out by a separate ChatGPT Work
session.

The audit must inspect the actual implemented desktop experience and
determine:

1. what desktop usability problems actually exist;
2. where they occur;
3. who they affect (instructor, learner, or both);
4. how severe they are;
5. whether they should be addressed before September 13;
6. the smallest reasonable fix for each finding;
7. whether structural redesign is genuinely justified anywhere.

**Do not assume a redesign is necessary.** The audit must prioritize problems
that materially affect first-classroom usability. It must not create
redesign work merely because the current UI could look better.

---

# Sources of truth for the auditor

Read before auditing:

1. `PRD.md` — product intent, scope, principles, milestone boundaries;
2. `README.md` — what the product does today, its surfaces, and its
   terminology;
3. this `Current Assignment.md` — the active audit scope;
4. the rendered application itself (see **Evidence requirement** below) —
   source-code review alone is not sufficient.

## Terminology

The PRD and this document use **instructor** and **learner**. Some earlier
product conversations used **mentor** and **student**; they mean the same
roles. Use the product's own terms (instructor/learner) in the audit output.

---

# Scope

## Surfaces to audit

### Instructor

The instructor console at `/r/<CODE>/host`, and specifically:

- the live class / host console as a whole;
- the current activity area (open-ended exercises: composing, running,
  reviewing);
- polls (composing, opening, live distribution, closing, revealing);
- confidence controls/results where applicable (the confidence 1–5 poll
  type);
- Class Pulse (current round, history, aggregate readout);
- anonymous questions (the queue, upvote counts, marking answered);
- participant picker;
- roster / participant information;
- timers and supporting live controls;
- the End Class affordance;
- the ended-class console (the state the console is in after the class has
  ended, including one reopened later);
- Class Summary (`/r/<CODE>/summary`).

### Learner

The learner view at `/r/<CODE>`, and specifically:

- the live class view as a whole;
- the current activity (answering an open-ended exercise);
- poll answering;
- confidence input;
- Class Pulse (choosing and changing a pulse value);
- anonymous questions (asking, upvoting);
- the ended-class state;
- feedback and revealed-result states currently permitted by the product
  (private instructor feedback on a submission; a poll's revealed
  distribution once the instructor shows it).

### Shared / supporting

Where relevant to either surface above:

- the home/start surface (`/`);
- navigation between live class, summary, and home;
- loading states;
- empty states;
- failure states;
- reconnecting states;
- ended states.

Do not evaluate speculative future features or optional AI functionality
(the AI Class Read panel is explicitly out of scope for this audit).

## Required desktop viewports

Inspect the rendered application at realistic desktop/laptop sizes. At
minimum:

- `1280×720`
- `1366×768`
- `1440×900`
- `1920×1080`

Narrower desktop windows may also be inspected when useful.

Mobile is not the primary subject of this audit, but any recommendation must
not knowingly regress existing learner mobile usability.

---

# Audit dimensions

Evaluate at least the following dimensions. These are lenses to apply across
every surface above, not a separate checklist to run once.

## Information hierarchy

Is the most important classroom task/state visually dominant?

For instructors, consider things such as: what is happening right now;
learner responses; current room state; primary live actions.

For learners, consider: what they are expected to do now.

## Screen-space usage

Inspect: unused horizontal space; unnecessarily narrow content; excessive
vertical stacking; unnecessary scrolling; cramped panels; poor use of
available desktop space.

Do not assume that using more width automatically means better design.

## Action clarity

Review whether primary, secondary, and destructive actions are clearly
distinguishable and appropriately placed.

## Density and readability

Inspect: card density; spacing; typography; grouping; line length; repeated
visual containers; list/table readability.

## Classroom awareness

For instructors, ask whether the interface makes it easy to understand:

- What is happening right now?
- What are learners doing?
- Is anything waiting for my action?
- Who appears to be struggling?
- What should I do next?

For learners, ask:

- What am I expected to do?
- Has my response been accepted?
- Is the class still active?
- What can I do now?

## State clarity

Evaluate how clearly the following states are communicated: loading; empty;
live; submitted; closed; revealed; failed; reconnecting; ended.

Important state should not depend on subtle styling alone.

## Consistency

Review reasonable consistency of: spacing; controls; cards; typography;
status treatment; navigation; terminology.

Do not turn this into a design-system project.

## Accessibility-related usability

Flag obvious issues such as: state communicated only through color; weak
focus visibility; tiny interactive targets; poor hierarchy; visibly weak
contrast; difficult readability.

This is not a formal WCAG audit.

---

# Evidence requirement

The audit must inspect the actual rendered application. Source-code review
alone is insufficient. Use realistic classroom/test states and gather
screenshots or equivalent visual evidence where useful.

Representative states should include, where possible:

- idle live class;
- active poll;
- active activity;
- Class Pulse (with responses recorded);
- questions containing realistic content;
- summary containing results;
- ended class.

Every meaningful finding must identify the actual surface/state where it was
observed. Generic UX recommendations without evidence are not sufficient.

---

# Finding format

Every meaningful finding must contain:

**Finding** — what is wrong.

**Evidence** — where and how it appears in the rendered product (surface,
state, viewport).

**User impact** — how it affects instructor or learner behavior.

**Severity** — use exactly one of:

- `P0 — blocks classroom use`
- `P1 — materially harms classroom operation`
- `P2 — noticeable usability issue`
- `P3 — polish`

**Recommended timing** — use exactly one of:

- `Before Sep 13`
- `After first classroom`

**Smallest reasonable fix** — the minimum intervention that addresses the
issue. Do not default to redesign.

---

# Deadline prioritization

The September 13 first-classroom deadline controls prioritization. Recommend
implementation before the first classroom only when a problem materially
affects:

- instructor ability to operate the class;
- learner ability to understand or respond;
- important state visibility;
- reliability perception;
- severe readability/usability.

Cosmetic modernization, aesthetic improvements, and non-essential layout
optimization should normally wait until after first classroom use.

---

# Alternative layouts

Up to two alternative desktop layout directions may be proposed, but **only
if actual evidence shows a meaningful structural layout problem**. Possible
hypotheses to test against evidence (not conclusions to assume):

- **Instructor** — the current classroom activity receives the dominant
  working area while supporting controls and participant information
  occupy a secondary region.
- **Learner** — the currently expected action receives dominant focus.
- **Summary** — the most decision-useful results appear before supporting
  detail.

These are hypotheses only. Do not force a sidebar, two-column layout, or
structural redesign unless evidence justifies it. Do not implement any
alternative during the audit.

---

# Required final output of the audit

1. Executive assessment of current desktop usability.
2. Evidence-backed findings, in the format above.
3. P0/P1/P2/P3 prioritization of every finding.
4. Explicit `Before Sep 13` vs `After first classroom` classification of
   every finding.
5. Smallest reasonable fix for every finding.
6. One final verdict, exactly one of:
   - `NO DESKTOP CHANGE REQUIRED BEFORE FIRST CLASS`
   - `TARGETED DESKTOP FIXES REQUIRED`
   - `STRUCTURAL DESKTOP REDESIGN JUSTIFIED`
7. If targeted fixes are recommended: a proposed bounded implementation
   scope.
8. If structural redesign is justified: evidence showing why targeted
   CSS/layout changes would be insufficient.

---

# Explicitly out of scope for the audit

The audit must not:

- implement UI changes;
- modify product behavior;
- change End Class behavior;
- change Class Pulse behavior;
- add AI functionality;
- add new learner features;
- redesign anything mobile;
- rebuild the design system;
- perform broad refactoring;
- rewrite `PRD.md`;
- do speculative future-product work.

The audit is analysis and recommendations only. Implementation of any
finding is a separate, later assignment.

---

# Stop condition

The audit is complete when the required final output above has been
produced. It does not implement anything. A subsequent assignment, scoped
from the audit's findings, will cover implementation of any `Before Sep 13`
targeted fixes — bounded the same way this document bounds this one.
