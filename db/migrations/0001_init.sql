-- Classroom Copilot — M0 schema.
--
-- Design notes
--  * All access is server-side only. The browser never holds database credentials,
--    so authorisation lives in the application layer (lib/auth.ts) and RLS is used
--    purely as a deny-by-default backstop against Supabase's PostgREST endpoint.
--  * `rooms.version` is a monotonic counter bumped by triggers on every meaningful
--    change in the room. Realtime clients compare versions to decide when to
--    re-fetch, which keeps the push loop to a single primary-key lookup.
--  * Presence heartbeats deliberately do NOT bump the version (see the WHEN clause
--    on participants_touch_update), otherwise every heartbeat would wake every client.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- rooms

create table rooms (
  id              uuid primary key default gen_random_uuid(),
  code            text        not null unique,
  title           text        not null default 'Class session',
  host_token_hash text        not null,
  status          text        not null default 'open' check (status in ('open', 'ended')),
  public_mode     text        not null default 'join'
                    check (public_mode in ('join', 'poll', 'results', 'pick', 'waiting')),
  version         bigint      not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  ended_at        timestamptz
);

create index rooms_created_at_idx on rooms (created_at desc);

-- Composite unique keys let child tables prove they belong to the same room
-- as their parent via a compound foreign key (cheap referential integrity).
alter table rooms add constraint rooms_id_code_key unique (id, code);

-- ---------------------------------------------------------- participants

create table participants (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid        not null references rooms (id) on delete cascade,
  token_hash    text        not null,
  display_name  text        not null check (char_length(display_name) between 1 and 40),
  pulse         text        check (pulse in ('got_it', 'shaky', 'lost')),
  pulse_at      timestamptz,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (room_id, token_hash)
);

create index participants_room_idx on participants (room_id, joined_at);
create index participants_presence_idx on participants (room_id, last_seen_at desc);
alter table participants add constraint participants_id_room_key unique (id, room_id);

-- ---------------------------------------------------------------- polls

create table polls (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid        not null references rooms (id) on delete cascade,
  seq        integer     not null,
  prompt     text        not null check (char_length(prompt) between 1 and 300),
  kind       text        not null check (kind in ('yes_no', 'multiple_choice', 'confidence')),
  options    jsonb       not null,
  status     text        not null default 'draft' check (status in ('draft', 'open', 'closed')),
  revealed   boolean     not null default false,
  created_at timestamptz not null default now(),
  opened_at  timestamptz,
  closed_at  timestamptz,
  unique (room_id, seq)
);

-- At most one poll may be open in a room at a time.
create unique index polls_one_open_per_room on polls (room_id) where status = 'open';
create index polls_room_idx on polls (room_id, seq desc);
alter table polls add constraint polls_id_room_key unique (id, room_id);

-- One row per (poll, participant): the primary key is the "one answer" rule.
create table poll_responses (
  poll_id        uuid        not null,
  participant_id uuid        not null,
  room_id        uuid        not null references rooms (id) on delete cascade,
  value          text        not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (poll_id, participant_id),
  foreign key (poll_id, room_id) references polls (id, room_id) on delete cascade,
  foreign key (participant_id, room_id) references participants (id, room_id) on delete cascade
);

create index poll_responses_poll_idx on poll_responses (poll_id);

-- ------------------------------------------------------------ questions

create table questions (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid        not null references rooms (id) on delete cascade,
  participant_id uuid,
  body           text        not null check (char_length(body) between 1 and 500),
  is_anonymous   boolean     not null default true,
  status         text        not null default 'open'
                   check (status in ('open', 'answered', 'hidden')),
  created_at     timestamptz not null default now(),
  answered_at    timestamptz,
  foreign key (participant_id, room_id) references participants (id, room_id) on delete set null
);

create index questions_room_idx on questions (room_id, created_at desc);
alter table questions add constraint questions_id_room_key unique (id, room_id);

-- One row per (question, participant): the primary key is the "one upvote" rule.
create table question_votes (
  question_id    uuid        not null,
  participant_id uuid        not null,
  room_id        uuid        not null references rooms (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (question_id, participant_id),
  foreign key (question_id, room_id) references questions (id, room_id) on delete cascade,
  foreign key (participant_id, room_id) references participants (id, room_id) on delete cascade
);

create index question_votes_question_idx on question_votes (question_id);

-- ---------------------------------------------------------------- picks

create table picks (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid        not null references rooms (id) on delete cascade,
  participant_id uuid,
  display_name   text        not null,
  created_at     timestamptz not null default now(),
  foreign key (participant_id, room_id) references participants (id, room_id) on delete set null
);

create index picks_room_idx on picks (room_id, created_at desc);

-- ------------------------------------------------------- session events

-- Lightweight telemetry for the session summary (PRD s21). Not an analytics stack.
create table session_events (
  id         bigserial primary key,
  room_id    uuid        not null references rooms (id) on delete cascade,
  kind       text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index session_events_room_idx on session_events (room_id, id);

-- ------------------------------------------------------ version bumping

create or replace function cc_bump_room_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_bump_version
  before update on rooms
  for each row
  when (old.version = new.version)   -- lets an explicit version write win
  execute function cc_bump_room_version();

create or replace function cc_touch_room() returns trigger
language plpgsql as $$
declare
  target uuid;
begin
  target := coalesce(new.room_id, old.room_id);
  -- The BEFORE trigger on rooms turns this into a version increment.
  update rooms set updated_at = now() where id = target;
  return null;
end;
$$;

create trigger participants_touch_ins_del
  after insert or delete on participants
  for each row execute function cc_touch_room();

-- Presence heartbeats (last_seen_at) must not bump the room version.
create trigger participants_touch_update
  after update on participants
  for each row
  when (old.display_name is distinct from new.display_name
     or old.pulse is distinct from new.pulse)
  execute function cc_touch_room();

create trigger polls_touch
  after insert or update or delete on polls
  for each row execute function cc_touch_room();

create trigger poll_responses_touch
  after insert or update or delete on poll_responses
  for each row execute function cc_touch_room();

create trigger questions_touch
  after insert or update or delete on questions
  for each row execute function cc_touch_room();

create trigger question_votes_touch
  after insert or delete on question_votes
  for each row execute function cc_touch_room();

create trigger picks_touch
  after insert or delete on picks
  for each row execute function cc_touch_room();

-- ------------------------------------------------------------------ RLS
--
-- The application connects as the role that owns these tables, and a table
-- owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set. Enabling RLS with
-- no policies therefore leaves the app unaffected while denying every other
-- role — in particular Supabase's `anon`/`authenticated` PostgREST roles, which
-- would otherwise be able to read these tables straight from the browser.
-- IMPORTANT: run migrations with the same database role the application uses.

alter table rooms          enable row level security;
alter table participants   enable row level security;
alter table polls          enable row level security;
alter table poll_responses enable row level security;
alter table questions      enable row level security;
alter table question_votes enable row level security;
alter table picks          enable row level security;
alter table session_events enable row level security;
