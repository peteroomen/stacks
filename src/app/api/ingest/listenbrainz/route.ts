import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Vercel Cron hits this (see vercel.json). Reads recent listens from ListenBrainz
// (public read API — only the username is needed), dedupes, and rolls up to albums.
// Protected by CRON_SECRET so it can't be triggered by randoms.
export const maxDuration = 60;

const LB_USER = process.env.LISTENBRAINZ_USER;
const OWNER_ID = process.env.OWNER_USER_ID; // the single owner's auth uid

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!LB_USER || !OWNER_ID) {
    return NextResponse.json({ error: "LISTENBRAINZ_USER / OWNER_USER_ID not set" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.listenbrainz.org/1/user/${encodeURIComponent(LB_USER)}/listens?count=200`,
    { headers: { Accept: "application/json" }, cache: "no-store" }
  );
  if (!res.ok) return NextResponse.json({ error: `ListenBrainz ${res.status}` }, { status: 502 });

  const json = await res.json();
  const listens = json?.payload?.listens ?? [];
  const supabase = supabaseAdmin();

  const rows = listens.map((l: any) => {
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
  }).filter((r: any) => r.track && r.artist);

  if (!rows.length) return NextResponse.json({ inserted: 0 });

  // Dedupe on (owner, listened_at, track, artist) via the unique constraint.
  const { data: inserted, error } = await supabase
    .from("plays")
    .upsert(rows, { onConflict: "owner_id,listened_at,track,artist", ignoreDuplicates: true })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Roll new plays up to owned albums (bumps listen_count where matched).
  for (const p of inserted ?? []) await supabase.rpc("rollup_play", { p_id: p.id });

  return NextResponse.json({ fetched: rows.length, inserted: inserted?.length ?? 0 });
}
