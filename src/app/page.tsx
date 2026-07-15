import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import StatsPanel from "@/components/StatsPanel";
import InsightCards from "@/components/InsightCards";
import Greeting from "@/components/Greeting";
import { ytMusicUrl } from "@/lib/yt";
import type { Album } from "@/lib/types";

export const dynamic = "force-dynamic";

// Most recent distinct albums from the plays timeline (scrobbles + backfill).
async function recentlyPlayed(supabase: Awaited<ReturnType<typeof supabaseServer>>) {
  const { data: plays } = await supabase
    .from("plays")
    .select("album_id, listened_at")
    .not("album_id", "is", null)
    .order("listened_at", { ascending: false })
    .limit(80);
  const ids: string[] = [];
  for (const p of plays ?? []) {
    if (p.album_id && !ids.includes(p.album_id)) ids.push(p.album_id);
    if (ids.length >= 8) break;
  }
  if (!ids.length) return [];
  const { data: albums } = await supabase.from("albums").select("*").in("id", ids);
  const byId = new Map((albums ?? []).map((a: Album) => [a.id, a]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as Album[];
}

export default async function Dashboard() {
  const supabase = await supabaseServer();
  const [{ data }, recent] = await Promise.all([
    supabase.from("albums").select("*"),
    recentlyPlayed(supabase),
  ]);
  const albums = (data ?? []) as Album[];

  return (
    <div className="space-y-8">
      <section>
        <Greeting />
        <p className="text-base-content/60">
          {albums.length} albums logged · {albums.filter((a) => a.rating != null).length} rated
        </p>
      </section>

      <StatsPanel albums={albums} />

      {recent.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Recently played</h2>
            <Link href="/library" className="btn btn-ghost btn-sm">Library →</Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {recent.map((a) => (
              <a key={a.id} href={ytMusicUrl(a.artist, a.title)} target="_blank"
                rel="noopener noreferrer" title={`Play ${a.title} on YouTube Music`}
                className="group w-24 shrink-0 space-y-1">
                {a.cover_art_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.cover_art_url} alt="" loading="lazy"
                    className="aspect-square w-full rounded-md object-cover shadow-md
                               group-hover:ring-2 ring-primary transition" />
                ) : (
                  <div className="cover-fallback aspect-square w-full rounded-md shadow-md
                                  group-hover:ring-2 ring-primary transition flex items-center
                                  justify-center">
                    <span className="rating-num text-lg font-black text-base-content/60">
                      {a.rating ?? "?"}
                    </span>
                  </div>
                )}
                <div className="text-[11px] font-semibold truncate">{a.title}</div>
                <div className="text-[10px] text-base-content/60 truncate -mt-1">{a.artist}</div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Insights</h2>
          <Link href="/chat" className="btn btn-ghost btn-sm">Ask about your library →</Link>
        </div>
        <InsightCards />
      </section>
    </div>
  );
}
