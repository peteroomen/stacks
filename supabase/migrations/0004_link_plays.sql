-- Phase 3 (perf): bulk-link plays to tracks in one set-based statement.
-- The importer used to issue one UPDATE per track (hundreds of sequential
-- round-trips — slow, and a stalled socket could hang it). This takes an array
-- of [play_id, track_id] pairs as jsonb and applies them all in a single
-- UPDATE, so the script only makes a handful of calls. Returns the row count.

create or replace function stacks.link_plays_to_tracks(p_owner uuid, p_pairs jsonb)
  returns integer as $$
declare
  n integer;
begin
  update stacks.plays p
     set track_id = (elem->>1)::uuid
    from jsonb_array_elements(p_pairs) elem
   where p.id = (elem->>0)::uuid
     and p.owner_id = p_owner;
  get diagnostics n = row_count;
  return n;
end; $$ language plpgsql security definer;

alter function stacks.link_plays_to_tracks(uuid, jsonb) set search_path = stacks, public;
grant execute on function stacks.link_plays_to_tracks(uuid, jsonb) to anon, authenticated, service_role;
