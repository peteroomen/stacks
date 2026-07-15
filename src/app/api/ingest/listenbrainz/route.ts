import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Vercel Cron hits this (see vercel.json). Reads recent listens from ListenBrainz
// (public read API — only the username is needed), dedupes, and rolls up to albums.
// Protected by CRON_SECRET so it can't be triggered by randoms.
export const maxDuration = 60;

const LB_USER = process.env.LISTENBRAINZ_USER;
const OWNER_ID = process.env.OWNER_USER_ID; // the single owner's auth uid

// ListenBrainz clamps count to 100 per request, so we page forward from the
// newest play we've already stored (min_ts) instead of hoping one fetch covers
// everything since the last run. Page cap keeps a cold start bounded.
const LB_PAGE_SIZE = 100;
const LB_MAX_PAGES = 5;

type LbListen = {
  listened_at: number;
  track_metadata?: {
    track_name?: string;
    artist_name?: string;
    release_name?: string;
    mbid_mapping?: { recording_mbid?: string; release_mbid?: string };
  };
};

async function fetchListensSince(minTs: number | null): Promise<LbListen[] | null> {
  const all: LbListen[] = [];
  let since = minTs;
  for (let page = 0; page < LB_MAX_PAGES; page++) {
    const params = new URLSearchParams({ count: String(LB_PAGE_SIZE) });
    if (since != null) params.set("min_ts", String(since));
    const res = await fetch(
      `https://api.listenbrainz.org/1/user/${encodeURIComponent(LB_USER!)}/listens?${params}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const batch: LbListen[] = json?.payload?.listens ?? [];
    all.push(...batch);
    if (batch.length < LB_PAGE_SIZE) break;
    since = Math.max(...batch.map((l) => l.listened_at));
  }
  return all;
}

export async function GET(req: Request) {
  // Fail closed: without a configured secret this endpoint stays locked.
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!LB_USER || !OWNER_ID) {
    return NextResponse.json({ error: "LISTENBRAINZ_USER / OWNER_USER_ID not set" }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  // Resume from the newest ListenBrainz play we already have.
  const { data: last } = await supabase
    .from("plays")
    .select("listened_at")
    .eq("owner_id", OWNER_ID)
    .eq("source", "listenbrainz")
    .order("listened_at", { ascending: false })
    .limit(1);
  const minTs = last?.[0]
    ? Math.floor(new Date(last[0].listened_at).getTime() / 1000)
    : null;

  const listens = await fetchListensSince(minTs);
  if (listens == null) return NextResponse.json({ error: "ListenBrainz fetch failed" }, { status: 502 });

  const rows = listens.map((l) => {
    const md = l.track_metadata ?? {};
    const mbid = md.mbid_mapping ?? {};
    return {
      owner_id: OWNER_ID,
      listened_at: new Date(l.listened_at * 1000).toISOString(),
      track: md.track_name ?? "",
      artist: md.artist_name ?? "",
      album: md.release_name ?? null,
      recording_mbid: mbid.recording_mbid ?? null,
      release_mbid: mbid.release_mbid ?? null,
      source: "listenbrainz",
    };
  }).filter((r) => r.track && r.artist);

  if (!rows.length) return NextResponse.json({ fetched: 0, inserted: 0 });

  // Dedupe on (owner, listened_at, track, artist) via the unique constraint.
  const { data: inserted, error } = await supabase
    .from("plays")
    .upsert(rows, { onConflict: "owner_id,listened_at,track,artist", ignoreDuplicates: true })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Roll new plays up to owned albums (bumps listen_count + track play_count where matched).
  for (const p of inserted ?? []) await supabase.rpc("rollup_play", { p_id: p.id });

  return NextResponse.json({ fetched: rows.length, inserted: inserted?.length ?? 0 });
}
