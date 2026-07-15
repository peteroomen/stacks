// Backfill album tracklists into stacks.tracks.
// Deezer (album search -> tracklist with durations); MusicBrainz fallback for
// albums that already have an mbid. Idempotent: skips albums that already have
// tracks, so re-running just fills the gaps.
//
// Run: node --env-file=.env.local scripts/enrich_tracks.mjs

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER = process.env.OWNER_USER_ID;
if (!SUPA_URL || !KEY || !OWNER) { console.error("Missing Supabase env (URL / SERVICE_ROLE_KEY / OWNER_USER_ID)"); process.exit(1); }

const supabase = createClient(SUPA_URL, KEY, { db: { schema: "stacks" }, auth: { persistSession: false } });
const UA = "stacks-album-tracker/1.0 (petertheoomen@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const unsort = (a) => a.replace(/^(.*?),\s*(the|a|an)$/i, "$2 $1");
const akey = (a) => norm(unsort(a));
const natKey = (title, no) => crypto.createHash("sha1").update(`${title.toLowerCase()}|${no ?? ""}`).digest("hex").slice(0, 16);

// strip bracket/symbol junk so "★ [Blackstar]" -> "Blackstar" for free-text search
const stripJunk = (s) => String(s).replace(/[[\]()★]/g, " ").replace(/\s+/g, " ").trim();

// Find the Deezer album. Try a precise field-scoped query first, then fall back
// to a fuzzy free-text query that survives typos ("Paul's Botique", "Kraftwek").
async function deezerFindAlbum(artist, title) {
  const na = akey(artist), nt = norm(title);
  const tokenMatch = (a) => {
    const ra = akey(a.artist?.name || ""), rt = norm(a.title || "");
    return (ra.includes(na) || na.includes(ra)) && (rt.includes(nt) || nt.includes(rt));
  };
  // [query, allowFirstFallback] — the field-scoped query already constrains the
  // album name, so its top hit is safe; the fuzzy one must pass the token guard.
  const attempts = [
    [`artist:"${unsort(artist).replace(/"/g, " ")}" album:"${title.replace(/"/g, " ")}"`, true],
    [stripJunk(`${unsort(artist)} ${title}`), false],
  ];
  for (const [q, allowFirst] of attempts) {
    const s = await fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=8`, { headers: { "User-Agent": UA } });
    if (!s.ok) continue;
    const sd = await s.json();
    if (sd?.error) { await sleep(1500); continue; }
    const data = sd.data ?? [];
    if (!data.length) { await sleep(150); continue; }
    const pick = data.find(tokenMatch) ?? (allowFirst ? data[0] : null);
    if (pick) return pick;
    await sleep(150);
  }
  return null;
}

async function deezerTracklist(artist, title) {
  const pick = await deezerFindAlbum(artist, title);
  if (!pick) return null;
  await sleep(150);
  const a = await fetch(`https://api.deezer.com/album/${pick.id}`, { headers: { "User-Agent": UA } });
  if (!a.ok) return null;
  const ad = await a.json();
  if (ad?.error) return null;
  const tracks = (ad.tracks?.data ?? []).map((t) => ({
    disc_no: t.disk_number ?? 1,
    track_no: t.track_position ?? null,
    title: t.title,
    duration_ms: t.duration ? t.duration * 1000 : null,
  }));
  return { deezerId: String(pick.id), tracks };
}

async function mbTracklist(mbid) {
  const r = await fetch(`https://musicbrainz.org/ws/2/release?release-group=${mbid}&inc=recordings&fmt=json&limit=1&status=official`, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const d = await r.json();
  const rel = (d.releases ?? [])[0];
  if (!rel) return null;
  const tracks = [];
  (rel.media ?? []).forEach((m, di) =>
    (m.tracks ?? []).forEach((t) =>
      tracks.push({
        disc_no: m.position ?? di + 1,
        track_no: Number(t.number) || t.position || null,
        title: t.title,
        duration_ms: t.length ?? null,
      })
    )
  );
  return tracks.length ? { deezerId: null, tracks } : null;
}

// albums that don't have tracks yet
const { data: albums, error } = await supabase.from("albums").select("id, artist, title, mbid, deezer_id").eq("owner_id", OWNER);
if (error) { console.error("DB read failed:", error.message); process.exit(1); }
const { data: existing } = await supabase.from("tracks").select("album_id").eq("owner_id", OWNER);
const haveTracks = new Set((existing ?? []).map((t) => t.album_id));
const todo = albums.filter((a) => !haveTracks.has(a.id));

console.log(`${todo.length} albums need tracklists (of ${albums.length}). Starting...`);
let ok = 0, miss = 0;
for (const [i, a] of todo.entries()) {
  let res = null;
  try { res = await deezerTracklist(a.artist, a.title); } catch { /* ignore */ }
  // some rows have artist/title reversed ("Maggot Brain - Funkadelic"); retry swapped
  if (!res || !res.tracks.length) {
    try { res = await deezerTracklist(a.title, a.artist); } catch { /* ignore */ }
  }
  if ((!res || !res.tracks.length) && a.mbid) {
    try { res = await mbTracklist(a.mbid); } catch { /* ignore */ }
    await sleep(1100); // MusicBrainz: ~1 req/sec
  }
  if (!res || !res.tracks.length) {
    miss++;
    console.log(`  x no tracklist  ${a.artist} - ${a.title}`);
  } else {
    const seen = new Set();
    const rows = res.tracks
      .filter((t) => t.title)
      .map((t) => ({ owner_id: OWNER, album_id: a.id, disc_no: t.disc_no, track_no: t.track_no, title: t.title, duration_ms: t.duration_ms, nat_key: natKey(t.title, t.track_no) }))
      .filter((r) => !seen.has(r.nat_key) && seen.add(r.nat_key));
    const { error: upErr } = await supabase.from("tracks").upsert(rows, { onConflict: "album_id,nat_key", ignoreDuplicates: true });
    if (upErr) { console.log(`  ! ${a.artist} - ${a.title}: ${upErr.message}`); miss++; }
    else {
      ok++;
      if (res.deezerId && res.deezerId !== a.deezer_id) await supabase.from("albums").update({ deezer_id: res.deezerId }).eq("id", a.id);
    }
  }
  await sleep(150);
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${todo.length}  (${ok} enriched, ${miss} missed)`);
}
console.log(`\nDone. ${ok} albums got tracklists, ${miss} missed. Re-run anytime to retry the misses.`);
