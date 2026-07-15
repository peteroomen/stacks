-- Fix + extend the play-attribution plumbing.
--
-- 1) link_plays_to_tracks: plays.id is BIGINT, but 0004 cast the pair's play id
--    to uuid — every call failed at runtime with "invalid input syntax for type
--    uuid". Recreate with the correct cast.
--
-- 2) rollup_play: now also attributes the play to a track on the matched album
--    (normalized-title equality) and bumps tracks.play_count, so ListenBrainz
--    scrobbles keep per-track counts fresh without re-running the backfill
--    script. Also made idempotent: a play that already has album_id set is
--    skipped, so re-running the rollup can't double-count listen_count.

create or replace function stacks.link_plays_to_tracks(p_owner uuid, p_pairs jsonb)
  returns integer as $$
declare
  n integer;
begin
  update stacks.plays p
     set track_id = (elem->>1)::uuid
    from jsonb_array_elements(p_pairs) elem
   where p.id = (elem->>0)::bigint
     and p.owner_id = p_owner;
  get diagnostics n = row_count;
  return n;
end; $$ language plpgsql security definer;

alter function stacks.link_plays_to_tracks(uuid, jsonb) set search_path = stacks, public;
grant execute on function stacks.link_plays_to_tracks(uuid, jsonb) to anon, authenticated, service_role;

create or replace function stacks.rollup_play(p_id bigint) returns void as $$
declare
  v_owner  uuid;
  v_artist text;
  v_album  text;
  v_track  text;
  a_id     uuid;
  t_id     uuid;
begin
  -- only unattributed plays; makes re-runs safe (no double listen_count bump)
  select owner_id, artist, coalesce(album, ''), track
    into v_owner, v_artist, v_album, v_track
    from stacks.plays
   where id = p_id and album_id is null;
  if v_owner is null then return; end if;

  select id into a_id
    from stacks.albums al
   where al.owner_id = v_owner
     and lower(al.artist) = lower(v_artist)
     and lower(al.title)  = lower(v_album)
   limit 1;
  if a_id is null then return; end if;

  select id into t_id
    from stacks.tracks t
   where t.album_id = a_id
     and regexp_replace(lower(t.title),  '[^a-z0-9]+', '', 'g')
       = regexp_replace(lower(v_track), '[^a-z0-9]+', '', 'g')
   limit 1;

  update stacks.plays set album_id = a_id, track_id = t_id where id = p_id;
  update stacks.albums set listen_count = listen_count + 1 where id = a_id;
  if t_id is not null then
    update stacks.tracks set play_count = play_count + 1 where id = t_id;
  end if;
end; $$ language plpgsql security definer;

alter function stacks.rollup_play(bigint) set search_path = stacks, public;
grant execute on function stacks.rollup_play(bigint) to anon, authenticated, service_role;
