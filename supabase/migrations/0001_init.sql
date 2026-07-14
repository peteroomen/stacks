-- Album Tracker — initial schema
-- Single-owner app. Every row is owned by one auth user; RLS restricts to owner.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- albums
create table if not exists public.albums (
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

create index if not exists albums_owner_idx        on public.albums(owner_id);
create index if not exists albums_genre_parent_idx on public.albums(owner_id, genre_parent);
create index if not exists albums_rating_idx       on public.albums(owner_id, rating);
create index if not exists albums_year_idx         on public.albums(owner_id, year);
-- trigram search on artist/title/comments
create extension if not exists pg_trgm;
create index if not exists albums_artist_trgm on public.albums using gin (artist gin_trgm_ops);
create index if not exists albums_title_trgm  on public.albums using gin (title  gin_trgm_ops);

-- ---------------------------------------------------------------- plays (scrobbles)
-- Ground-truth listens pulled from ListenBrainz. Track-level; rolled up to albums.
create table if not exists public.plays (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  listened_at  timestamptz not null,
  track        text not null,
  artist       text not null,
  album        text,
  recording_mbid text,
  release_mbid   text,
  album_id     uuid references public.albums(id) on delete set null,  -- resolved rollup
  source       text not null default 'listenbrainz',
  unique (owner_id, listened_at, track, artist)   -- dedupe on re-poll
);
create index if not exists plays_owner_time_idx on public.plays(owner_id, listened_at desc);
create index if not exists plays_album_idx      on public.plays(album_id);

-- ---------------------------------------------------------------- insights (cached LLM output)
create table if not exists public.insights (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  kind        text not null,   -- revisit_queue | blind_spots | recent_run | recommendations
  payload     jsonb not null,  -- rendered card data
  generated_at timestamptz not null default now(),
  unique (owner_id, kind)      -- one current card per kind; upsert to refresh
);
create index if not exists insights_owner_idx on public.insights(owner_id);

-- ---------------------------------------------------------------- updated_at trigger
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists albums_touch on public.albums;
create trigger albums_touch before update on public.albums
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.albums   enable row level security;
alter table public.plays    enable row level security;
alter table public.insights enable row level security;

create policy "own albums"   on public.albums   for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own plays"    on public.plays    for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own insights" on public.insights for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------- rollup helper
-- Attach a play to its album (by fuzzy artist+album match) and bump listen_count.
create or replace function public.rollup_play(p_id bigint) returns void as $$
declare a_id uuid;
begin
  select id into a_id from public.albums al
   where al.owner_id = (select owner_id from public.plays where id = p_id)
     and lower(al.artist) = lower((select artist from public.plays where id = p_id))
     and (al.title is not null
          and lower(al.title) = lower((select coalesce(album,'') from public.plays where id = p_id)))
   limit 1;
  if a_id is not null then
    update public.plays set album_id = a_id where id = p_id;
    update public.albums set listen_count = listen_count + 1 where id = a_id;
  end if;
end; $$ language plpgsql security definer;
