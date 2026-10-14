# Handoff — "invalid schema: stacks" + Supabase keepalive (2026-10-14)

**Branch:** `ccr-ba60e6e4-05wcy8` (pushed, no PR yet). **Your first job:** use the
**Supabase MCP tools** (the previous session lost them after a restart) to verify and, if
needed, finish the fix below. Read `docs/work/adding-a-schema.md` for the multi-tenant setup.

## Projects

| Project | Ref | Contents |
|---|---|---|
| `budget-app` (aka personal-apps) | `ynsywxqgtsubzhibdjdz` | schemas `public` (budget-app), `stacks` (this app), `forkcast` |
| `guitar-ai-db` | `wpitfgefsnxskwvymmfe` | separate app; nothing keeps it awake |

## 1. Bug: albums fail with "invalid schema: stacks" (PGRST106)

**Observed (live, via `execute_sql`):** `select rolconfig from pg_roles where rolname='authenticator'`
returned only `session_preload_libraries`, `statement_timeout`, `lock_timeout` — **no
`pgrst.db_schemas` override at all**. So PostgREST falls back to the dashboard's *Exposed
schemas* (default `public, graphql_public`), and `stacks` (and very likely `forkcast`) are
no longer served. Data is untouched.

**Suspected trigger (unconfirmed):** budget-app migrations applied 2026-09-23 —
`import_history`, `global_budget_caps`, `financial_reliability`, `anz_bank_sync` — or a save
of the dashboard Data API settings. Confirm with:
```sql
select version, name from supabase_migrations.schema_migrations
 where exists (select 1 from unnest(statements) s
               where s ilike '%db_schemas%' or s ilike '%authenticator%');
```

**Fix (not yet applied — do this):**
1. Preferred: Dashboard → `budget-app` → Project Settings → **Data API → Exposed schemas**:
   add `stacks` and `forkcast` (keep `public`, `graphql_public`). This is a dashboard action —
   ask the user to do it if you can't.
2. SQL alternative (if the user prefers): set the full list explicitly — **include every
   tenant**, never a partial list:
   ```sql
   alter role authenticator set pgrst.db_schemas = 'public, graphql_public, stacks, forkcast';
   notify pgrst, 'reload config';
   notify pgrst, 'reload schema';
   ```
   First confirm `forkcast` is meant to be exposed (check `pg_namespace` + its grants:
   `select has_schema_privilege('anon','forkcast','usage')`).
3. `supabase/migrations/0006_reexpose_stacks_schema.sql` is an append-only guard; with no
   role override present it deliberately **raises** rather than guessing the list. Don't
   "fix" that by adding a fallback that omits tenants.

**Verify:**
```sql
select rolconfig from pg_roles where rolname = 'authenticator';
select n.nspname, count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('stacks','forkcast') and c.relkind='r' group by 1;
```
Then check API logs (`get_logs` service `api`) for PGRST106 stopping, and have the user load
the album app and forkcast. Note: the sandbox proxy blocks `*.supabase.co`, so no curl.

## 2. Keepalive cron (done in code, needs deploy + config)

- `src/app/api/keepalive/route.ts`, scheduled daily `0 12 * * *` in `vercel.json`,
  `CRON_SECRET`-protected. Pings budget-app via PostgREST (`stacks.albums` head count) and
  GoTrue (`auth.admin.listUsers`), and guitar-ai-db via GoTrue. Returns 500 on any failure.
- **Needs:** merge to `main` (Vercel crons run on production only) and Vercel env vars
  `GUITAR_AI_SUPABASE_URL=https://wpitfgefsnxskwvymmfe.supabase.co` and
  `GUITAR_AI_SUPABASE_SERVICE_ROLE_KEY` (user sets the secret; don't handle it in chat).
  Until set, the response has `"guitar": "not configured"` and status 500.
- Verify after deploy: Vercel → project → Settings → Cron Jobs → run `/api/keepalive`;
  expect `{"rest":"ok","auth":"ok","guitar":"ok"}` (`rest` stays red until §1 is fixed).

## Commits on the branch
- `0006` migration + `adding-a-schema.md` gotcha about `pgrst.db_schemas` being a full replacement
- keepalive route + cron, then guitar-ai-db ping
