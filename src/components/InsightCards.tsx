"use client";

import { useEffect, useState } from "react";

type Card = { kind: string; payload: any };

export default function InsightCards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/insights").then((r) => r.json()).then((d) => setCards(d.insights ?? []));
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    await fetch("/api/insights", { method: "POST" });
    await load();
    setBusy(false);
  }

  const get = (k: string) => cards.find((c) => c.kind === k)?.payload;
  const revisit = get("revisit_queue");
  const blind = get("blind_spots");
  const run = get("recent_run");
  const recs = get("recommendations");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn btn-sm btn-outline" onClick={refresh} disabled={busy}>
          {busy ? <span className="loading loading-spinner loading-xs" /> : "Refresh insights"}
        </button>
      </div>

      {cards.length === 0 && !busy && (
        <div className="card bg-base-200/40 border border-base-content/10">
          <div className="card-body items-center text-center py-10">
            <p className="text-base-content/60">No insights yet.</p>
            <button className="btn btn-primary btn-sm" onClick={refresh}>Generate insights</button>
          </div>
        </div>
      )}

      {run && (
        <Card accent title={run.title ?? "Lately"}>
          <p className="text-sm text-base-content/80">{run.summary}</p>
        </Card>
      )}
      {revisit && (
        <Card title={revisit.title ?? "Give these another spin"}>
          <ul className="space-y-2">
            {(revisit.items ?? []).map((it: any, i: number) => (
              <li key={i} className="text-sm">
                <span className="font-semibold">{it.album}</span>
                <span className="text-base-content/60"> — {it.why}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {recs && (
        <Card title="You might try">
          <ul className="space-y-2">
            {(recs.items ?? []).map((it: any, i: number) => (
              <li key={i} className="text-sm">
                <span className="font-semibold">{it.album}</span>
                <span className="text-base-content/60"> — {it.why}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {blind && (
        <Card title={blind.title ?? "Blind spots"}>
          <ul className="space-y-2">
            {(blind.items ?? []).map((it: any, i: number) => (
              <li key={i} className="text-sm">
                <span className="font-semibold">{it.area}</span>
                <span className="text-base-content/60"> — {it.why}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`card border ${accent ? "bg-primary/10 border-primary/30" : "bg-base-200/40 border-base-content/10"}`}>
      <div className="card-body p-4">
        <h3 className="font-bold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
