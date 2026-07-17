# stacks — album listening tracker + AI companion

Personal, single-user web app to track everything you've listened to, rate and
annotate it, and get grounded suggestions/insights from an LLM that actually
knows your taste (your ratings **and your own written notes**).

**Stack:** Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS + Auth) ·
Tailwind v4 + daisyUI 5 (`abyss` theme) · Vercel (+ Cron) · Anthropic via Vercel AI SDK ·
TanStack-free table (daisyUI `table`) · Recharts · `react-markdown` (chat rendering).

---

## What's built

| Area | Status |
|---|---|
| Data cleanup + normalization + parent-genre mapping | ✅ done (`scripts/clean_and_seed.py`) |
| Seed: 694 albums from your CSV (`scripts/out/seed.sql`) | ✅ generated, idempotent |
| Schema + RLS + indexes + rollup fns (`supabase/migrations/`) | ✅ done |
| Library view — grid/table, search, filters, sort, pagination, detail drawer, inline edit | ✅ done |
| Dashboard — stats, recently played, insight cards, chat | ✅ done |
| AI insight cards (revisit queue / blind spots / recent run / recs), cached | ✅ done (needs key) |
| AI chat with tools — search / read / edit / add / listening stats + album cards & YT Music links (`react-markdown` rendering) | ✅ done (needs key) |
| ListenBrainz ingestion cron + album/track rollup | ✅ done (needs username) |
| Cover-art enrichment (CAA → Deezer → iTunes), cron + backfill script | ✅ done |
| Google Takeout historical backfill (`scripts/import_takeout.mjs`) | ✅ done |
| Tracklists + per-track ratings + per-track play counts | ✅ done |
| "Wrapped" year-in-review + CSV export | ⏳ roadmap |

See `docs/work/2026-07-15-audit.md` for the full audit + roadmap.

---

## Local run

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Anthropic + ListenBrainz
npm run dev
```

## Deploy runbook (matches the approval checklist)

1. **Create the Supabase project** (new). Grab the project URL, `anon` key, and
   `service_role` key into env vars.
2. **Run the migrations:** `supabase db push` (or paste `supabase/migrations/*.sql`
   into the SQL editor, in order).
3. **Create your auth user** (email allow-list = just you), then copy your user `uuid`
   into `OWNER_USER_ID`.
4. **Seed:** `python scripts/stamp_owner.py <uuid>` → writes `seed_owned.sql`; run it
   in the SQL editor.
5. **Push to GitHub**, import to **Vercel**, set all env vars, deploy.
6. **Cron** is configured in `vercel.json` (ingest daily 08:00 UTC, covers 08:30).
   Set `CRON_SECRET` — the cron endpoints refuse all requests until it is set.
7. **Web Scrobbler** → point it at ListenBrainz with your user token so plays start flowing.

## Pipeline scripts (one-off / backfill)

All read `.env.local` (Node ≥ 20.6): `node --env-file=.env.local scripts/<name>.mjs`

- `enrich_covers.mjs` — bulk cover-art backfill (CAA → Deezer → iTunes). The cron
  route keeps new albums topped up afterwards.
- `import_takeout.mjs <watch-history.html>` — YT Music history → sessionized album
  spins + plays timeline. Dry-run by default; `--apply` to commit.
- `enrich_tracks.mjs` — tracklists per album (Deezer, MusicBrainz fallback).
  `--renumber` backfills `track_no` on albums that already have tracks but were
  imported without positions (matches stored titles to the source order; flags
  wrong-album matches instead of mis-numbering). Dry-run by default; `--apply` writes.
- `verify_titles.mjs` — "did you mean?" sweep: catches fossilized artist/title
  typos (Progidy, Kraftwek) via fuzzy Deezer/MusicBrainz lookup + Levenshtein
  scoring. Dry-run by default; `--apply` writes, `--llm` adjudicates ambiguous
  cases, `--all` sweeps everything, `--self-test` runs the offline classifier check.
- `attribute_track_plays.mjs` — link imported plays to tracks, roll up per-track
  play counts. Requires migration `0005` (fixes the `link_plays_to_tracks` RPC).

## Roadmap

- **Wrapped:** LLM-written annual recap from `plays` + ratings.
- **Export:** CSV round-trip so the data is never trapped.
- **Listening queue:** an ordered "spin next" list you (or the chat) can push
  albums onto; surfaced on the dashboard.
- **Chat history in DB:** persist conversations as threads (chat currently
  keeps only the live session, localStorage at best).
- **Chat rec cards with lookup:** cover-art cards for recommendations *outside*
  the library (in-library recs already get cards; needs a Deezer/CAA lookup).
- More in `docs/work/2026-07-15-audit.md` (listening timeline, spin-sessionized
  counts for scrobbles, URL-synced filters, genre drill-down, and more).
