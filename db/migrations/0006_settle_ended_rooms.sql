-- Settles what an ended class left collecting.
--
-- End Class now closes everything still live — open polls, open activities,
-- the open pulse round, any running timer — in the same transaction that ends
-- the room, so an ended class can never look as though it is still taking
-- answers or counting down. Rooms that ended before that change kept whatever
-- happened to be open at the time, and a console or phone reopening one shows
-- a "live" collector nobody can act on and, for an open pulse round, a count
-- that decays as presence expires. This applies the same settlement to the
-- rooms already ended.
--
-- Data-only: no schema changes, every statement is idempotent, writes touch
-- only rooms that are already ended (which no build accepts input for), and
-- both the old and the new build read the settled rows correctly. It is safe
-- to apply while classes are running.

update polls p
set status = 'closed', closed_at = coalesce(r.ended_at, now())
from rooms r
where r.id = p.room_id and r.status = 'ended' and p.status = 'open';

update activities a
set status = 'closed', closed_at = coalesce(r.ended_at, now())
from rooms r
where r.id = a.room_id and r.status = 'ended' and a.status = 'open';

update pulse_rounds pr
set status = 'closed', closed_at = coalesce(r.ended_at, now())
from rooms r
where r.id = pr.room_id and r.status = 'ended' and pr.status = 'open';

update timers t
set status = 'ended', ended_at = coalesce(r.ended_at, now())
from rooms r
where r.id = t.room_id and r.status = 'ended' and t.status <> 'ended';
