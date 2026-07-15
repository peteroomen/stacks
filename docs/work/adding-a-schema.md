# Handoff — adding an app's schema to the shared `personal-apps` Supabase DB

**Audience:** an agent standing up a *new* personal app that will share Peter's single
Supabase Postgres DB. Copy this whole file into that session as the starting brief.

## The setup you're joining

One Supabase project hosts multiple personal apps, each isolated in **its own Postgres
schema** (not table prefixes). Shared `auth.users`; every app's rows are owned by one auth
user and gated by RLS, so apps/users never see each other's data.

| Schema | App | Notes |
|---|---|---|
| `public` | budget-app | The original tenant. **Do not touch it.** |
| `stacks` | album tracker | Added 2026-07-15 (this is the worked example). |
| `<your-app>` | ← you add this | Follow the recipe below. |

- **Project:** `personal-apps` (was `budget-app`), org `peteroomen's Org`
- **Project ref / id:** `ynsywxqgtsubzhibdjdz`
- **API URL:** `https://ynsywxqgtsubzhibdjdz.supabase.co`
- Drive everything via the **Supabase MCP tools** (`apply_migration`, `execute_sql`,
  `list_tables`, `get_project_url`, `get_publishable_keys`). Note: the agent sandbox's
  outbound proxy **blocks `*.supabase.co`**, so you cannot `curl` the REST API to test —
  verify with SQL and the app's own smoke test instead.

## Recipe — 4 steps

### 1. Migration (`apply_migration`, name it `<app>_init`)

Put **everything** under your schema. Non-negotiables in **bold**.

```sql
create schema if not exists <app>;

-- every table: owner_id FK to auth.users + a unique natural key for idempotent seeding
create table if not exists <app>.<thing> (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid not null references auth.users(id) on delete cascade,
  -- ...columns...
  created_at timestamptz not null default now()
);
create index if not exists <thing>_owner_idx on <app>.<thing>(owner_id);

-- **RLS on, owner-scoped policy, on EVERY table**
alter table <app>.<thing> enable row level security;
drop policy if exists "own <thing>" on <app>.<thing>;
create policy "own <thing>" on <app>.<thing>
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- **Namespace helper functions** (avoids collisions on generic names like touch_updated_at).
-- **security-definer functions MUST pin search_path** or they resolve the wrong schema.
create or replace function <app>.some_fn(...) returns ... as $$ ... $$
  language plpgsql security definer;
alter function <app>.some_fn(...) set search_path = <app>, public;

-- **Grants** so PostgREST/API roles can reach the tables (RLS still gates rows —
-- anon has no auth.uid() so it reads nothing).
grant usage on schema <app> to anon, authenticated, service_role;
grant all on all tables    in schema <app> to anon, authenticated, service_role;
grant all on all sequences in schema <app> to anon, authenticated, service_role;
grant execute on all functions in schema <app> to anon, authenticated, service_role;
alter default privileges in schema <app> grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema <app> grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema <app> grant execute on functions to anon, authenticated, service_role;
```

### 2. Expose the schema to the API (`execute_sql`) — the easy-to-miss step

PostgREST only serves schemas listed in `pgrst.db_schemas`. This is a **full replacement**,
so include the existing ones and append yours. **Check the current value first** (it may
have grown since this was written):

```sql
select rolconfig from pg_roles where rolname = 'authenticator';   -- find the pgrst.db_schemas line
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, stacks, <app>';
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
```
As of 2026-07-15 the value is `public, graphql_public, stacks` — add yours to that list.

### 3. App code — one line per Supabase client

All clients centralize their options, so set the schema once each; no per-query edits.
```ts
createClient(url, key, { db: { schema: "<app>" }, /* ...existing... */ })
```
Every `.from("thing")` and `.rpc("fn")` then resolves inside `<app>`.

### 4. Verify (SQL only — REST curl is blocked in-sandbox)

```sql
-- your tables exist + RLS on
select relname, relrowsecurity from pg_class
 where relnamespace = '<app>'::regnamespace and relkind = 'r';
-- other tenants untouched (spot-check a couple of row counts)
-- your db_schemas line includes <app>
select rolconfig from pg_roles where rolname = 'authenticator';
```
Then prove the REST path end-to-end by **running the app** (sign in → list rows). If a query
404s with `PGRST106 / schema not found`, step 2 didn't take — re-run it and both `notify`s.

## Seeding (if you have seed data)

Match the stacks pattern: a natural-key `on conflict (owner_id, nat_key) do nothing` seed so
re-runs are idempotent. Stamp the owner's auth uuid in at load time (see
`scripts/stamp_owner.py`), never hardcode it in the committed seed.

## Gotchas learned doing `stacks`

- **Generic function names collide** across schemas only if you forget to namespace — always
  qualify (`<app>.touch_updated_at`, not bare).
- **`security definer` + no `search_path`** = the function silently reads `public`. Always
  `alter function ... set search_path`.
- **Shared `auth.users`**: other apps' users exist in the same table. RLS by `owner_id` is
  what keeps data separate — never weaken it.
- **Don't rename via SQL**: the project rename (`budget-app` → `personal-apps`) is a
  dashboard-only, cosmetic change; env vars key off the ref, not the name.
