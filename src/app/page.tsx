import { supabaseServer } from "@/lib/supabase/server";
import StatsPanel from "@/components/StatsPanel";
import InsightCards from "@/components/InsightCards";
import Chat from "@/components/Chat";
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

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-bold">Insights</h2>
          <InsightCards />
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Ask about your library</h2>
          <Chat />
        </div>
      </section>
    </div>
  );
}
