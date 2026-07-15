import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

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
