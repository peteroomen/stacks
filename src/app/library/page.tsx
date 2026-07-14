import { supabaseServer } from "@/lib/supabase/server";
import LibraryBrowser from "@/components/LibraryBrowser";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const supabase = await supabaseServer();
  // Distinct filter values for the dropdowns (cheap on ~700 rows).
  const { data: rows } = await supabase
    .from("albums")
    .select("genre_parent, genre, release_type, collection_status, year");

  const uniq = (k: string) =>
    Array.from(new Set((rows ?? []).map((r: any) => r[k]).filter(Boolean))).sort();
  const years = (rows ?? []).map((r: any) => r.year).filter(Boolean) as number[];

  const facets = {
    parents: uniq("genre_parent"),
    genres: uniq("genre"),
    releaseTypes: uniq("release_type"),
    collections: uniq("collection_status"),
    yearMin: years.length ? Math.min(...years) : 1950,
    yearMax: years.length ? Math.max(...years) : new Date().getFullYear(),
    total: rows?.length ?? 0,
  };

  return <LibraryBrowser facets={facets} />;
}
