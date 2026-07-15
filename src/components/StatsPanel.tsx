"use client";

import type { Album } from "@/lib/types";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
} from "recharts";

// Dark tooltip surface with light text — Recharts defaults to near-black text,
// which is unreadable on our dark background when a bar is hovered/tapped.
const TOOLTIP = {
  contentStyle: {
    background: "var(--color-base-100)",
    border: "1px solid color-mix(in oklch, var(--color-base-content) 12%, transparent)",
    borderRadius: 8,
    color: "var(--color-base-content)",
  },
  labelStyle: { color: "var(--color-base-content)" },
  itemStyle: { color: "var(--color-base-content)" },
} as const;

export default function StatsPanel({ albums }: { albums: Album[] }) {
  const byParent = tally(albums.map((a) => a.genre_parent ?? "Unknown"));
  const parentData = Object.entries(byParent)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const ratings = albums.map((a) => a.rating).filter((r): r is number => r != null);
  // Buckets span 4–10 by default but extend down to the lowest actual rating,
  // so nothing is silently dropped from the histogram.
  const lowest = ratings.length ? Math.min(4, Math.floor(Math.min(...ratings) * 2) / 2) : 4;
  const buckets: Record<string, number> = {};
  for (let b = lowest; b <= 10; b += 0.5) buckets[b.toFixed(1)] = 0;
  ratings.forEach((r) => {
    const k = Math.min(10, Math.max(lowest, Math.round(r * 2) / 2)).toFixed(1);
    if (k in buckets) buckets[k]++;
  });
  const ratingData = Object.entries(buckets).map(([name, value]) => ({ name, value }));

  const avg = ratings.length ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1) : "—";
  const topDecade = mode(albums.filter((a) => a.year).map((a) => `${Math.floor(a.year! / 10) * 10}s`));

  return (
    <section className="space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Stat label="Albums" value={String(albums.length)} />
        <Stat label="Avg rating" value={avg} />
        <Stat label="Artists" value={String(new Set(albums.map((a) => a.artist)).size)} />
        <Stat label="Top decade" value={topDecade ?? "—"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="By genre">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={parentData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={82}
                tick={{ fontSize: 11, fill: "currentColor" }} />
              <Tooltip cursor={{ fill: "transparent" }} contentStyle={TOOLTIP.contentStyle}
                labelStyle={TOOLTIP.labelStyle} itemStyle={TOOLTIP.itemStyle} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {parentData.map((_, i) => <Cell key={i} fill="var(--color-primary)" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Rating distribution">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ratingData}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "currentColor" }} interval={1} />
              <YAxis hide />
              <Tooltip cursor={{ fill: "transparent" }} contentStyle={TOOLTIP.contentStyle}
                labelStyle={TOOLTIP.labelStyle} itemStyle={TOOLTIP.itemStyle} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="var(--color-secondary)" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card bg-base-200/60 border border-base-content/10">
      <div className="card-body p-4">
        <div className="text-xs uppercase tracking-wide text-base-content/50">{label}</div>
        <div className="text-2xl font-black rating-num">{value}</div>
      </div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card bg-base-200/40 border border-base-content/10">
      <div className="card-body p-4">
        <h3 className="text-sm font-semibold text-base-content/70">{title}</h3>
        {children}
      </div>
    </div>
  );
}
function tally(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}
function mode(xs: string[]) {
  const t = tally(xs); let best: string | null = null, n = -1;
  for (const [k, v] of Object.entries(t)) if (v > n) { best = k; n = v; }
  return best;
}
