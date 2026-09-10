# Current Assignment — M0: Host Console Live-State Hierarchy Fix

**Status:** READY FOR IMPLEMENTATION
**Executor:** Claude Code
**Type:** Bounded pre-classroom implementation assignment
**Milestone:** M0 — First Classroom
**First real classroom target:** September 13, 2026
**Feature freeze target:** September 12, 2026

This assignment replaces **M0: Desktop UI/UX Audit**, committed as `0f3d691`.
The production behavioral baseline remains `474ad39`. Preserve the behavior at
that baseline except for the three explicitly authorized hierarchy changes in
this document.

---

# Audit decision carried forward

The primary desktop audit was performed by ChatGPT Work. A supplemental Codex
audit completed the missing states and rendered the production application with
Playwright at exactly:

- `1280×720`;
- `1366×768`;
- `1440×900`;
- `1920×1080`.

The completed audit gate concluded:

`TARGETED DESKTOP FIXES REQUIRED`

The audits confirmed one material pre-classroom finding:

> **F1 — Preparation and setup displace live classroom work.**

At the two smaller laptop viewports, the active poll's operational controls
fell below or across the fold. At all four viewports, running activity/review
state and Timer/Class Pulse were displaced by preparation, invitation, and
access content. The wider viewports reduced the poll consequence but did not
resolve the remaining hierarchy problem.

No additional P0/P1 issue was found during supplemental verification.
Structural redesign is **not** justified.

The empty Participant Picker feedback issue remains:

- severity: `P2 — noticeable usability issue`;
- timing: `After first classroom`;
- status for this assignment: **explicitly out of scope**.

Do not restart or broaden the audit.

---

# Goal

When an instructor is actively running a class, content representing what is
happening **right now** must appear before content used primarily to prepare a
future action or invite/access the room.

This is a hierarchy correction, not a visual redesign.

Preserve:

- existing functionality;
- the existing two-column desktop structure;
- the existing visual language;
- existing learner behavior;
- existing mobile usability;
- existing realtime behavior;
- existing navigation;
- existing data and state semantics.

Do not create a new dashboard, navigation model, or classroom interaction
model.

---

# Sources of truth

Before implementation, read:

1. `PRD.md` for product intent and milestone constraints;
2. `README.md` for current product behavior and terminology;
3. this document for the only authorized implementation scope;
4. the implementation at behavioral baseline `474ad39`.

If another document or an implementation idea suggests broader work, this
assignment controls. Prefer the narrowest change that satisfies the acceptance
criteria and protects the September 13 classroom.

---

# Authorized implementation scope

This assignment contains **exactly three hierarchy changes**.

## 1. Poll hierarchy

When a poll is active or otherwise has current operational state that the
instructor needs to manage, place the **current poll** and its relevant
operational information/actions before the **new-poll composer** in desktop
host-console reading order.

Existing current-poll content to prioritize includes, where applicable:

- poll prompt;
- response count and results state;
- `Close poll`;
- reveal/show-results action;
- other existing current-poll operational controls.

The instructor must not have to pass a large new-poll preparation form before
reaching the poll already being operated.

Do not redesign poll functionality or add poll features.

## 2. Activity hierarchy

When an activity is running or has responses requiring instructor review,
place the **running/current activity state** before the **activity composer** in
desktop host-console reading order.

Prioritize existing information and actions such as:

- current activity;
- running or closed state;
- response count;
- review entry;
- follow-up indicators;
- existing activity controls.

The audit specifically reproduced the case where an activity was created with
additional options and the expanded, now-empty composer remained above the
running activity. Preparation UI must not unnecessarily displace the live
activity or its review entry.

Use the smallest solution consistent with the current component architecture.
Do not create a new activity workflow or redesign response review.

## 3. Supporting-column live-state hierarchy

In the desktop supporting column, place live classroom controls and signals
ahead of the large invitation/instructor-access content.

Specifically:

1. `Timer` must appear before the invitation/instructor-access panel.
2. `Class Pulse` must appear before the invitation/instructor-access panel.

Invitation and access information must remain available and usable. Do not
remove or weaken:

- the join code;
- learner invitation functionality;
- presentation access;
- instructor access information required by the existing product.

This change is ordering and priority only, not feature removal.

---

# Implementation constraints

- Keep the existing two-column desktop host-console structure.
- Reuse the current components, actions, state, and styling wherever possible.
- Do not introduce a new dashboard, sidebar, tab system, or modal workflow.
- Do not change poll, activity, Timer, Pulse, invitation, access, End Class, or
  Summary semantics.
- Do not change APIs, persistence, migrations, authorization, or room-state
  contracts unless an unavoidable implementation blocker is demonstrated.
- Do not make unrelated visual-polish or refactoring changes.
- Do not include the Participant Picker P2 issue.
- Do not alter learner-facing functionality as part of this assignment.

---

# Responsive behavior

Validate the implementation at exactly:

- `1280×720`;
- `1366×768`;
- `1440×900`;
- `1920×1080`.

The two smaller laptop sizes are especially important because the audit found
the strongest operational consequence there. Do not infer one viewport's
result from another; render and inspect all four.

## Mobile protection

Do not knowingly regress learner mobile behavior.

Also inspect whether changing host-console component or DOM order affects a
narrow/mobile host layout. Prefer the smallest responsive implementation that
improves desktop hierarchy without creating an inferior narrow layout. Do not
introduce a broad responsive redesign.

---

# Acceptance criteria

The implementation is complete only when all of the following are satisfied:

1. At `1280×720`, current poll state and its operational controls receive
   higher reading priority than the new-poll composer.
2. At `1366×768`, the same hierarchy holds.
3. At `1440×900`, the same hierarchy remains coherent.
4. At `1920×1080`, the same hierarchy remains coherent.
5. A running activity and its response/review entry appear before the activity
   composer.
6. An expanded or empty activity composer does not unnecessarily push the
   running activity below preparation UI.
7. Timer appears before the invitation/instructor-access panel in the desktop
   supporting column.
8. Class Pulse appears before the invitation/instructor-access panel.
9. Invitation and access functionality remain available.
10. Existing poll behavior is unchanged.
11. Existing activity behavior is unchanged.
12. Existing Timer behavior is unchanged.
13. Existing Pulse behavior is unchanged.
14. Existing End Class behavior is unchanged.
15. Existing realtime behavior is unchanged.
16. Existing Summary and navigation behavior is unchanged.
17. The existing learner experience is not materially changed.
18. Existing automated test suites remain green.

---

# Verification requirements

Source review and automated assertions alone are insufficient. Inspect the
rendered result with the repository's existing browser automation/Playwright
capability where practical.

At each of the four required desktop viewports, verify a populated live class
containing at minimum:

- a current/open poll and its operational controls;
- a running activity with at least one response/review state;
- an active or populated Class Pulse;
- a Timer;
- invitation and instructor-access content.

Record reliable rendered evidence for each viewport. Confirm the intended
reading order and whether the important current-state controls can be reached
without passing the preparation/setup content they govern.

Also verify:

- a narrow/mobile host layout after any DOM-order change;
- representative learner mobile behavior;
- End Class behavior;
- Summary and navigation;
- realtime propagation for the affected live states;
- all existing automated test suites relevant to the changed components.

If validation reveals an unrelated issue, report it separately. Do not expand
this implementation to fix it.

---

# Explicitly out of scope

Do not:

- perform another broad UI/UX audit;
- structurally redesign the instructor console;
- create a new dashboard or interaction model;
- change product functionality;
- add new poll, activity, Timer, Pulse, invitation, or access features;
- implement the Participant Picker P2 finding;
- change learner-facing workflows;
- change the Public/Projector experience except where existing behavior must be
  preserved and verified;
- change End Class or Summary behavior;
- change APIs, database schema, migrations, deployment configuration, or
  production infrastructure;
- bundle unrelated cleanup, refactoring, styling, or cosmetic modernization;
- deploy as part of this assignment.

---

# Required implementation report

When implementation is complete, report:

1. files changed;
2. how each of the three authorized hierarchy changes was implemented;
3. rendered verification result at each required viewport;
4. narrow/mobile host-layout result;
5. learner mobile protection result;
6. automated tests run and their results;
7. confirmation that invitation/access, End Class, realtime, Summary, and
   navigation behavior remain intact;
8. any blocker or acceptance criterion not satisfied;
9. confirmation that no out-of-scope work was included.

Stop after this bounded assignment. Do not begin broader redesign or backlog
work.
