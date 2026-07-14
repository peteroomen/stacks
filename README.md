# stacks — album listening tracker + AI companion

Personal, single-user web app to track everything you've listened to, rate and
annotate it, and get grounded suggestions/insights from an LLM that actually
knows your taste (your ratings **and your own written notes**).

**Stack:** Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS + Auth) ·
Tailwind v4 + daisyUI 5 (`abyss` theme) · Vercel (+ Cron) · Anthropic via Vercel AI SDK ·
TanStack-free table (daisyUI `table`) · Recharts.

---

## What's built

| Area | Status |
|---|---|
| Data cleanup + normalization + parent-genre mapping | ✅ done (`scripts/clean_and_seed.py`) |
| Seed: 694 albums from your CSV (`scripts/out/seed.sql`) | ✅ generated, idempotent |
| Schema + RLS + indexes + rollup fn (`supabase/migrations/0001_init.sql`) | ✅ done |
| Library view — grid/table, search, filters, sort, pagination, detail drawer, inline edit | ✅ done |
| Dashboard — stats (genre + rating charts), insight cards, chat | ✅ done |
| AI insight cards (revisit queue / blind spots / recent run / recs), cached | ✅ done (needs key) |
| AI chat grounded in library digest | ✅ done (needs key) |
| ListenBrainz ingestion cron + rollup | ✅ done (needs username) |
| Cover-art enrichment (Cover Art Archive / MusicBrainz) | ⏳ TODO — see Roadmap |
| Google Takeout historical backfill parser | ⏳ TODO |
| "Wrapped" year-in-review + CSV export | ⏳ TODO |

The ⏳ items are the finish-line pass — the app runs and is fully usable without them.

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
2. **Run the migration:** `supabase db push` (or paste `0001_init.sql` into the SQL editor).
3. **Create your auth user** (email allow-list = just you), then copy your user `uuid`
   into `OWNER_USER_ID`.
4. **Seed:** the generated `seed.sql` has no `owner_id`. Set it in one line first:
   ```sql
   -- in Supabase SQL editor, after creating your user:
   \set owner 'YOUR-AUTH-UUID'
   -- then run seed with owner filled in (see scripts/seed_with_owner.sql helper)
   ```
   Or use the helper: `python scripts/stamp_owner.py <uuid>` → writes `seed_owned.sql`.
5. **Push to GitHub**, import to **Vercel**, set all env vars, deploy.
6. **Cron** is configured in `vercel.json` (every 4h). Set `CRON_SECRET`.
7. **Web Scrobbler** → point it at ListenBrainz with your user token so plays start flowing.

## Roadmap (the ⏳ items)

- **Enrichment job:** for each album lacking `cover_art_url`, query MusicBrainz for the
  release-group `mbid`, then Cover Art Archive for the front cover. Store both. Run as a
  one-off script + on new scrobbles.
- **Takeout backfill:** parse `watch-history.json` from Google Takeout (YT + YT Music),
  filter to music, fuzzy-match to albums, seed `plays` with real historical timestamps.
- **Wrapped:** LLM-written annual recap from `plays` + ratings (same pattern as the
  budgeting app's monthly recap).
- **Export:** CSV round-trip so the data is never trapped.
