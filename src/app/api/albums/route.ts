import { NextResponse } from "next/server";
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
  if (q) query = query.or(`artist.ilike.%${q}%,title.ilike.%${q}%,comments.ilike.%${q}%`);

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

// PATCH /api/albums  { id, rating?, comments?, collection_status? }  — inline edits
export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, ...patch } = body ?? {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = await supabaseServer();
  const allowed = ["rating", "comments", "collection_status"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase.from("albums").update(clean).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ album: data });
}
