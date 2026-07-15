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

// Un-sort sort-name artists: "Beatles, The" -> "The Beatles", "Band, The" -> "The Band".
function normalizeArtist(name) {
  const m = String(name).match(/^(.*?),\s*(the|a|an)\s*$/i);
  return m ? `${m[2]} ${m[1]}`.trim() : name;
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function mbReleaseGroup(artist, title) {
  const q = `artist:"${normalizeArtist(artist).replace(/"/g, " ")}" AND releasegroup:"${title.replace(/"/g, " ")}"`;
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=5`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`MB ${res.status}`);
  const data = await res.json();
  const groups = data["release-groups"] ?? [];
  if (!groups.length) return null;
  // Prefer an exact title match (accept those even at a lower score); otherwise
  // fall back to the top result only if it's a confident match.
  const exact = groups.filter((g) => norm(g.title) === norm(title));
  const pool = exact.length ? exact : groups;
  const pick = pool.find((g) => g["primary-type"] === "Album") ?? pool[0];
  if (!exact.length && (pick.score ?? 0) < 85) return null;
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

// Fuzzy fallback: iTunes Search. Forgiving of spelling (Rumors/Rumours),
// word order (handles swapped artist/title), and bracket junk. Guards against
// junk matches by requiring a shared significant token.
async function itunesCover(artist, title) {
  const term = `${normalizeArtist(artist)} ${title}`.replace(/[[\]()]/g, " ").replace(/\s+/g, " ").trim();
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&media=music&limit=5`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const results = (await res.json()).results ?? [];
  if (!results.length) return null;
  const ourTokens = norm(`${normalizeArtist(artist)} ${title}`).split(" ").filter((t) => t.length >= 4);
  const pick = results.find((r) => {
    const theirs = norm(`${r.artistName ?? ""} ${r.collectionName ?? ""}`);
    return ourTokens.some((t) => theirs.includes(t));
  });
  const art = pick?.artworkUrl100 ?? pick?.artworkUrl60;
  return art ? art.replace(/\/\d+x\d+bb\./, "/600x600bb.") : null;
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
    let mbid = await mbReleaseGroup(a.artist, a.title);
    let cover = mbid ? await caaFront(mbid) : null;
    let src = cover ? "caa" : "";
    if (!cover) { cover = await itunesCover(a.artist, a.title); if (cover) { src = "itunes"; mbid = null; } }
    if (!cover) { console.log(`  ✗ no cover  ${tag}`); missed++; await sleep(1100); continue; }
    const { error: upErr } = await supabase
      .from("albums")
      .update({ cover_art_url: cover, mbid })
      .eq("id", a.id);
    if (upErr) throw new Error(upErr.message);
    console.log(`  ✓ ${src.padEnd(6)} ${tag}`);
    found++;
  } catch (e) {
    console.log(`  ! error     ${tag} — ${e.message}`);
    failed++;
  }
  await sleep(1100); // ~1 req/sec to MusicBrainz
}

console.log(`\nDone. ${found} covered, ${missed} no art/match, ${failed} errored.`);
