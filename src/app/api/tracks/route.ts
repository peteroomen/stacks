import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// GET /api/tracks?album_id=<uuid>  -> tracklist for an album (RLS-scoped to owner)
export async function GET(req: Request) {
  const albumId = new URL(req.url).searchParams.get("album_id");
  if (!albumId) return NextResponse.json({ error: "album_id required" }, { status: 400 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tracks")
    .select("*")
    .eq("album_id", albumId)
    .order("disc_no", { ascending: true })
    .order("track_no", { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ tracks: data ?? [] });
}

// PATCH /api/tracks  { id, rating?, comments? } — rate/note a single track
export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, ...patch } = body ?? {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const allowed = ["rating", "comments"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("tracks").update(clean).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ track: data });
}
