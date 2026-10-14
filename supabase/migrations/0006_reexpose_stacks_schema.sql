-- Re-expose `stacks` to PostgREST.
--
-- Symptom: the app fails with "invalid schema: stacks" (PGRST106). Cause: another tenant's
-- migration (budget-app, `public`) rewrote `pgrst.db_schemas` on the authenticator role.
-- That setting is a FULL replacement, so writing it without `stacks` silently un-exposes
-- this app even though its tables and data are untouched.
--
-- This block is idempotent and non-destructive: it reads the current list and only appends
-- `stacks` if it's missing, preserving every other app's schema.
do $$
declare
  cur text;
begin
  select substr(c, length('pgrst.db_schemas=') + 1) into cur
    from pg_roles r, unnest(r.rolconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';

  if cur is null or btrim(cur) = '' then
    cur := 'public, graphql_public';
  end if;

  if not exists (
    select 1 from unnest(string_to_array(cur, ',')) s where btrim(s) = 'stacks'
  ) then
    execute format('alter role authenticator set pgrst.db_schemas = %L', cur || ', stacks');
  end if;
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
