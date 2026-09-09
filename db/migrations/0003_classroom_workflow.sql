-- Classroom workflow expansion.
--
-- Adds the structure a taught session actually has — sections, repeatable pulse
-- rounds, open-ended activities with review, timers, materials, contextual
-- questions and reusable plans — without disturbing a single existing row.
--
-- Every change here is additive. Existing rooms keep working untouched: the
-- backfill at the end gives each one a "Section 1" so the new columns are never
-- null in a way the application has to special-case, and moves the pulse each
-- learner currently holds into the new per-round table so no class loses its
-- readout when this is applied mid-day.

-- ------------------------------------------------------------- sections

create table sections (
  id         uuid        primary key default gen_random_uuid(),
  room_id    uuid        not null references rooms (id) on delete cascade,
  position   integer     not null,
  title      text        not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  -- Deferred so a reorder can rewrite every position in one statement rather
  -- than shuffling rows through temporary values that a concurrent read could
  -- observe.
  constraint sections_room_position_key unique (room_id, position) deferrable initially deferred
);

create index sections_room_idx on sections (room_id, position);
alter table sections add constraint sections_id_room_key unique (id, room_id);

-- The section the class is in right now. Nullable so a room is never blocked on
-- having one, though in practice the backfill and createRoom always set it.
alter table rooms
  add column current_section_id uuid references sections (id) on delete set null;

-- --------------------------------------------------------- pulse rounds

-- Pulse used to live in a single column on participants, which meant "ask the
-- room again" could only be implemented by erasing what the room had just said.
-- A round is the unit that gets erased instead: the previous one stays readable
-- for the rest of the session and in the summary.
create table pulse_rounds (
  id         uuid        primary key default gen_random_uuid(),
  room_id    uuid        not null references rooms (id) on delete cascade,
  section_id uuid        references sections (id) on delete set null,
  seq        integer     not null,
  label      text        check (char_length(label) between 1 and 60),
  status     text        not null default 'open' check (status in ('open', 'closed')),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  unique (room_id, seq)
);

-- One round collects at a time, so a learner tapping their phone can never be
-- ambiguous about which question they are answering.
create unique index pulse_rounds_one_open_per_room on pulse_rounds (room_id) where status = 'open';
create index pulse_rounds_section_idx on pulse_rounds (room_id, section_id, seq);
alter table pulse_rounds add constraint pulse_rounds_id_room_key unique (id, room_id);

-- One row per (round, learner): the primary key is the "change your mind, do
-- not add a second vote" rule, exactly as poll_responses works.
create table pulse_responses (
  round_id       uuid        not null,
  participant_id uuid        not null,
  room_id        uuid        not null references rooms (id) on delete cascade,
  value          text        not null check (value in ('got_it', 'shaky', 'lost')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (round_id, participant_id),
  foreign key (round_id, room_id) references pulse_rounds (id, room_id) on delete cascade,
  foreign key (participant_id, room_id) references participants (id, room_id) on delete cascade
);

create index pulse_responses_round_idx on pulse_responses (round_id);

-- ----------------------------------------------------------- activities

-- Polls ask a closed question. An activity asks an open one: type a table name
-- and say why, paste a row count, paste the SQL you ran. `fields` is the shape
-- of the answer form, validated in the application (lib/domain/activities.ts).
create table activities (
  id               uuid        primary key default gen_random_uuid(),
  room_id          uuid        not null references rooms (id) on delete cascade,
  section_id       uuid        references sections (id) on delete set null,
  seq              integer     not null,
  title            text        not null check (char_length(title) between 1 and 200),
  instructions     text        check (char_length(instructions) <= 2000),
  fields           jsonb       not null,
  status           text        not null default 'draft' check (status in ('draft', 'open', 'closed')),
  -- Running an exercise a second time creates a new row rather than reopening
  -- the old one, so the first attempt's answers stay exactly as they were.
  attempt          integer     not null default 1 check (attempt >= 1),
  origin_id        uuid        references activities (id) on delete set null,
  -- Instructor's own answer, for marking by eye. Never leaves an instructor
  -- projection.
  reference_answer text        check (char_length(reference_answer) <= 4000),
  duration_seconds integer     check (duration_seconds is null
                                      or duration_seconds between 10 and 36000),
  created_at       timestamptz not null default now(),
  opened_at        timestamptz,
  closed_at        timestamptz,
  unique (room_id, seq)
);

create index activities_room_idx on activities (room_id, seq desc);
create index activities_section_idx on activities (room_id, section_id);
alter table activities add constraint activities_id_room_key unique (id, room_id);

create table activity_responses (
  id             uuid        primary key default gen_random_uuid(),
  activity_id    uuid        not null,
  participant_id uuid        not null,
  room_id        uuid        not null references rooms (id) on delete cascade,
  answers        jsonb       not null,
  review_state   text        not null default 'pending'
                   check (review_state in ('pending', 'reviewed', 'needs_follow_up')),
  -- Private between instructor and that one learner. No other learner's
  -- projection ever selects this column.
  feedback       text        check (char_length(feedback) <= 2000),
  feedback_at    timestamptz,
  -- Put on the shared screen deliberately, one at a time.
  revealed       boolean     not null default false,
  -- Naming the author on the projector is a separate, explicit decision.
  reveal_author  boolean     not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (activity_id, participant_id),
  foreign key (activity_id, room_id) references activities (id, room_id) on delete cascade,
  foreign key (participant_id, room_id) references participants (id, room_id) on delete cascade
);

create index activity_responses_activity_idx on activity_responses (activity_id);
create index activity_responses_review_idx on activity_responses (room_id, review_state);
-- The projector shows one response at a time; the index makes that a rule
-- rather than a convention the UI has to remember.
create unique index activity_responses_one_revealed_per_room
  on activity_responses (room_id) where revealed;

-- --------------------------------------------------------------- timers

-- The deadline is stored, not counted down in a browser. Every surface derives
-- its countdown from `ends_at`, so an instructor's laptop going to sleep cannot
-- give the class extra time, and a learner refreshing cannot lose any.
create table timers (
  id                uuid        primary key default gen_random_uuid(),
  room_id           uuid        not null references rooms (id) on delete cascade,
  -- Null for a standalone break timer.
  activity_id       uuid        references activities (id) on delete cascade,
  label             text        not null default 'Timer'
                      check (char_length(label) between 1 and 60),
  duration_seconds  integer     not null check (duration_seconds between 10 and 36000),
  status            text        not null default 'running'
                      check (status in ('running', 'paused', 'ended')),
  ends_at           timestamptz,
  remaining_seconds integer,
  -- Close the linked activity's submissions when the time runs out.
  auto_close        boolean     not null default false,
  -- Set when the clock reached zero, as opposed to the instructor ending it.
  expired           boolean     not null default false,
  created_at        timestamptz not null default now(),
  ended_at          timestamptz,
  constraint timers_state_shape check (
    (status = 'running' and ends_at is not null)
    or (status = 'paused' and remaining_seconds is not null)
    or status = 'ended'
  )
);

create unique index timers_one_live_per_room on timers (room_id) where status <> 'ended';
create index timers_room_idx on timers (room_id, created_at desc);

-- ------------------------------------------------------------ materials

create table materials (
  id          uuid        primary key default gen_random_uuid(),
  room_id     uuid        not null references rooms (id) on delete cascade,
  section_id  uuid        references sections (id) on delete set null,
  position    integer     not null,
  title       text        not null check (char_length(title) between 1 and 120),
  -- Only http/https ever reaches here; lib/domain/links.ts rejects every other
  -- scheme before the insert, and this is the backstop.
  url         text        not null check (url ~* '^https?://'),
  note        text        check (char_length(note) <= 300),
  highlighted boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index materials_room_idx on materials (room_id, position);

-- ------------------------------------------------- questions in context

-- Captured at submission time and never rewritten, so moving the class on does
-- not relabel what someone asked twenty minutes ago.
alter table questions add column section_id  uuid references sections (id) on delete set null;
alter table questions add column activity_id uuid references activities (id) on delete set null;

-- --------------------------------------------------- presentation modes

alter table rooms drop constraint rooms_public_mode_check;
alter table rooms add constraint rooms_public_mode_check
  check (public_mode in ('join', 'poll', 'results', 'pick', 'waiting', 'activity', 'response'));

-- --------------------------------------------------------- session plans

-- A reusable plan, owned by a bearer token rather than an account: the product
-- has no sign-up and this must not introduce one. The token is handed to the
-- instructor once and stored only as a digest, exactly like a room's host token.
create table session_plans (
  id             uuid        primary key default gen_random_uuid(),
  token_hash     text        not null,
  title          text        not null check (char_length(title) between 1 and 120),
  payload        jsonb       not null,
  source_room_id uuid        references rooms (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index session_plans_token_idx on session_plans (token_hash);

-- ------------------------------------------------------ version bumping

create trigger sections_touch
  after insert or update or delete on sections
  for each row execute function cc_touch_room();

create trigger pulse_rounds_touch
  after insert or update or delete on pulse_rounds
  for each row execute function cc_touch_room();

create trigger pulse_responses_touch
  after insert or update or delete on pulse_responses
  for each row execute function cc_touch_room();

create trigger activities_touch
  after insert or update or delete on activities
  for each row execute function cc_touch_room();

create trigger activity_responses_touch
  after insert or update or delete on activity_responses
  for each row execute function cc_touch_room();

create trigger timers_touch
  after insert or update or delete on timers
  for each row execute function cc_touch_room();

create trigger materials_touch
  after insert or update or delete on materials
  for each row execute function cc_touch_room();

-- ------------------------------------------------------------------ RLS

alter table sections           enable row level security;
alter table pulse_rounds       enable row level security;
alter table pulse_responses    enable row level security;
alter table activities         enable row level security;
alter table activity_responses enable row level security;
alter table timers             enable row level security;
alter table materials          enable row level security;
alter table session_plans      enable row level security;

-- -------------------------------------------------------------- backfill

-- Give every existing room the section the application now assumes, and point
-- the room at it. Rooms created before this migration are indistinguishable
-- from rooms created after it from here on.
insert into sections (room_id, position, title)
select id, 1, 'Section 1' from rooms;

update rooms r
set current_section_id = s.id,
    -- Keep the version moving so live clients pick the new shape up.
    version = r.version + 1
from sections s
where s.room_id = r.id and s.position = 1;

-- Move the pulse each learner is currently holding into a first round, so a
-- class in progress when this is applied keeps its readout on screen.
insert into pulse_rounds (room_id, section_id, seq, label, status)
select distinct p.room_id, r.current_section_id, 1, 'Round 1', 'open'
from participants p
join rooms r on r.id = p.room_id
where p.pulse is not null;

insert into pulse_responses (round_id, participant_id, room_id, value, created_at, updated_at)
select pr.id, p.id, p.room_id, p.pulse, coalesce(p.pulse_at, now()), coalesce(p.pulse_at, now())
from participants p
join pulse_rounds pr on pr.room_id = p.room_id and pr.seq = 1
where p.pulse is not null;

-- participants.pulse is left in place but is no longer read or written: the
-- round tables are now the only source of truth. Dropping it would make this
-- migration irreversible for no gain, and it is the record of what the pulse
-- was before the move.
comment on column participants.pulse is
  'Deprecated by 0003. Historical value only; the pulse now lives in pulse_responses.';
