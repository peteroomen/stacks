# Handover — "stacks" album tracker → Claude Code

You're picking up a **Next.js 15** app that was built and verified in a chat session.
It **typechecks clean** (`npx tsc --noEmit`) and **production-builds green** (`next build`).
Your job: get it into GitHub, provision Supabase, seed it, deploy to Vercel, then work the roadmap.

## What you've got
- This repo (unzipped from `album-tracker.zip`).
- **Stack:** Next.js 15 App Router · TS (strict) · Tailwind v4 + daisyUI 5 (`abyss`) ·
  Supabase (Postgres + RLS + Auth) · Vercel AI SDK + `@ai-sdk/anthropic` (model
  `claude-sonnet-4-6`) · Recharts. Vercel Cron for ingestion.
- **Data already cleaned + seeded:** `scripts/out/seed.sql` = **694 albums**, idempotent
  (`on conflict (owner_id, nat_key) do nothing`). Cleanup logic in `scripts/clean_and_seed.py`.

## Conventions (Peter's workflow — follow these)
- Plan first in `docs/work/*.md`, confirm with Peter, implement, then `npm run typecheck` + `npm run lint`.
- Single-owner data model: every table has `owner_id` + RLS. **Don't strip RLS.**
- Snake_case DB columns, `@/*` → `src`, env in `.env.local` (template: `.env.example`).

---

## Step 1 — Git + GitHub
```bash
git init && git add -A && git commit -m "Initial: stacks album tracker (built in chat)"
gh repo create stacks --private --source=. --remote=origin --push
```

## Step 2 — Supabase  ⚠️ PAUSE: ask Peter first (project creation may cost / needs org choice)
```bash
supabase login
supabase projects create stacks        # or: supabase link --project-ref <ref> for an existing one
supabase db push                        # applies supabase/migrations/0001_init.sql
```
Capture the **Project URL**, **anon key**, and **service_role key**.

## Step 3 — Auth user + seed
1. In the Supabase dashboard, create Peter's user (email allow-list = just him).
2. Copy his auth `uuid`, then stamp it into the seed and load it:
```bash
python scripts/stamp_owner.py <AUTH_UUID> scripts/out/seed.sql   # -> scripts/out/seed_owned.sql
# then run seed_owned.sql in the SQL editor (or: psql "$SUPABASE_DB_URL" -f scripts/out/seed_owned.sql)
```

## Step 4 — Env vars  ⚠️ PAUSE: needs Peter's secrets
Set in Vercel (and `.env.local` for local dev):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from Step 2
- `ANTHROPIC_API_KEY` — Peter's key (the one he uses with Cline)
- `LISTENBRAINZ_USER` — Peter's ListenBrainz username (reads are public)
- `OWNER_USER_ID` — the auth uuid from Step 3
- `CRON_SECRET` — generate a random string

## Step 5 — Vercel deploy
```bash
vercel link
vercel --prod
```
Crons auto-register from `vercel.json` (ingest runs every 4h).

## Step 6 — Smoke test
- Sign in → Library loads 694 albums → open an album → edit a rating/note (should persist).
- Dashboard → "Generate insights" (needs `ANTHROPIC_API_KEY`) → send a chat message.
- Once `LISTENBRAINZ_USER` + `CRON_SECRET` are set, hit the cron once:
  `curl -H "authorization: Bearer $CRON_SECRET" https://<deploy>/api/ingest/listenbrainz`

---

## Roadmap (the finish-line pass — details in README)
1. **Cover-art enrichment** — MusicBrainz release-group `mbid` → Cover Art Archive front cover;
   fill `albums.cover_art_url` + `mbid`. One-off backfill script + run on new scrobbles.
   *(Until this runs, the grid shows rating-tinted placeholder tiles — expected.)*
2. **Google Takeout backfill** — parse YT/YT-Music `watch-history.json`, filter to music,
   fuzzy-match to albums, seed `plays` with real historical timestamps.
3. **Wrapped** — LLM annual recap from `plays` + ratings (mirror the budgeting app's monthly recap).
4. **CSV export** — round-trip so the data is never trapped.

## Gotchas
- Web Scrobbler must be pointed at ListenBrainz (Peter's token, in the extension — not the app)
  for ongoing plays to flow.
- `rollup_play` matches plays to albums on exact lower(artist)+lower(title); enrichment/mbid
  matching will make this more robust later.
