import { supabaseServer } from "@/lib/supabase/server";
import RateDeck from "@/components/RateDeck";
import type { Album } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RatePage() {
  const supabase = await supabaseServer();
  // Unrated albums, most-played first — so your untracked YT favourites surface first.
  const { data } = await supabase
    .from("albums")
    .select("*")
    .is("rating", null)
    .order("listen_count", { ascending: false })
    .order("artist", { ascending: true });

  return <RateDeck initial={(data ?? []) as Album[]} />;
}
