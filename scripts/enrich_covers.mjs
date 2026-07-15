// Backfill album cover art: MusicBrainz (release-group MBID) -> Cover Art Archive.
// Fills stacks.albums.cover_art_url + mbid for rows that don't have art yet.
//
// Run (Node >= 20.6, reads .env.local for the Supabase service-role key):
//   node --env-file=.env.local scripts/enrich_covers.mjs
//
// Safe to re-run: only touches rows where cover_art_url IS NULL, so an
// interrupted run just resumes. Respects MusicBrainz's ~1 req/sec limit.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER = process.env.OWNER_USER_ID;
if (!URL || !KEY || !OWNER) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OWNER_USER_ID");
  process.exit(1);
}

// service-role client bypasses RLS; scope every query to the owner explicitly.
const supabase = createClient(URL, KEY, {
  db: { schema: "stacks" },
  auth: { persistSession: false },
});

const UA = "stacks-album-tracker/1.0 (petertheoomen@gmail.com)"; // MusicBrainz requires a real UA
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mbReleaseGroup(artist, title) {
  const q = `artist:"${artist.replace(/"/g, " ")}" AND releasegroup:"${title.replace(/"/g, " ")}"`;
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=3`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`MB ${res.status}`);
  const data = await res.json();
  const groups = data["release-groups"] ?? [];
  if (!groups.length) return null;
  // prefer an Album; fall back to the top-scored result
  const pick = groups.find((g) => g["primary-type"] === "Album") ?? groups[0];
  if ((pick.score ?? 0) < 80) return null; // avoid confident-but-wrong matches
  return pick.id;
}

async function caaFront(mbid) {
  const res = await fetch(`https://coverartarchive.org/release-group/${mbid}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (res.status === 404) return null; // no art for this release group
  if (!res.ok) throw new Error(`CAA ${res.status}`);
  const data = await res.json();
  const front = (data.images ?? []).find((i) => i.front) ?? data.images?.[0];
  if (!front) return null;
  return front.thumbnails?.["500"] ?? front.thumbnails?.large ?? front.image;
}

const { data: albums, error } = await supabase
  .from("albums")
  .select("id, artist, title")
  .eq("owner_id", OWNER)
  .is("cover_art_url", null)
  .order("rating", { ascending: false, nullsFirst: false }); // best-rated first

if (error) {
  console.error("DB read failed:", error.message);
  process.exit(1);
}

console.log(`${albums.length} albums need covers. Starting…\n`);
let found = 0, missed = 0, failed = 0;

for (let i = 0; i < albums.length; i++) {
  const a = albums[i];
  const tag = `[${i + 1}/${albums.length}] ${a.artist} — ${a.title}`;
  try {
    const mbid = await mbReleaseGroup(a.artist, a.title);
    if (!mbid) { console.log(`  ✗ no match  ${tag}`); missed++; await sleep(1100); continue; }
    const cover = await caaFront(mbid);
    if (!cover) { console.log(`  ✗ no art    ${tag}`); missed++; await sleep(1100); continue; }
    const { error: upErr } = await supabase
      .from("albums")
      .update({ cover_art_url: cover, mbid })
      .eq("id", a.id);
    if (upErr) throw new Error(upErr.message);
    console.log(`  ✓ cover     ${tag}`);
    found++;
  } catch (e) {
    console.log(`  ! error     ${tag} — ${e.message}`);
    failed++;
  }
  await sleep(1100); // ~1 req/sec to MusicBrainz
}

console.log(`\nDone. ${found} covered, ${missed} no art/match, ${failed} errored.`);
