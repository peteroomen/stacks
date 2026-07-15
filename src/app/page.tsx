import { supabaseServer } from "@/lib/supabase/server";
import StatsPanel from "@/components/StatsPanel";
import InsightCards from "@/components/InsightCards";
import type { Album } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("albums").select("*");
  const albums = (data ?? []) as Album[];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
          Good evening<span className="text-primary">.</span>
        </h1>
        <p className="text-base-content/60">
          {albums.length} albums logged · {albums.filter((a) => a.rating != null).length} rated
        </p>
      </section>

      <StatsPanel albums={albums} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Insights</h2>
          <a href="/chat" className="btn btn-ghost btn-sm">Ask about your library →</a>
        </div>
        <InsightCards />
      </section>
    </div>
  );
}
