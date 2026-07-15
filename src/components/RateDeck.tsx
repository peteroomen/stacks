"use client";

import { useCallback, useEffect, useState } from "react";
import type { Album } from "@/lib/types";
import { ytMusicUrl } from "@/lib/yt";
import { Vinyl } from "@/components/Vinyl";

const COLLECTIONS = ["Owned", "Wishlist"];

export default function RateDeck({ initial }: { initial: Album[] }) {
  const [queue] = useState<Album[]>(initial);
  const [i, setI] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [collection, setCollection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rated, setRated] = useState(0);

  const album = queue[i];
  const done = i >= queue.length;

  const reset = useCallback((a?: Album) => {
    setRating(a?.rating ?? null);
    setNote(a?.comments ?? "");
    setCollection(a?.collection_status ?? null);
  }, []);

  // load fields when the card changes
  useEffect(() => { reset(queue[i]); }, [i, queue, reset]);

  const advance = useCallback(() => setI((n) => n + 1), []);

  const save = useCallback(async () => {
    if (!album || rating == null || saving) return;
    setSaving(true);
    try {
      await fetch("/api/albums", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: album.id,
          rating,
          comments: note || null,
          collection_status: collection || null,
        }),
      });
      setRated((n) => n + 1);
      advance();
    } finally {
      setSaving(false);
    }
  }, [album, rating, note, collection, saving, advance]);

  // keyboard: digits set rating, arrows nudge, Enter saves, → skips
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const inField = el.tagName === "TEXTAREA" || el.tagName === "INPUT";
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !inField)) { e.preventDefault(); save(); return; }
      if (inField) return;
      if (/^[0-9]$/.test(e.key)) setRating(e.key === "0" ? 10 : Number(e.key));
      else if (e.key === "ArrowUp") setRating((r) => Math.min(10, (r ?? 0) + 0.5));
      else if (e.key === "ArrowDown") setRating((r) => Math.max(0, (r ?? 0) - 0.5));
      else if (e.key === "ArrowRight") advance();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, advance]);

  if (done) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center gap-3">
        <div className="text-5xl">🎉</div>
        <h1 className="text-2xl font-black">All caught up!</h1>
        <p className="text-base-content/60">
          You rated {rated} album{rated === 1 ? "" : "s"} this run. Nothing left unrated.
        </p>
        <a href="/library" className="btn btn-primary btn-sm mt-2">Back to library</a>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Rate<Vinyl /></h1>
          <p className="text-base-content/60 text-sm">{queue.length - i} unrated left</p>
        </div>
        <progress className="progress progress-primary w-28" value={i} max={queue.length} />
      </div>

      <div className="card bg-base-200/50 border border-base-content/10">
        <div className="card-body gap-4 items-center text-center">
          <div className="aspect-square w-44 rounded-lg cover-fallback shadow-lg flex items-center justify-center overflow-hidden">
            {album.cover_art_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={album.cover_art_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="rating-num text-4xl font-black text-base-content/50">?</span>
            )}
          </div>

          <div>
            <h2 className="text-xl font-black leading-tight">{album.title}</h2>
            <p className="text-base-content/70">{album.artist}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 justify-center text-xs">
              {album.year && <span className="badge badge-outline badge-sm">{album.year}</span>}
              {album.genre && <span className="badge badge-primary badge-outline badge-sm">{album.genre}</span>}
              {album.listen_count > 0 && <span className="badge badge-ghost badge-sm">{album.listen_count} plays</span>}
            </div>
          </div>

          <a href={ytMusicUrl(album.artist, album.title)} target="_blank" rel="noopener noreferrer"
            className="btn btn-ghost btn-xs text-primary gap-1"><span aria-hidden>▶</span> Play on YouTube Music</a>

          {/* rating */}
          <div className="w-full">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="rating-num text-3xl font-black">{rating ?? "—"}</span>
              <span className="text-base-content/40 text-sm">/ 10</span>
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                <button key={n} onClick={() => setRating(n)}
                  className={`btn btn-xs ${rating === n ? "btn-primary" : "btn-neutral"}`}>{n}</button>
              ))}
              <button onClick={() => setRating((r) => (r == null ? null : Math.round(r) === r ? r - 0.5 : Math.ceil(r)))}
                className={`btn btn-xs ${rating != null && rating % 1 !== 0 ? "btn-primary" : "btn-neutral"}`}
                title="toggle half point">½</button>
            </div>
          </div>

          {/* collection */}
          <div className="flex gap-1.5">
            {COLLECTIONS.map((c) => (
              <button key={c} onClick={() => setCollection((x) => (x === c ? null : c))}
                className={`btn btn-xs ${collection === c ? "btn-secondary" : "btn-ghost"}`}>{c}</button>
            ))}
          </div>

          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            className="textarea textarea-bordered w-full min-h-20 text-sm"
            placeholder="Your notes… (⌘/Ctrl+Enter to save)" />

          <div className="flex gap-2 w-full">
            <button onClick={advance} className="btn btn-ghost flex-1" disabled={saving}>Skip →</button>
            <button onClick={save} className="btn btn-primary flex-1" disabled={rating == null || saving}>
              {saving ? <span className="loading loading-spinner loading-sm" /> : "Save & next"}
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-base-content/40">
        Keys: <kbd className="kbd kbd-xs">1</kbd>–<kbd className="kbd kbd-xs">9</kbd>,{" "}
        <kbd className="kbd kbd-xs">0</kbd>=10, <kbd className="kbd kbd-xs">↑</kbd>/<kbd className="kbd kbd-xs">↓</kbd> ½,{" "}
        <kbd className="kbd kbd-xs">↵</kbd> save, <kbd className="kbd kbd-xs">→</kbd> skip
      </p>
    </div>
  );
}
