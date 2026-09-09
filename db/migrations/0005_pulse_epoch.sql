-- Gives the pulse context an identity of its own.
--
-- A quick-start tap carries no round id — there was no round on the learner's
-- screen to name. Validating such a tap by section identity alone cannot tell
-- two visits to the same section apart: leave section A, come back to it, and
-- a tap captured during the first visit still names a section that matches.
-- The epoch is bumped by every navigation and by every explicit round start,
-- and never by anything else, so a no-round tap can be pinned to the exact
-- pulse context its screen showed without unrelated activity (joins,
-- questions, answers) invalidating it the way the room's version counter
-- would.
--
-- Additive: existing rooms start at epoch 0 and the old build ignores the
-- column entirely.

alter table rooms add column pulse_epoch integer not null default 0;
