"use client";

import { useEffect, useMemo, useState } from "react";
import type { Album, AlbumFilters } from "@/lib/types";
import { ytMusicUrl } from "@/lib/yt";
import AlbumDrawer from "./AlbumDrawer";
import { RatingStamp } from "./Vinyl";

type Facets = {
  parents: string[]; genres: string[]; releaseTypes: string[]; collections: string[];
  yearMin: number; yearMax: number; total: number;
};

const PAGE_SIZE = 48;
const DEFAULT_SORT = "rating.desc";
const defaultFilters = (): AlbumFilters => ({ sort: DEFAULT_SORT, page: 1, pageSize: PAGE_SIZE });

export default function LibraryBrowser({ facets }: { facets: Facets }) {
  const [f, setF] = useState<AlbumFilters>(defaultFilters);
  // Bumped on reset to remount the uncontrolled filter inputs so they clear.
  const [formKey, setFormKey] = useState(0);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Album | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => v != null && v !== "" && p.set(k, String(v)));
    return p.toString();
  }, [f]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch(`/api/albums?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel) { setAlbums(d.albums ?? []); setTotal(d.total ?? 0); } })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [qs]);

  const set = (patch: Partial<AlbumFilters>) => setF((p) => ({ ...p, ...patch, page: 1 }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtersActive =
    !!f.q || !!f.parent || !!f.collection || f.ratingMin != null || !!f.unratedOnly || f.sort !== DEFAULT_SORT;
  const resetFilters = () => {
    setF(defaultFilters());
    setFormKey((k) => k + 1);
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Library</h1>
          <p className="text-base-content/60 text-sm">
            {loading ? "…" : `${total} of ${facets.total} albums`}
          </p>
        </div>
        <div className="join">
          <button className={`btn btn-sm join-item border-0 ${view === "grid" ? "btn-primary" : "btn-neutral"}`}
            onClick={() => setView("grid")}>Grid</button>
          <button className={`btn btn-sm join-item border-0 ${view === "table" ? "btn-primary" : "btn-neutral"}`}
            onClick={() => setView("table")}>Table</button>
        </div>
      </header>

      {/* Filter bar — stacks on mobile, lays out horizontally on desktop */}
      <div className="card bg-base-200/50 border border-base-content/10">
        {/* key remounts the uncontrolled inputs when the filters are reset */}
        <div key={formKey} className="card-body p-4 gap-3">
          <input className="input input-bordered input-sm w-full"
            placeholder="Search artist, title, or your notes…"
            onChange={(e) => set({ q: e.target.value || undefined })} />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <select className="select select-bordered select-sm sm:w-40"
              onChange={(e) => set({ parent: e.target.value || undefined })}>
              <option value="">All genres</option>
              {facets.parents.map((g) => <option key={g}>{g}</option>)}
            </select>
            <select className="select select-bordered select-sm sm:w-44"
              value={f.sort}
              onChange={(e) => setF((p) => ({ ...p, sort: e.target.value, page: 1 }))}>
              <option value="rating.desc">Highest rated</option>
              <option value="rating.asc">Lowest rated</option>
              <option value="year.desc">Newest</option>
              <option value="year.asc">Oldest</option>
              <option value="listen_count.desc">Most played</option>
              <option value="created_at.desc">Recently added</option>
              <option value="artist.asc">Artist A–Z</option>
            </select>
            <select className="select select-bordered select-sm sm:w-44"
              onChange={(e) => set({ collection: e.target.value || undefined })}>
              <option value="">Any collection</option>
              {facets.collections.map((c) => <option key={c}>{c}</option>)}
            </select>
            <div className="flex items-center gap-2 text-sm whitespace-nowrap sm:ml-auto">
              <span className="text-base-content/60">Rating ≥</span>
              <input type="number" min={0} max={10} step={0.5}
                className="input input-bordered input-sm w-16"
                onChange={(e) => set({ ratingMin: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <label className="label cursor-pointer gap-2 text-sm whitespace-nowrap py-0">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary"
                onChange={(e) => set({ unratedOnly: e.target.checked || undefined })} />
              Unrated only
            </label>
            {filtersActive && (
              <button type="button" onClick={resetFilters}
                className="btn btn-ghost btn-sm rounded-lg text-base-content/60 hover:text-primary whitespace-nowrap">
                ✕ Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-16"><span className="loading loading-dots loading-lg" /></div>
      ) : view === "grid" ? (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {albums.map((a) => (
            <button key={a.id} onClick={() => setActive(a)}
              className="group text-left space-y-1.5">
              <Cover album={a} />
              <div className="px-0.5">
                <div className="text-xs font-semibold truncate">{a.title}</div>
                <div className="text-[11px] text-base-content/60 truncate">{a.artist}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto card bg-base-200/40 border border-base-content/10">
          <table className="table table-sm table-zebra">
            <thead>
              <tr><th className="w-10"></th><th>Artist</th><th>Title</th><th>Year</th><th>Genre</th>
                <th className="text-right">Rating</th><th className="text-right">Plays</th><th></th></tr>
            </thead>
            <tbody>
              {albums.map((a) => (
                <tr key={a.id} className="hover cursor-pointer" onClick={() => setActive(a)}>
                  <td><Thumb album={a} /></td>
                  <td className="font-medium">{a.artist}</td>
                  <td>{a.title}</td>
                  <td className="text-base-content/60">{a.year ?? "—"}</td>
                  <td><span className="badge badge-ghost badge-sm">{a.genre ?? "—"}</span></td>
                  <td className="text-right rating-num font-bold">{a.rating ?? "—"}</td>
                  <td className="text-right rating-num text-base-content/60">{a.listen_count}</td>
                  <td>
                    <a href={ytMusicUrl(a.artist, a.title)} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()} title="Play on YouTube Music"
                      className="btn btn-ghost btn-xs btn-circle text-primary">▶</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center join">
          <button className="join-item btn btn-sm" disabled={f.page === 1}
            onClick={() => setF((p) => ({ ...p, page: (p.page ?? 1) - 1 }))}>«</button>
          <button className="join-item btn btn-sm btn-ghost pointer-events-none">
            {f.page} / {pages}</button>
          <button className="join-item btn btn-sm" disabled={(f.page ?? 1) >= pages}
            onClick={() => setF((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}>»</button>
        </div>
      )}

      <AlbumDrawer album={active} onClose={() => setActive(null)}
        onSaved={(u) => setAlbums((xs) => xs.map((x) => (x.id === u.id ? u : x)))} />
    </div>
  );
}

function Thumb({ album }: { album: Album }) {
  return album.cover_art_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={album.cover_art_url} alt="" className="w-9 h-9 rounded object-cover" />
  ) : (
    <div className="cover-fallback w-9 h-9 rounded flex items-center justify-center text-[10px] rating-num text-base-content/60">
      {album.rating ?? ""}
    </div>
  );
}

function Cover({ album }: { album: Album }) {
  return (
    <div className="relative">
      {album.cover_art_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={album.cover_art_url} alt={album.title}
          className="aspect-square w-full rounded-md object-cover shadow-md
                     group-hover:ring-2 ring-primary transition" />
      ) : (
        <div className="cover-fallback aspect-square w-full rounded-md shadow-md
                        group-hover:ring-2 ring-primary transition flex items-center
                        justify-center p-2">
          {album.rating != null && (
            <span className="rating-num text-2xl font-black text-base-content/70">{album.rating}</span>
          )}
        </div>
      )}
      {/* Rated albums with real art get a vinyl-label stamp; the art-less
          fallback already shows the number big, so it doesn't need one. */}
      {album.cover_art_url && album.rating != null && <RatingStamp rating={album.rating} />}
    </div>
  );
}
