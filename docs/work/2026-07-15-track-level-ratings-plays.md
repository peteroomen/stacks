# Track-level: tracklistings, per-track ratings, per-track plays

**Date:** 2026-07-15 (planning; build in a later session)
**Branch:** feat/track-level (when built)
**Roadmap item:** New — album tracklists + track ratings + track play counts

## Goal

Every album gets its tracklist; each track can be rated/noted; and the YouTube
Music history (already track-level) attributes to specific tracks, giving real
per-track play counts. Unlocks "favourite track per album", top-track badges,
and future best-of playlists.

## Why it's low-friction now

- The **Takeout plays are already `(artist, track, timestamp)`** — we currently
  collapse them to album spins. Once a `tracks` table exists, the *same* plays
  attribute to tracks for free.
- Many albums already have an `mbid` (from cover enrichment) → clean MusicBrainz
  tracklists; **Deezer** (now our resolver) returns tracklists with durations in
  one extra call, so enrichment reuses the exact pattern we already run.

## Approach

Ship in phases so each is independently useful.

### Phase 1 — schema + tracklist enrichment + read-only display
- **Migration `0002`** (additive, `stacks` schema):
  - `stacks.tracks (id, owner_id → auth.users, album_id → stacks.albums,
    disc_no, track_no, title, duration_ms, rating numeric(3,1), comments,
    play_count int default 0, nat_key, created_at, updated_at,
    unique(album_id, nat_key))` + owner RLS + grants + updated_at trigger.
  - add `plays.track_id uuid references stacks.tracks(id) on delete set null`.
  - optional: `albums.deezer_id text` (cache the Deezer album id for re-enrichment).
- **Enrichment** (`scripts/enrich_tracks.mjs` + a cron, same shape as covers):
  per album → Deezer `search/album` → album id → `/album/{id}` tracklist
  (title, position, duration); fall back to MusicBrainz release tracklist when the
  album has an `mbid`. Insert track rows idempotently (`on conflict (album_id,
  nat_key)`).
- **Display**: album drawer shows the tracklist (#, title, duration, play count).
  New `GET /api/tracks?album_id=`.

### Phase 2 — per-track ratings
- `PATCH /api/tracks` (rating/comments), owner-scoped via RLS.
- Inline compact rating control per track row in the drawer.
- Show "avg track rating" alongside the album rating; a ⭐ on the top track.
- (Optional) a track-rating mode in `/rate`.

### Phase 3 — attribute history to tracks
- Extend the Takeout importer: after tracks exist, match each play's track title
  to a track row of its resolved album (normalized title) → set `plays.track_id`.
- Recompute `tracks.play_count` = count of plays per `track_id`.
- Derived: favourite/most-played track per album; "deep cuts you love".

## Manual test steps

- [ ] After migration: `stacks.tracks` exists with RLS; `plays.track_id` added;
      `public` (budget-app) untouched.
- [ ] Run enrichment on a few albums → tracklists appear in the drawer with
      durations; re-running is idempotent (no dupes).
- [ ] Rate a track → persists; avg track rating updates; RLS blocks other users.
- [ ] Attribute history → a known album's top track matches reality (e.g. a
      single you hammered); play_counts sum sanely.
- [ ] Edge: album with no tracklist match (obscure) → drawer degrades gracefully
      (no tracks, no error).

## Out of scope (for the first build)

- Best-of playlist export / smart playlists (later, once track ratings exist).
- Editing tracklists by hand.
- Disc/medley edge cases beyond disc_no.

## Notes / decisions to confirm when we start

- Resolver for tracklists: **Deezer primary** (fast, durations), MusicBrainz when
  `mbid` present. Same rate discipline as the importer.
- Track `nat_key`: `sha1(lower(title)|track_no)` scoped to album — stable for
  idempotent re-enrichment.
- Keep album `rating` independent of track ratings (album rating stays the
  headline; avg track rating is supplementary, not a replacement).
