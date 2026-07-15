-- Phase 3: recompute stacks.tracks.play_count from attributed plays (plays.track_id).
-- Set-based so the importer script can roll up in one call after matching.

create or replace function stacks.recompute_track_plays(p_owner uuid) returns void as $$
begin
  -- zero everyone first, then set matched counts
  update stacks.tracks set play_count = 0 where owner_id = p_owner and play_count <> 0;
  update stacks.tracks t
     set play_count = c.n
    from (
      select track_id, count(*)::int as n
      from stacks.plays
      where owner_id = p_owner and track_id is not null
      group by track_id
    ) c
   where t.id = c.track_id and t.owner_id = p_owner;
end; $$ language plpgsql security definer;

alter function stacks.recompute_track_plays(uuid) set search_path = stacks, public;
grant execute on function stacks.recompute_track_plays(uuid) to anon, authenticated, service_role;
