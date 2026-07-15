import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Vercel Cron hits this (see vercel.json). Fills cover_art_url + mbid for albums
// that don't have art yet: MusicBrainz release-group MBID -> Cover Art Archive.
// Batched with a wall-clock budget so it stays within the function limit; runs
// again next day (idempotent, only touches nulls). The one-off local backfill
// (scripts/enrich_covers.mjs) does the bulk faster; this keeps it topped up.
export const maxDuration = 60;

const OWNER_ID = process.env.OWNER_USER_ID;
const UA = "stacks-album-tracker/1.0 (petertheoomen@gmail.com)";
const BUDGET_MS = 50_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "Beatles, The" -> "The Beatles" (artists are stored sort-name style).
function normalizeArtist(name: string) {
  const m = name.match(/^(.*?),\s*(the|a|an)\s*$/i);
  return m ? `${m[2]} ${m[1]}`.trim() : name;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function mbReleaseGroup(artist: string, title: string): Promise<string | null> {
  const q = `artist:"${normalizeArtist(artist).replace(/"/g, " ")}" AND releasegroup:"${title.replace(/"/g, " ")}"`;
  const res = await fetch(
    `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=5`,
    { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const groups: any[] = data["release-groups"] ?? [];
  if (!groups.length) return null;
  const exact = groups.filter((g) => norm(g.title) === norm(title));
  const pool = exact.length ? exact : groups;
  const pick = pool.find((g) => g["primary-type"] === "Album") ?? pool[0];
  if (!exact.length && (pick.score ?? 0) < 85) return null;
  return pick.id as string;
}

async function caaFront(mbid: string): Promise<string | null> {
  const res = await fetch(`https://coverartarchive.org/release-group/${mbid}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null; // 404 = no art for this release group
  const data = await res.json();
  const front = (data.images ?? []).find((i: any) => i.front) ?? data.images?.[0];
  if (!front) return null;
  return front.thumbnails?.["500"] ?? front.thumbnails?.large ?? front.image ?? null;
}

// Fuzzy fallback: iTunes Search. Forgiving of spelling, word order, bracket junk.
async function itunesCover(artist: string, title: string): Promise<string | null> {
  const term = `${normalizeArtist(artist)} ${title}`.replace(/[[\]()]/g, " ").replace(/\s+/g, " ").trim();
  const res = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&media=music&limit=5`,
    { headers: { "User-Agent": UA }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const results: any[] = (await res.json()).results ?? [];
  if (!results.length) return null;
  const ourTokens = norm(`${normalizeArtist(artist)} ${title}`).split(" ").filter((t) => t.length >= 4);
  const pick = results.find((r) => {
    const theirs = norm(`${r.artistName ?? ""} ${r.collectionName ?? ""}`);
    return ourTokens.some((t) => theirs.includes(t));
  });
  const art = pick?.artworkUrl100 ?? pick?.artworkUrl60;
  return art ? art.replace(/\/\d+x\d+bb\./, "/600x600bb.") : null;
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!OWNER_ID) return NextResponse.json({ error: "OWNER_USER_ID not set" }, { status: 400 });

  const limit = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 40)));
  const supabase = supabaseAdmin();
  const { data: albums, error } = await supabase
    .from("albums")
    .select("id, artist, title")
    .eq("owner_id", OWNER_ID)
    .is("cover_art_url", null)
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const started = Date.now();
  let processed = 0,
    found = 0,
    missed = 0;
  for (const a of albums ?? []) {
    if (Date.now() - started > BUDGET_MS) break;
    processed++;
    try {
      const mbid = await mbReleaseGroup(a.artist, a.title);
      const cover = (mbid ? await caaFront(mbid) : null) ?? (await itunesCover(a.artist, a.title));
      if (cover) {
        await supabase
          .from("albums")
          .update({ cover_art_url: cover, mbid: mbid ?? null })
          .eq("id", a.id);
        found++;
      } else missed++;
    } catch {
      missed++;
    }
    await sleep(1100); // ~1 req/sec to MusicBrainz
  }

  return NextResponse.json({ processed, found, missed, batch: albums?.length ?? 0 });
}
