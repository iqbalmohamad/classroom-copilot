# Classroom Copilot — Product Requirements Document

**Status:** Draft v0.1  
**Date:** September 8, 2026  
**Initial Milestone:** M0 — First Classroom  
**Initial Live-Class Target:** September 13, 2026

---

# 1. Product Summary

Classroom Copilot is an interactive teaching platform designed to help instructors understand, in real time, whether learners are following a lesson and decide what to do next.

The product begins as an online-first live-classroom tool, but its longer-term product architecture should support both:

- online teaching;
- in-person teaching.

The core product thesis is not polling, quizzes, audience engagement, or gamification by themselves.

The core thesis is:

> Give instructors real-time evidence of learner understanding and help them choose the next useful teaching action.

The first version will focus on lightweight classroom interaction and instructor visibility.

Later versions may introduce AI-supported pedagogical decision support.

---

# 2. Product Vision

Long-term vision:

> Build an intelligence layer for live teaching that helps instructors observe learning, identify confusion and misconceptions, and adapt instruction in real time.

The product should eventually support educators across domains, including but not limited to:

- technical bootcamps;
- universities;
- schools;
- professional training;
- corporate learning;
- language instruction;
- cohort-based courses;
- certification training.

The product should be globally usable.

Initial product development may begin with Indonesian instructors and learners, but the product itself should be designed as an English-first global SaaS.

---

# 3. Product Principles

## 3.1 Pedagogy-first

The product should eventually organize classroom interaction around teaching objectives and teaching methods rather than merely around feature types.

Example future interaction:

Instead of:

- create poll;
- create quiz;
- create word cloud;

the instructor may choose:

- check understanding;
- surface misconceptions;
- generate discussion;
- build retention;
- increase participation;
- review before continuing.

The platform may then recommend or run an appropriate teaching routine.

---

## 3.2 Teacher remains in control

The system may provide information and recommendations.

It must not position AI as the authority over the instructor.

Long-term AI principle:

> AI advises. The teacher decides.

---

## 3.3 Interaction should support teaching, not distract from it

The product should minimize unnecessary learner screen time.

For online teaching, learner interactions should be quick and lightweight.

For future physical-classroom use, the system should allow interaction methods that do not require every student to continuously use a personal device.

---

## 3.4 Student participation should feel psychologically safe

Anonymous interaction should be supported where appropriate.

The initial product should avoid unnecessary public ranking or public display of individual mistakes.

Leaderboard-style gamification is not a core requirement.

---

## 3.5 Instructor workflows must remain fast

An instructor should not need to stop teaching and operate a complicated dashboard.

Common classroom actions should require very few clicks.

---

## 3.6 Online-first, offline-compatible later

The first implementation will target online/live browser-based classes.

The architecture should not unnecessarily prevent future support for:

- projector mode;
- teacher mobile remote;
- physical response cards;
- offline/local-first classroom sessions;
- formal-school usage.

However, none of these future capabilities are M0 requirements.

---

# 4. Problem Statement

Live instructors repeatedly face questions such as:

- Are learners actually following?
- Is the class ready to move on?
- Are students confused but unwilling to speak?
- Which concepts are causing difficulty?
- Are only a few vocal learners participating?
- Should the instructor explain again, ask another question, create discussion, or continue?
- Which questions from students deserve attention first?

Traditional teaching often provides weak or delayed answers.

Common approaches such as:

- “Does everyone understand?”
- asking for raised hands;
- waiting for students to ask questions;
- calling on one student;
- checking chat manually;

do not reliably represent the understanding of the whole class.

Existing audience-interaction tools help collect responses, but Classroom Copilot aims to eventually go further by connecting learner signals to teaching decisions.

---

# 5. Target Users

## 5.1 Initial primary user

Instructor teaching a live online class.

Examples:

- bootcamp instructor;
- university lecturer;
- professional trainer;
- language instructor;
- cohort-course instructor.

The initial product owner will use the product personally in a real bootcamp class.

---

## 5.2 Secondary user

Learner attending the instructor's live class.

Learners should:

- join quickly;
- require minimal setup;
- not need a full account for M0;
- be able to participate from a phone or browser.

---

## 5.3 Future institutional user

Not part of M0.

Potential future users include:

- bootcamp operators;
- academic departments;
- schools;
- universities;
- corporate L&D teams;
- curriculum leaders.

---

# 6. Core Product Surfaces

The application should conceptually separate three surfaces.

## 6.1 Instructor Console

Private control surface for the instructor.

Contains:

- room/session controls;
- learner roster;
- poll controls;
- class pulse;
- questions;
- participant picker;
- session information.

Private learner-level information must remain here.

---

## 6.2 Learner View

Mobile-friendly browser interface.

Learners should be able to:

- join a room;
- enter a display name;
- answer polls;
- submit class-pulse feedback;
- submit anonymous questions;
- upvote questions.

The learner experience should require minimal navigation.

---

## 6.3 Public / Projector View

A clean presentation surface that may be screen-shared during an online class or projected in a future physical classroom.

It may display:

- join instructions;
- QR code;
- current question;
- timer;
- aggregate poll results;
- discussion instructions.

It must not reveal sensitive or private learner-level information.

---

# 7. M0 — First Classroom

## 7.1 Goal

Build a minimal but reliable live-classroom product that can be used end-to-end in a real class on:

**September 13, 2026.**

M0 is not intended to prove the entire long-term product vision.

M0 exists to answer:

> Does this product materially improve the instructor's experience of teaching a live class?

---

# 8. M0 Required Features

## 8.1 Create Room

Instructor can create a live classroom session.

The system provides:

- short join code;
- join URL;
- QR code if practical.

No complex instructor account system is required for the first classroom if it would jeopardize delivery.

---

## 8.2 Join Room

Learner can join from a browser.

Required input:

- room code or join URL;
- learner display name.

No learner account or password is required.

The learner should enter the room in seconds.

---

## 8.3 Learner Roster

Instructor can see:

- currently joined learners;
- total count;
- connection / presence state where practical.

The roster is private to the instructor.

---

## 8.4 Live Poll

Instructor can launch a question to the class.

M0 must support:

### Yes / No

Example:

> Do you understand this concept so far?

### Multiple Choice

At minimum:

- A;
- B;
- C;
- D.

### Confidence Scale

At minimum:

1 through 5.

Poll results must update in real time.

Instructor must be able to:

- start/open poll;
- close poll;
- reveal aggregate result.

Learners should not be able to submit multiple conflicting answers to a single active poll unless the product explicitly supports changing an answer before close.

---

# 9. Class Pulse

Learners must have a lightweight way to report how they are doing.

Initial states:

- Got it;
- Shaky;
- Lost.

The instructor sees only aggregate results by default.

Example:

- Got it — 72%
- Shaky — 21%
- Lost — 7%

Class Pulse should be easy to access without interrupting the lesson.

Individual pulse history does not need to be exposed in M0.

---

# 10. Anonymous Question Box

Learners can submit questions during the session.

Requirements:

- anonymous submission option;
- text question;
- questions visible to instructor;
- learners may upvote questions;
- instructor can mark a question answered.

The instructor should be able to identify high-interest questions quickly.

M0 does not require threaded discussion.

---

# 11. Participant Picker

Instructor can select a learner to answer or participate.

M0 behavior:

- random selection from joined learners;
- option or default behavior to reduce repeatedly selecting the same learner;
- basic history of previously selected learners during the session.

No AI selection is required.

No weighted pedagogical selection is required.

---

# 12. Public / Projector Mode

A separate display state should be available for screen-sharing.

The public screen should prioritize readability.

It may display:

- room join code;
- QR code;
- active question;
- aggregate poll response;
- timer or discussion prompt where applicable.

It must not display:

- learner-specific mistakes;
- private roster details;
- private instructor notes.

---

# 13. Session Summary

After or during the class, the instructor should be able to view a basic session summary.

M0 summary may include:

- number of learners joined;
- polls asked;
- aggregate poll results;
- class pulse snapshot/history where available;
- learner questions;
- participation count;
- picker history.

Advanced learning analytics are not required.

Export is optional.

---

# 14. AI Scope

AI is strategically important to the long-term vision, but it is not allowed to jeopardize M0 reliability.

## 14.1 M0 AI status

AI is optional for M0.

The realtime classroom experience must work without AI.

If the core classroom functionality is stable early enough, one bounded experimental feature may be added:

### AI Class Read

Input may include:

- current poll result;
- current class pulse;
- current learner questions.

Output should be short, advisory, and non-authoritative.

Example:

> Class understanding looks mixed. A large minority answered incorrectly and confidence is low. Consider another example before moving on.

The feature must clearly behave as a recommendation.

No autonomous classroom action is allowed.

---

# 15. Explicit M0 Non-Goals

Do not implement for M0:

- LMS integration;
- Google Classroom integration;
- Moodle integration;
- Canvas integration;
- school information systems;
- payments;
- subscriptions;
- institutional administration;
- SSO;
- native Android app;
- native iOS app;
- desktop native app;
- physical response cards;
- camera-based card scanning;
- computer vision;
- classroom facial analysis;
- emotion detection;
- automatic attention tracking;
- continuous microphone monitoring;
- AI tutor for learners;
- full lesson-plan generator;
- advanced AI pedagogy engine;
- long-term learner mastery models;
- advanced institution analytics;
- leaderboard;
- badges;
- complex gamification;
- breakout-room orchestration;
- chat system;
- video conferencing;
- slide-authoring system;
- collaborative whiteboard;
- curriculum marketplace.

Do not add speculative features merely because they appear easy.

---

# 16. Real-Time Requirement

Classroom interactions must feel effectively real time.

When a learner:

- joins;
- leaves where detectable;
- answers a poll;
- changes pulse;
- submits a question;
- upvotes a question;

the instructor interface should update promptly without manual refresh.

Exact latency targets do not need formal benchmarking for M0, but normal classroom use should not feel delayed.

---

# 17. Reliability Requirements

Because M0 will be used in a real class, reliability is more important than feature count.

Important scenarios:

- instructor refreshes browser;
- learner refreshes browser;
- temporary network interruption;
- learner reconnects;
- duplicate join attempts;
- learner uses a phone;
- instructor uses desktop browser;
- multiple learners answer simultaneously;
- poll is closed while responses are arriving;
- public display is opened separately.

The application should fail gracefully.

---

# 18. Security and Privacy Principles

M0 may remain simple, but should avoid obviously unsafe patterns.

Requirements:

- learners should not see instructor-only data;
- learners should not modify other learners' submissions;
- public display should not expose private learner data;
- room identifiers should not trivially grant instructor control;
- secrets and API keys must not be exposed in client code;
- AI provider keys, if AI is implemented, must remain server-side.

Long-term formal-school privacy/compliance work is outside M0.

---

# 19. Technology Guidance

Specific stack selection is an engineering decision, subject to simplicity and speed.

Preferred implementation characteristics:

- modern web framework;
- mobile-responsive UI;
- managed realtime backend;
- simple deployment;
- minimal infrastructure operations.

Reasonable examples include:

- Next.js / React;
- Supabase;
- Firebase;
- Vercel or similar deployment.

Do not introduce unnecessary infrastructure such as:

- Kubernetes;
- Kafka;
- microservices;
- complex event infrastructure;
- custom authentication systems;

unless a concrete requirement makes them unavoidable.

---

# 20. Product Success Criteria — M0

M0 passes if:

1. Instructor can create a live session.
2. Learners can join from mobile browsers.
3. Realtime interaction works reliably.
4. Instructor can run polls.
5. Class Pulse works.
6. Anonymous Q&A works.
7. Participant Picker works.
8. Public/projector view is usable.
9. A basic session summary exists.
10. Product survives basic multi-user testing.
11. The Product Owner can use it end-to-end in a real live class on September 13, 2026.

The strongest product validation is:

> After using it in a real class, does the instructor want to use it again?

---

# 21. Initial Product Metrics

M0 should capture enough telemetry to answer, where practical:

- number of learners joined;
- percentage answering at least one interaction;
- poll response rate;
- number of questions submitted;
- number of question upvotes;
- class pulse usage;
- number of participant-picker uses;
- session duration;
- number of interactions run.

Do not build a complicated analytics stack for M0.

Basic event storage is sufficient.

---

# 22. M0 Delivery Policy

Until September 13:

## Feature development

Allowed through September 11.

## September 12

Feature freeze.

Only:

- bug fixing;
- UX fixes;
- mobile testing;
- browser testing;
- multi-user simulation;
- network/reconnect testing;
- deployment verification;
- classroom rehearsal.

No new feature should be introduced on September 12 unless required to unblock real-class usage.

---

# 23. Post-M0 Direction

Do not begin these until M0 classroom evidence is reviewed.

Potential future directions include:

## M1 — Pedagogy Workflows

Examples:

- Peer Instruction;
- Think–Pair–Share;
- retrieval practice;
- hinge questions;
- exit tickets;
- misconception checks.

## M2 — Teaching Intelligence

Examples:

- misconception clustering;
- AI Class Read;
- next-best teaching action;
- teaching-method recommendations.

## M3 — Cohort Intelligence

Examples:

- concept history;
- recurring misconception tracking;
- learner progress;
- cohort analytics.

## M4 — Physical Classroom

Examples:

- teacher mobile remote;
- projector-first interactions;
- response cards;
- offline classroom operation;
- school pilots.

These milestones are directional only.

M0 must not pre-implement them.

---

# 24. Long-Term Product Thesis

The long-term opportunity is not to become another generic polling platform.

The product should aim to evolve from:

live classroom interaction

→ classroom learning signals

→ pedagogy workflows

→ teaching decision support

→ AI teaching copilot

→ institutional learning intelligence.

The core long-term question remains:

> What should the instructor do next, given what the class currently understands?