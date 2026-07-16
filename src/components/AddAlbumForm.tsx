"use client";

import { useEffect, useRef, useState } from "react";
import type { Album } from "@/lib/types";

type Facets = { genres: string[]; releaseTypes: string[]; collections: string[] };

const COLLECTION_FALLBACKS = ["Wishlist", "Owned"];
const RELEASE_FALLBACKS = ["Album", "EP", "Single", "Compilation", "Live", "Soundtrack"];

// Merge the library's own distinct values with sensible defaults so the pickers
// are useful on an empty library and still surface the user's existing buckets.
const withDefaults = (values: string[], defaults: string[]) =>
  Array.from(new Set([...defaults, ...values]));

export default function AddAlbumForm({
  open,
  facets,
  onClose,
  onAdded,
}: {
  open: boolean;
  facets: Facets;
  onClose: () => void;
  onAdded: (album: Album, alreadyExisted: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [releaseType, setReleaseType] = useState("Album");
  const [genre, setGenre] = useState("");
  const [collection, setCollection] = useState("Wishlist");
  const [rating, setRating] = useState("");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drive the native <dialog> from the `open` prop, and reset the form each time
  // it opens so a previous entry never bleeds into the next one.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setArtist(""); setTitle(""); setYear(""); setReleaseType("Album");
      setGenre(""); setCollection("Wishlist"); setRating(""); setComments("");
      setError(null); setSaving(false);
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const collections = withDefaults(facets.collections, COLLECTION_FALLBACKS);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!artist.trim() || !title.trim()) {
      setError("Artist and title are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist: artist.trim(),
          title: title.trim(),
          release_type: releaseType.trim() || undefined,
          year: year ? Number(year) : null,
          genre: genre.trim() || null,
          rating: rating === "" ? null : Number(rating),
          comments: comments.trim() || null,
          collection_status: collection || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.album) throw new Error(d.error ?? "Couldn’t add album");
      onAdded(d.album, !!d.already_existed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t add album");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="modal modal-bottom sm:modal-middle" onClose={onClose}>
      <div className="modal-box">
        <button type="button" onClick={onClose}
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3">✕</button>
        <h3 className="text-lg font-black">Add an album</h3>
        <p className="text-sm text-base-content/60 mb-4">
          Enter one by hand. Cover art is fetched automatically afterwards.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="form-control">
              <span className="label-text font-semibold">Artist *</span>
              <input autoFocus value={artist} onChange={(e) => setArtist(e.target.value)}
                className="input input-bordered input-sm" placeholder="Fleetwood Mac" />
            </label>
            <label className="form-control">
              <span className="label-text font-semibold">Title *</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                className="input input-bordered input-sm" placeholder="Rumours" />
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="form-control">
              <span className="label-text font-semibold">Year</span>
              <input type="number" min={1900} max={2100} value={year}
                onChange={(e) => setYear(e.target.value)}
                className="input input-bordered input-sm rating-num" placeholder="1977" />
            </label>
            <label className="form-control">
              <span className="label-text font-semibold">Type</span>
              <input list="release-types" value={releaseType}
                onChange={(e) => setReleaseType(e.target.value)}
                className="input input-bordered input-sm" placeholder="Album" />
              <datalist id="release-types">
                {withDefaults(facets.releaseTypes, RELEASE_FALLBACKS).map((t) => <option key={t} value={t} />)}
              </datalist>
            </label>
            <label className="form-control">
              <span className="label-text font-semibold">Genre</span>
              <input list="genres" value={genre} onChange={(e) => setGenre(e.target.value)}
                className="input input-bordered input-sm" placeholder="Soft Rock" />
              <datalist id="genres">
                {facets.genres.map((g) => <option key={g} value={g} />)}
              </datalist>
            </label>
            <label className="form-control">
              <span className="label-text font-semibold">Rating</span>
              <input type="number" min={0} max={10} step={0.5} value={rating}
                onChange={(e) => setRating(e.target.value)}
                className="input input-bordered input-sm rating-num" placeholder="—" />
            </label>
          </div>

          <label className="form-control">
            <span className="label-text font-semibold">Collection</span>
            <select value={collection} onChange={(e) => setCollection(e.target.value)}
              className="select select-bordered select-sm">
              {collections.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>

          <label className="form-control">
            <span className="label-text font-semibold">Notes</span>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)}
              className="textarea textarea-bordered min-h-20"
              placeholder="First impressions, why you added it…" />
          </label>

          {error && <p className="text-error text-sm" role="alert">{error}</p>}

          <div className="modal-action mt-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? <span className="loading loading-spinner loading-sm" /> : "Add album"}
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
