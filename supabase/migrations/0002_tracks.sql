-- Track-level: per-album tracklists, per-track ratings, per-track play counts.
-- Additive; lives in the `stacks` schema alongside albums/plays/insights.

create table if not exists stacks.tracks (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  album_id     uuid not null references stacks.albums(id) on delete cascade,
  disc_no      int  not null default 1,
  track_no     int,
  title        text not null,
  duration_ms  int,
  rating       numeric(3,1),        -- optional per-track rating, 0.0-10.0
  comments     text,
  play_count   int  not null default 0,  -- derived from plays (phase 3)
  nat_key      text not null,       -- sha1(lower(title)|track_no) for idempotent enrichment
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (album_id, nat_key)
);
create index if not exists tracks_album_idx on stacks.tracks(album_id);
create index if not exists tracks_owner_idx on stacks.tracks(owner_id);

drop trigger if exists tracks_touch on stacks.tracks;
create trigger tracks_touch before update on stacks.tracks
  for each row execute function stacks.touch_updated_at();

alter table stacks.tracks enable row level security;
drop policy if exists "own tracks" on stacks.tracks;
create policy "own tracks" on stacks.tracks for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- link plays to a specific track (phase 3 attribution)
alter table stacks.plays add column if not exists track_id uuid references stacks.tracks(id) on delete set null;
create index if not exists plays_track_idx on stacks.plays(track_id);

-- cache the Deezer album id so re-enrichment doesn't re-search
alter table stacks.albums add column if not exists deezer_id text;

-- grants (RLS still gates rows)
grant all on stacks.tracks to anon, authenticated, service_role;
