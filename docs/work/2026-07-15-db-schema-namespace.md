# Namespace stacks into its own schema in the shared personal DB

**Date:** 2026-07-15
**Branch:** feat/db-schema-namespace
**Roadmap item:** Deploy runbook Step 2 (Supabase) — adapted to reuse the existing budget-app project

## Goal

Stand up stacks' schema inside the **existing** Supabase project (currently named
`budget-app`, ref `ynsywxqgtsubzhibdjdz`) without touching budget-app's data, using a
dedicated `stacks` Postgres schema so the shared DB stays scalable as more personal apps
are added.

## Approach

- **Namespace = dedicated schema**, not table prefixes. Tables become `stacks.albums`,
  `stacks.plays`, `stacks.insights`; helper functions become `stacks.touch_updated_at`,
  `stacks.rollup_play`. This sidesteps the generic-name collision on `touch_updated_at`
  entirely and keeps `public` (budget-app) clean.
- **App code change is minimal** — all three Supabase clients centralize their options, so
  `db: { schema: "stacks" }` on each makes every `.from(...)` and the `.rpc("rollup_play")`
  call resolve inside `stacks`. No per-query edits.
- **Shared auth** — same project = same `auth.users`. stacks RLS (`auth.uid() = owner_id`)
  scopes all rows to Peter's uid, so Megan (a budget-app user) sees none of it.
- **PostgREST must serve the schema** — the one non-obvious step. Set exposed schemas via
  `alter role authenticator set pgrst.db_schemas = 'public, graphql_public, stacks'` +
  `notify pgrst, 'reload config'`. If that doesn't stick, fall back to the dashboard toggle
  (Project Settings → API → Exposed schemas → add `stacks`).

## Steps

- [ ] Branch `feat/db-schema-namespace`
- [ ] Rewrite `supabase/migrations/0001_init.sql` → `stacks` schema (tables, indexes,
      functions, RLS policies, grants to anon/authenticated/service_role, search_path on the
      security-definer fn)
- [ ] `db: { schema: "stacks" }` in `client.ts`, `server.ts`, `admin.ts`
- [ ] `scripts/out/seed.sql`: `insert into public.albums` → `insert into stacks.albums`
      (stamp_owner.py needs no change — it only edits the column list + conflict clause)
- [ ] Delete stale `scripts/out/seed_owned.sql` (placeholder uuid); regenerate at seed time
- [ ] `npm run typecheck` + `npm run lint` + `npm run build`
- [ ] Apply migration to the project via MCP `apply_migration`
- [ ] Expose the schema to PostgREST (SQL, verify)
- [ ] (Deferred to secrets step) stamp Peter's auth uuid → seed `stacks.albums`

## Manual test steps

- [ ] After migration: `list_tables` on the project shows `stacks.albums/plays/insights`
      alongside untouched `public.*` budget-app tables
- [ ] Budget-app tables unchanged (row counts: transactions=46, merchant_category_map=17)
- [ ] `public.touch_updated_at` still absent/untouched (no collision)
- [ ] Edge case: re-running the migration is idempotent (all `if not exists` / `create or
      replace`), and re-running the seed is idempotent (`on conflict (owner_id, nat_key)`)
- [ ] Full end-to-end (app loads albums) validated once env vars + seed land

## What actually happened

- Applied cleanly. `stacks` schema created in project `ynsywxqgtsubzhibdjdz`; tables
  `albums/plays/insights` with RLS on; functions `stacks.touch_updated_at` +
  `stacks.rollup_play` (search_path pinned); grants in place.
- Exposed to PostgREST via `alter role authenticator set pgrst.db_schemas =
  'public, graphql_public, stacks'` + reload. Confirmed set.
- **Verified budget-app untouched** (public tables intact) and **no
  `public.touch_updated_at` collision** (both helper fns live only in `stacks`).
- Code: `db: { schema: "stacks" }` in the 3 clients. typecheck ✅, build ✅.
- `next lint` has no ESLint config in this repo (interactive setup prompt) — pre-existing,
  left as-is; `next build` type-validates and passed.
- REST round-trip NOT verifiable from the agent sandbox (outbound proxy blocks
  `*.supabase.co`) — defer to the app smoke test.
- Wrote `docs/work/adding-a-schema.md` — reusable pattern for the next app's schema.

## Files created / modified

- `supabase/migrations/0001_init.sql` (schema-scoped rewrite)
- `src/lib/supabase/{client,server,admin}.ts` (schema option)
- `scripts/out/seed.sql` (`public.albums` → `stacks.albums`)
- `docs/work/2026-07-15-db-schema-namespace.md`, `docs/work/adding-a-schema.md` (new)

## Deferred to next session

- Stamp Peter's auth uuid → load seed into `stacks.albums` (Step 3).
- Env vars (`ANTHROPIC_API_KEY`, `LISTENBRAINZ_USER`, `CRON_SECRET`, Supabase keys) → Vercel
  + `.env.local` (Step 4). Supabase URL/anon key already captured.
- Vercel deploy + smoke test (Steps 5–6).
- Rename project `budget-app` → `personal-apps` (dashboard, cosmetic).

## Status

- [x] Complete (schema slice) — deploy/seed/env deferred to next session

## Out of scope for this session

- Renaming the Supabase project (dashboard-only; cosmetic; env vars key off the ref, not the
  name) — Peter's call on the new name.
- Env vars + secrets (Anthropic key, ListenBrainz user) and the Vercel deploy.
- Cover-art/Takeout/Wrapped roadmap items.
