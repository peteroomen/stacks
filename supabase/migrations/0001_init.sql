-- Album Tracker ("stacks") — initial schema
-- Single-owner app. Every row is owned by one auth user; RLS restricts to owner.
--
-- Namespaced into its own `stacks` schema so this app can share one Supabase
-- project (Postgres DB) with other personal apps (e.g. budget-app in `public`)
-- without table/function name collisions. See docs/work/2026-07-15-db-schema-namespace.md
-- and docs/work/adding-a-schema.md (the reusable pattern).

create schema if not exists stacks;

create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- albums
create table if not exists stacks.albums (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  artist            text not null,
  title             text not null,
  release_type      text not null default 'Album',
  year              int,
  genre             text,                 -- specific RYM-style subgenre (source of truth)
  genre_parent      text,                 -- derived broad bucket for filtering
  listen_count      int  not null default 0,
  rating            numeric(3,1),         -- 0.0–10.0, nullable (unrated)
  comments          text,
  collection_status text,                 -- Wishlist / Owned / null
  cover_art_url     text,                 -- filled by enrichment job
  mbid              text,                 -- MusicBrainz release-group id
  source            text not null default 'manual',  -- csv | scrobble | manual
  nat_key           text not null,        -- sha1(artist|title|year) for idempotent import
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (owner_id, nat_key)
);

create index if not exists albums_owner_idx        on stacks.albums(owner_id);
create index if not exists albums_genre_parent_idx on stacks.albums(owner_id, genre_parent);
create index if not exists albums_rating_idx       on stacks.albums(owner_id, rating);
create index if not exists albums_year_idx         on stacks.albums(owner_id, year);
-- trigram search on artist/title/comments
create index if not exists albums_artist_trgm on stacks.albums using gin (artist gin_trgm_ops);
create index if not exists albums_title_trgm  on stacks.albums using gin (title  gin_trgm_ops);

-- ---------------------------------------------------------------- plays (scrobbles)
-- Ground-truth listens pulled from ListenBrainz. Track-level; rolled up to albums.
create table if not exists stacks.plays (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  listened_at  timestamptz not null,
  track        text not null,
  artist       text not null,
  album        text,
  recording_mbid text,
  release_mbid   text,
  album_id     uuid references stacks.albums(id) on delete set null,  -- resolved rollup
  source       text not null default 'listenbrainz',
  unique (owner_id, listened_at, track, artist)   -- dedupe on re-poll
);
create index if not exists plays_owner_time_idx on stacks.plays(owner_id, listened_at desc);
create index if not exists plays_album_idx      on stacks.plays(album_id);

-- ---------------------------------------------------------------- insights (cached LLM output)
create table if not exists stacks.insights (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  kind        text not null,   -- revisit_queue | blind_spots | recent_run | recommendations
  payload     jsonb not null,  -- rendered card data
  generated_at timestamptz not null default now(),
  unique (owner_id, kind)      -- one current card per kind; upsert to refresh
);
create index if not exists insights_owner_idx on stacks.insights(owner_id);

-- ---------------------------------------------------------------- updated_at trigger
create or replace function stacks.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists albums_touch on stacks.albums;
create trigger albums_touch before update on stacks.albums
  for each row execute function stacks.touch_updated_at();

-- ---------------------------------------------------------------- RLS
alter table stacks.albums   enable row level security;
alter table stacks.plays    enable row level security;
alter table stacks.insights enable row level security;

drop policy if exists "own albums"   on stacks.albums;
drop policy if exists "own plays"    on stacks.plays;
drop policy if exists "own insights" on stacks.insights;
create policy "own albums"   on stacks.albums   for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own plays"    on stacks.plays    for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own insights" on stacks.insights for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------- rollup helper
-- Attach a play to its album (by fuzzy artist+album match) and bump listen_count.
-- search_path pinned so the security-definer body always resolves stacks.* objects.
create or replace function stacks.rollup_play(p_id bigint) returns void as $$
declare a_id uuid;
begin
  select id into a_id from stacks.albums al
   where al.owner_id = (select owner_id from stacks.plays where id = p_id)
     and lower(al.artist) = lower((select artist from stacks.plays where id = p_id))
     and (al.title is not null
          and lower(al.title) = lower((select coalesce(album,'') from stacks.plays where id = p_id)))
   limit 1;
  if a_id is not null then
    update stacks.plays set album_id = a_id where id = p_id;
    update stacks.albums set listen_count = listen_count + 1 where id = a_id;
  end if;
end; $$ language plpgsql security definer;
alter function stacks.rollup_play(bigint) set search_path = stacks, public;

-- ---------------------------------------------------------------- expose to PostgREST / API
-- The schema must be granted to the API roles AND added to PostgREST's served schemas
-- (see the `alter role authenticator ... pgrst.db_schemas` step, run once per project).
-- RLS still gates every row — anon has no auth.uid() so it reads nothing.
grant usage on schema stacks to anon, authenticated, service_role;
grant all on all tables in schema stacks to anon, authenticated, service_role;
grant all on all sequences in schema stacks to anon, authenticated, service_role;
grant execute on all functions in schema stacks to anon, authenticated, service_role;
alter default privileges in schema stacks grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema stacks grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema stacks grant execute on functions to anon, authenticated, service_role;
