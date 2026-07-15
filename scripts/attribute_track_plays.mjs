// Phase 3: attribute imported plays to individual tracks, then roll up
// tracks.play_count. Run AFTER the YT import (plays seeded) and the tracklist
// enrichment (scripts/enrich_tracks.mjs). Idempotent — safe to re-run.
//
// Run: node --env-file=.env.local scripts/attribute_track_plays.mjs

import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER = process.env.OWNER_USER_ID;
if (!SUPA_URL || !KEY || !OWNER) { console.error("Missing Supabase env"); process.exit(1); }

const supabase = createClient(SUPA_URL, KEY, { db: { schema: "stacks" }, auth: { persistSession: false } });

// normalize a track title: drop (feat…)/[remaster], "- 2011 Remaster", punctuation
const normTitle = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, " ")
  .replace(/\s*-\s*((19|20)\d\d\s*)?(remaster(ed)?|mono|stereo|live|single|album|radio|edit|version|mix|take\s*\d+|deluxe|anniversary).*$/i, "")
  .replace(/\s*-\s*(19|20)\d\d.*$/, "")
  .replace(/[^a-z0-9]+/g, "").trim();

async function fetchAll(table, cols, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(cols).eq("owner_id", OWNER).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) { console.error(`read ${table}:`, error.message); process.exit(1); }
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

console.log("Loading tracks + plays…");
const tracks = await fetchAll("tracks", "id, album_id, title");
const plays = await fetchAll("plays", "id, track, album_id", (q) => q.not("album_id", "is", null));
console.log(`${tracks.length} tracks · ${plays.length} album-linked plays`);

// album_id -> [{id, norm}]
const byAlbum = new Map();
for (const t of tracks) {
  if (!byAlbum.has(t.album_id)) byAlbum.set(t.album_id, []);
  byAlbum.get(t.album_id).push({ id: t.id, norm: normTitle(t.title) });
}

// match plays -> track_id
const byTrack = new Map(); // track_id -> [play_id]
let matched = 0;
for (const p of plays) {
  const list = byAlbum.get(p.album_id);
  if (!list) continue;
  const pn = normTitle(p.track);
  if (!pn) continue;
  let hit = list.find((t) => t.norm === pn);
  if (!hit) hit = list.find((t) => t.norm && pn.length >= 4 && (t.norm.startsWith(pn) || pn.startsWith(t.norm)));
  if (!hit) continue;
  matched++;
  if (!byTrack.has(hit.id)) byTrack.set(hit.id, []);
  byTrack.get(hit.id).push(p.id);
}
console.log(`Matched ${matched}/${plays.length} plays to a track (${byTrack.size} distinct tracks).`);

// write plays.track_id via a single bulk RPC per chunk — flatten to
// [play_id, track_id] pairs so it's a handful of calls, not one per track.
const pairs = [];
for (const [trackId, playIds] of byTrack) for (const pid of playIds) pairs.push([pid, trackId]);
let written = 0;
for (let i = 0; i < pairs.length; i += 1000) {
  const chunk = pairs.slice(i, i + 1000);
  const { error } = await supabase.rpc("link_plays_to_tracks", { p_owner: OWNER, p_pairs: chunk });
  if (error) { console.error("link rpc:", error.message); process.exit(1); }
  written += chunk.length;
  console.log(`  …${written}/${pairs.length} plays linked`);
}

console.log("Rolling up play counts…");
const { error: rpcErr } = await supabase.rpc("recompute_track_plays", { p_owner: OWNER });
if (rpcErr) { console.error("rollup rpc:", rpcErr.message); process.exit(1); }

// report: your most-played tracks
const { data: top } = await supabase.from("tracks").select("title, play_count, album_id").gt("play_count", 0).order("play_count", { ascending: false }).limit(20);
const albumIds = [...new Set((top ?? []).map((t) => t.album_id))];
const { data: albs } = await supabase.from("albums").select("id, artist, title").in("id", albumIds);
const aMap = new Map((albs ?? []).map((a) => [a.id, a]));
console.log(`\n-- YOUR MOST-PLAYED TRACKS:`);
for (const t of top ?? []) {
  const a = aMap.get(t.album_id);
  console.log(`   ${String(t.play_count).padStart(4)}  ${a?.artist ?? "?"} - ${t.title}  (${a?.title ?? "?"})`);
}
console.log(`\nDone. Track play counts are live — open any album to see per-track plays.`);
