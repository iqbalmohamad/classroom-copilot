-- Fixes an unreachable-but-real integrity fault in 0001.
--
-- questions and picks referenced participants through the compound key
-- (participant_id, room_id) with ON DELETE SET NULL. Postgres sets *every*
-- column of a referencing key to NULL, and both tables declare room_id NOT NULL,
-- so deleting a participant who had asked a question or been picked would fail
-- outright. No route in M0 deletes a participant, so nothing hits this today —
-- but "rows that can never be removed" is exactly the kind of fault that
-- surfaces later during a cleanup, so it is corrected here rather than
-- inherited.
--
-- The author reference becomes a plain single-column foreign key that can be
-- nulled on its own. Room integrity is unaffected: room_id still has its own
-- foreign key to rooms, and the service always writes both from the same
-- authenticated participant.

alter table questions drop constraint questions_participant_id_room_id_fkey;
alter table questions
  add constraint questions_participant_id_fkey
  foreign key (participant_id) references participants (id) on delete set null;

alter table picks drop constraint picks_participant_id_room_id_fkey;
alter table picks
  add constraint picks_participant_id_fkey
  foreign key (participant_id) references participants (id) on delete set null;
