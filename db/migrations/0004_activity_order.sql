-- Lets an instructor reorder prepared activities.
--
-- `seq` is the order they are shown in and the order a saved plan preserves, so
-- reordering rewrites it. The uniqueness constraint has to be deferrable for
-- that: rewriting a whole block in one statement transiently repeats a value,
-- and shuffling rows through temporary numbers instead would leave an order a
-- concurrent read could observe half-applied.
--
-- Same shape as `sections_room_position_key` in 0003. Additive: no data moves,
-- and the constraint enforces exactly what it did before at commit time.

alter table activities drop constraint activities_room_id_seq_key;
alter table activities
  add constraint activities_room_id_seq_key unique (room_id, seq) deferrable initially deferred;
