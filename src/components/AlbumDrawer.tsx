"use client";

import { useEffect, useState } from "react";
import type { Album, Track } from "@/lib/types";
import { ytMusicUrl } from "@/lib/yt";

const fmtDur = (ms: number | null) => {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function AlbumDrawer({
  album, onClose, onSaved,
}: { album: Album | null; onClose: () => void; onSaved: (a: Album) => void }) {
  const [rating, setRating] = useState<string>("");
  const [comments, setComments] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [tracks, setTracks] = useState<Track[] | null>(null);

  useEffect(() => {
    setRating(album?.rating != null ? String(album.rating) : "");
    setComments(album?.comments ?? "");
  }, [album]);

  useEffect(() => {
    if (!album) return;
    setTracks(null);
    let cancel = false;
    fetch(`/api/tracks?album_id=${album.id}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel) setTracks(d.tracks ?? []); })
      .catch(() => { if (!cancel) setTracks([]); });
    return () => { cancel = true; };
  }, [album]);

  if (!album) return null;

  async function save() {
    setSaving(true);
    const res = await fetch("/api/albums", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: album!.id,
        rating: rating === "" ? null : Number(rating),
        comments: comments || null,
      }),
    });
    const d = await res.json();
    setSaving(false);
    if (d.album) { onSaved(d.album); onClose(); }
  }

  async function persistTrack(id: string, rating: number | null) {
    await fetch("/api/tracks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, rating }),
    });
  }

  const ratedTracks = (tracks ?? []).filter((t) => t.rating != null);
  const avgTrack = ratedTracks.length
    ? ratedTracks.reduce((s, t) => s + (t.rating ?? 0), 0) / ratedTracks.length
    : null;
  const topId = ratedTracks.length
    ? ratedTracks.reduce((a, b) => ((b.rating ?? 0) > (a.rating ?? 0) ? b : a)).id
    : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-stretch sm:justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <aside className="relative w-full sm:max-w-md bg-base-200 max-h-[88vh] sm:max-h-none sm:h-full
                        overflow-y-auto rounded-t-2xl sm:rounded-none border-t sm:border-t-0
                        sm:border-l border-base-content/10 px-6 pt-4 space-y-4
                        pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-base-content/20 sm:hidden" />
        <button className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
          onClick={onClose}>✕</button>

        <div className="aspect-square w-40 rounded-lg cover-fallback shadow-lg
                        flex items-center justify-center overflow-hidden">
          {album.cover_art_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={album.cover_art_url} alt="" className="w-full h-full object-cover" />
            : <span className="rating-num text-4xl font-black text-base-content/60">
                {album.rating ?? "?"}</span>}
        </div>

        <div>
          <h2 className="text-2xl font-black leading-tight">{album.title}</h2>
          <p className="text-base-content/70">{album.artist}</p>
        </div>

        <a href={ytMusicUrl(album.artist, album.title)} target="_blank" rel="noopener noreferrer"
          className="btn btn-sm btn-primary w-full gap-2">
          <span aria-hidden>▶</span> Play on YouTube Music
        </a>

        <div className="flex flex-wrap gap-2 text-sm">
          {album.year && <span className="badge badge-outline">{album.year}</span>}
          {album.genre && <span className="badge badge-primary badge-outline">{album.genre}</span>}
          {album.genre_parent && <span className="badge badge-ghost">{album.genre_parent}</span>}
          <span className="badge badge-ghost">{album.release_type}</span>
          {album.collection_status && <span className="badge badge-secondary">{album.collection_status}</span>}
          <span className="badge badge-ghost">{album.listen_count} plays</span>
        </div>

        <div className="divider my-1" />

        <label className="form-control">
          <span className="label-text font-semibold">Your rating</span>
          <input type="number" min={0} max={10} step={0.5} value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="input input-bordered rating-num w-28"
            placeholder="—" />
        </label>

        <label className="form-control">
          <span className="label-text font-semibold">Your notes</span>
          <textarea className="textarea textarea-bordered min-h-28" value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="What did you make of it?" />
        </label>

        <button className="btn btn-primary w-full" onClick={save} disabled={saving}>
          {saving ? <span className="loading loading-spinner loading-sm" /> : "Save changes"}
        </button>

        {tracks && tracks.length > 0 && (
          <div className="pt-1">
            <div className="divider my-1 text-xs text-base-content/40">
              {tracks.length} tracks
              {avgTrack != null && <> · avg <span className="rating-num text-base-content/60">{avgTrack.toFixed(1)}</span></>}
            </div>
            <ol className="text-sm divide-y divide-base-content/5">
              {tracks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-1">
                  <span className="w-5 text-right text-xs text-base-content/40 rating-num shrink-0">
                    {t.track_no ?? "•"}
                  </span>
                  <span className="flex-1 truncate">
                    {t.title}
                    {t.id === topId && <span className="ml-1 text-primary" title="Top-rated track">★</span>}
                  </span>
                  {t.play_count > 0 && (
                    <span className="text-xs text-base-content/50 rating-num shrink-0">{t.play_count}▶</span>
                  )}
                  {t.duration_ms != null && (
                    <span className="text-xs text-base-content/40 rating-num shrink-0 w-9 text-right hidden sm:inline">
                      {fmtDur(t.duration_ms)}
                    </span>
                  )}
                  <input type="number" min={0} max={10} step={0.5} placeholder="—"
                    className="input input-xs input-bordered w-14 rating-num text-right shrink-0"
                    value={t.rating ?? ""}
                    onChange={(e) => setTracks((ts) => ts?.map((x) => (x.id === t.id
                      ? { ...x, rating: e.target.value === "" ? null : Number(e.target.value) } : x)) ?? null)}
                    onBlur={(e) => persistTrack(t.id, e.target.value === "" ? null : Number(e.target.value))}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}
