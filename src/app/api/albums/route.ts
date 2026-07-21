import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { natKey, parentGenre } from "@/lib/albums";

// GET /api/albums?q=&parent=&genre=&yearMin=&yearMax=&ratingMin=&ratingMax=
//                 &collection=&releaseType=&unratedOnly=&sort=rating.desc&page=1&pageSize=48
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const supabase = await supabaseServer();

  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 48)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("albums").select("*", { count: "exact" });

  const q = sp.get("q");
  if (q) {
    // PostgREST's .or() syntax treats , ( ) as structure and " \ as quoting, so
    // a search like `(What's the Story)` would 400 unless the value is quoted
    // and stripped of quote characters.
    const safe = q.replace(/[\\"]/g, " ").trim();
    if (safe) {
      query = query.or(
        `artist.ilike."%${safe}%",title.ilike."%${safe}%",comments.ilike."%${safe}%"`
      );
    }
  }

  const eqFilters: [string, string | null][] = [
    ["genre_parent", sp.get("parent")],
    ["genre", sp.get("genre")],
    ["collection_status", sp.get("collection")],
    ["release_type", sp.get("releaseType")],
  ];
  for (const [col, val] of eqFilters) if (val) query = query.eq(col, val);

  const num = (k: string) => (sp.get(k) != null ? Number(sp.get(k)) : null);
  if (num("yearMin") != null) query = query.gte("year", num("yearMin")!);
  if (num("yearMax") != null) query = query.lte("year", num("yearMax")!);
  if (num("ratingMin") != null) query = query.gte("rating", num("ratingMin")!);
  if (num("ratingMax") != null) query = query.lte("rating", num("ratingMax")!);
  if (sp.get("unratedOnly") === "true") query = query.is("rating", null);

  const [col, dir] = (sp.get("sort") ?? "rating.desc").split(".");
  const allowed = ["rating", "year", "listen_count", "artist", "created_at"];
  query = query.order(allowed.includes(col) ? col : "rating", {
    ascending: dir === "asc",
    nullsFirst: false,
  });

  const { data, count, error } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ albums: data, total: count ?? 0, page, pageSize });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  rating: z.number().min(0).max(10).nullable().optional(),
  comments: z.string().max(10_000).nullable().optional(),
  collection_status: z.string().max(100).nullable().optional(),
});

// PATCH /api/albums  { id, rating?, comments?, collection_status? }  — inline edits
export async function PATCH(req: Request) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }
  const { id, ...clean } = parsed.data;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("albums").update(clean).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ album: data });
}

const postSchema = z.object({
  artist: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  release_type: z.string().trim().max(100).optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  genre: z.string().trim().max(100).nullable().optional(),
  rating: z.number().min(0).max(10).nullable().optional(),
  comments: z.string().max(10_000).nullable().optional(),
  collection_status: z.string().trim().max(100).nullable().optional(),
});

// POST /api/albums — manual album entry (the UI path alongside import + chat).
// Dupe-checked; if the album already exists it returns that row with
// already_existed: true and a 200 so the client can point the user at it.
export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }
  const { artist, title, release_type, year, genre, rating, comments, collection_status } = parsed.data;
  const supabase = await supabaseServer();

  const key = natKey(artist, title, year);
  // Pre-check: exact nat_key, or a case-insensitive artist+title match. Mirrors
  // the chat add_album guard so no path can create a silent duplicate.
  const { data: byKey } = await supabase.from("albums").select("*").eq("nat_key", key).limit(1);
  const { data: byName } = await supabase
    .from("albums")
    .select("*")
    .ilike("artist", artist)
    .ilike("title", title)
    .limit(1);
  const existing = byKey?.[0] ?? byName?.[0];
  if (existing) return NextResponse.json({ album: existing, already_existed: true });

  const { data: userRes } = await supabase.auth.getUser();
  const owner = userRes.user?.id;
  if (!owner) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("albums")
    .insert({
      owner_id: owner,
      artist,
      title,
      release_type: release_type || "Album",
      year: year ?? null,
      genre: genre || null,
      genre_parent: parentGenre(genre),
      rating: rating ?? null,
      comments: comments || null,
      collection_status: collection_status || "Wishlist",
      source: "manual",
      nat_key: key,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ album: data, already_existed: false }, { status: 201 });
}
