# Current Assignment — M0: First Classroom

**Status:** READY FOR IMPLEMENTATION  
**Milestone:** M0 — First Classroom  
**Target live usage:** September 13, 2026  
**Feature freeze:** September 12, 2026

---

# Role

You are the primary software engineer responsible for implementing Classroom Copilot M0.

The Product Owner will use this product in a real live class on September 13, 2026.

Prioritize:

1. reliability;
2. classroom usability;
3. speed of delivery;
4. clean enough engineering to continue development later.

Do not optimize for theoretical future scale.

Do not redesign the product.

---

# Sources of Truth

Read before implementation:

1. `PRD.md`
2. this `Current Assignment.md`

Use:

- `PRD.md` for product intent, scope, principles, and milestone boundaries;
- `Current Assignment.md` for active engineering work.

If they appear inconsistent, do not silently expand scope.

Prefer the narrower interpretation that protects the September 13 classroom delivery.

---

# Objective

Implement a deployable browser-based live classroom interaction application.

The Product Owner must be able to:

1. create a room;
2. share a room code or URL;
3. allow learners to join from phones;
4. run realtime polls;
5. observe Class Pulse;
6. receive anonymous questions;
7. select participants;
8. screen-share a clean classroom view;
9. review a basic session summary.

The entire classroom flow must work without AI.

---

# Required User Flows

## Flow A — Instructor starts class

Instructor:

1. opens application;
2. creates a new room;
3. receives room code and join URL;
4. opens Instructor Console;
5. optionally opens Public View in another tab/window.

---

## Flow B — Learner joins

Learner:

1. opens join URL or enters room code;
2. enters display name;
3. joins room;
4. appears in instructor roster;
5. can participate without account creation.

Learner UI must be usable on a typical smartphone.

---

## Flow C — Live poll

Instructor:

1. creates/selects a poll;
2. enters question;
3. selects type;
4. opens poll.

Supported M0 types:

- Yes / No;
- A/B/C/D multiple choice;
- confidence scale 1–5.

Learners:

1. see active question;
2. submit answer;
3. see confirmation.

Instructor:

1. sees response count update;
2. can close poll;
3. can reveal aggregate results.

Aggregate results may be shown on Public View.

Do not publicly reveal individual learner answers.

---

## Flow D — Class Pulse

Learner can choose:

- Got it;
- Shaky;
- Lost.

Instructor sees aggregate current class state.

A learner should be able to update their pulse during the session.

The implementation must prevent a single learner session from artificially counting as multiple simultaneous pulse responses.

---

## Flow E — Anonymous questions

Learner can:

- enter question text;
- submit anonymously;
- view active questions if appropriate;
- upvote a question.

Instructor can:

- see submitted questions;
- see upvote counts;
- mark question answered.

Do not implement threaded discussion.

---

## Flow F — Participant Picker

Instructor can select a joined learner.

Required behavior:

- randomly select from active/joined roster;
- visibly display selected learner;
- retain session selection history;
- avoid immediate repeated selection where practical.

Do not implement AI-based participant selection.

---

## Flow G — Public View

Instructor can open a separate screen suitable for screen sharing.

It should support states such as:

- room join screen;
- active question;
- aggregate poll result;
- participant selected;
- neutral/waiting state.

Public View must never expose:

- instructor-only controls;
- learner private data;
- hidden individual responses;
- sensitive session internals.

---

## Flow H — Session Summary

Instructor can view a basic session summary.

Include where practical:

- session date/time;
- total learners joined;
- poll history;
- aggregate poll results;
- questions submitted;
- class pulse data;
- participant-picker history;
- basic participation counts.

No sophisticated visualization is required.

Clarity is more important than visual complexity.

---

# Realtime Requirements

At minimum, realtime updates must apply to:

- learner joins;
- poll responses;
- poll state;
- class pulse;
- submitted questions;
- question upvotes;
- question answered state;
- participant selection where relevant;
- public-view state.

The instructor must not need to manually refresh during normal classroom use.

---

# State and Persistence

Persist enough state that common browser refreshes do not destroy a live classroom.

At minimum, consider persistence for:

- room;
- instructor session identity;
- learner identity/session;
- roster;
- active poll;
- poll responses;
- pulse;
- questions;
- upvotes;
- picker history;
- session events.

Do not create a complex identity system.

Anonymous/session-based learner identity is sufficient for M0.

---

# UX Requirements

## Instructor

Instructor Console should make common controls obvious.

Do not bury classroom actions behind deep navigation.

Primary classroom controls should be reachable quickly.

---

## Learner

Design mobile-first.

A learner should not need to understand the product.

The expected mental model is:

1. join;
2. see current classroom action;
3. respond.

---

## Public display

Use large readable typography and minimal visual clutter.

Assume it may be viewed through screen share or projector.

---

# Suggested Technical Approach

Choose the simplest reliable architecture.

Preferred direction:

- Next.js;
- TypeScript;
- React;
- Supabase for database and realtime;
- simple production deployment such as Vercel.

Alternatives are acceptable if they materially improve delivery reliability.

Do not introduce:

- microservices;
- Kubernetes;
- Kafka;
- Redis unless genuinely necessary;
- custom realtime protocol;
- separate mobile app;
- complicated infrastructure.

The application should be straightforward for another engineer to run locally.

---

# Data Model Guidance

Exact schema is an engineering decision.

Likely concepts include:

- room/session;
- participant;
- poll;
- poll option;
- poll response;
- class pulse state;
- question;
- question upvote;
- picker event;
- session event.

Keep schema understandable and normalized enough to avoid obvious integrity problems.

Do not over-model future milestones.

---

# AI

AI is NOT required for M0 pass.

Do not begin with AI.

Only consider the optional `AI Class Read` after all mandatory classroom functionality is stable.

If implemented:

Input:

- aggregate poll result;
- aggregate pulse;
- current anonymous questions.

Output:

- maximum a few short sentences;
- advisory only;
- no autonomous action.

Example:

> Understanding appears mixed. Consider another worked example before continuing.

Requirements:

- AI provider key server-side only;
- graceful failure;
- the rest of the application must function when AI is unavailable.

If AI jeopardizes delivery, remove it.

---

# Testing Requirements

Do not rely solely on unit tests.

Before declaring M0 ready, validate actual multi-user behavior.

Required testing categories:

## Automated

Cover important logic and critical paths where practical.

Examples:

- room creation;
- room joining;
- poll lifecycle;
- duplicate response handling;
- pulse update semantics;
- picker logic;
- permission boundaries.

---

## Multi-client simulation

Use multiple browser sessions.

Validate:

- one instructor;
- multiple learners;
- concurrent poll responses;
- realtime updates;
- question upvotes;
- refresh/reconnect.

---

## Mobile

At minimum validate a representative mobile viewport.

Important screens:

- join;
- learner home;
- poll response;
- pulse;
- question submission.

---

## Failure scenarios

Test:

- invalid room code;
- closed/nonexistent room;
- duplicate join;
- instructor refresh;
- learner refresh;
- network interruption where reasonably testable;
- poll closes during response;
- empty participant picker;
- participant disconnects.

---

# Deployment Requirement

M0 is not complete if it only runs locally.

Provide a production-accessible deployment suitable for the September 13 class.

Document:

- production URL;
- environment variables;
- deployment procedure;
- local development instructions;
- database setup/migrations.

No secrets may be committed.

---

# README Requirement

Create/update `README.md` with:

- concise product description;
- stack;
- local setup;
- environment configuration;
- database setup;
- development commands;
- test commands;
- production/deployment notes;
- current M0 scope.

Do not turn README into a product strategy document.

That belongs in `PRD.md`.

---

# Explicit Non-Goals

Do NOT implement:

- subscriptions;
- payment integration;
- complex authentication;
- institution accounts;
- LMS;
- Google Classroom;
- Moodle;
- native apps;
- physical classroom cards;
- QR card scanning;
- computer vision;
- facial recognition;
- attention detection;
- emotion detection;
- student AI tutor;
- AI teaching agent;
- advanced analytics;
- curriculum engine;
- content marketplace;
- leaderboard;
- badge system;
- chat;
- video calls;
- breakout-room system;
- PowerPoint add-in;
- Google Slides add-in;
- browser extension.

Do not pre-implement future milestone features.

---

# Quality Bar

This is a rapid product milestone, not a throwaway prototype.

Acceptable:

- simple architecture;
- limited visual polish;
- small amount of pragmatic technical debt;
- managed services;
- narrow scope.

Not acceptable:

- fragile classroom state;
- obvious security mistakes;
- broken mobile experience;
- fake realtime behavior;
- critical state existing only in one browser's memory;
- undocumented setup;
- features that only work in a happy-path demo.

---

# Delivery Sequence

## September 8

Establish:

- repository/application skeleton;
- chosen stack;
- database;
- room creation;
- room join;
- basic realtime connectivity.

Target state:

> Instructor and learner browsers can join the same room and observe shared realtime state.

---

## September 9

Implement:

- roster;
- polls;
- Class Pulse;
- Participant Picker.

Target state:

> Core classroom interaction works.

---

## September 10

Implement:

- anonymous Q&A;
- upvotes;
- Public View;
- classroom UX cleanup.

Target state:

> Complete live-class flow exists.

---

## September 11

Implement:

- session summary;
- missing persistence/reconnect behavior;
- production hardening;
- optional AI Class Read only if safe.

Target state:

> Feature-complete candidate.

---

## September 12

FEATURE FREEZE.

Only:

- bug fixes;
- usability fixes;
- responsive fixes;
- multi-client testing;
- reconnect testing;
- deployment verification;
- classroom rehearsal.

Do not add speculative features.

---

## September 13

Real classroom usage.

The live class is the primary M0 product test.

---

# Acceptance Criteria

M0 is PASS only when all mandatory criteria are satisfied.

## Product

- instructor can create room;
- learner can join;
- learner experience works on phone;
- roster updates;
- realtime poll works;
- Yes/No works;
- A/B/C/D works;
- confidence scale works;
- poll close/reveal works;
- Class Pulse works;
- anonymous question submission works;
- question upvote works;
- instructor can mark answered;
- participant picker works;
- Public View works;
- session summary works.

## Reliability

- instructor refresh does not destroy session;
- normal learner refresh can recover sufficiently;
- multiple learners can interact concurrently;
- app behaves gracefully on invalid input;
- production deployment is available.

## Privacy

- learner cannot access instructor controls;
- public view does not expose private data;
- individual answers are not publicly revealed accidentally;
- application secrets are not client-exposed.

## Documentation

- README is usable;
- setup is reproducible;
- deployment is documented.

## Final milestone gate

> Product Owner successfully uses Classroom Copilot end-to-end in a real live class on September 13, 2026.

---

# Stop Condition

Once all mandatory acceptance criteria are met and the production build is stable:

STOP.

Do not continue into:

- AI pedagogy;
- school mode;
- monetization;
- advanced analytics;
- future milestones.

Report:

1. implementation summary;
2. architecture/stack selected;
3. files/components added;
4. tests performed;
5. known limitations;
6. production deployment state;
7. remaining risks for September 13;
8. recommendation: `READY FOR CLASS`, `READY WITH CAVEATS`, or `NOT READY`.