# Auth: magic link + Google login

**Date:** 2026-07-15
**Branch:** feat/auth-magic-link-google
**Roadmap item:** Deploy runbook — the app assumed a Supabase session but shipped no auth

## Goal

Give the app a real sign-in so RLS-gated reads return the owner's data (692 albums)
instead of always 0. Magic link + Google OAuth (both already enabled in Supabase).

## Why (the gap found)

Every user-facing read (`/`, `/library`, `/api/albums`, insights) used the RLS-gated anon
client, but there was **no login flow anywhere** and `OWNER_USER_ID` was only wired into the
cron. With no session, `auth.uid()` is null → RLS returns nothing → the deployed app showed
0 albums. Confirmed by fetching the live production page.

## Approach

Standard `@supabase/ssr` App Router auth:

- **`src/middleware.ts`** — refreshes the session cookie every request and gates pages: no
  user + not an auth/api path → redirect to `/login`. API routes are never redirected (they
  self-authenticate: RLS via cookie, cron via `CRON_SECRET`, insights via `getUser()`).
- **`src/app/login/page.tsx`** — client page: "Continue with Google"
  (`signInWithOAuth`) + email magic link (`signInWithOtp`), both redirecting to
  `${origin}/auth/callback`.
- **`src/app/auth/callback/route.ts`** — handles both flows: `?code=` →
  `exchangeCodeForSession` (OAuth + PKCE magic link); `?token_hash=&type=` → `verifyOtp`
  (email OTP fallback).
- **`src/app/auth/signout/route.ts`** — POST → `signOut` → `/login`.
- **`src/app/layout.tsx`** — nav + Sign out render only when logged in.

## Manual test steps

- [ ] Visit prod → redirected to `/login`.
- [ ] "Continue with Google" as petertheoomen@gmail.com → lands on dashboard → **692 albums**.
- [ ] Magic link to the same email → click → signed in.
- [ ] Library loads, edit a rating (persists), Generate insights (no more 401), chat responds.
- [ ] Sign out → back to `/login`, dashboard no longer reachable.
- [ ] Edge: signing in with a NON-owner email shows 0 albums (RLS scopes to that uid) — expected.

## ⚠️ Requires (Supabase dashboard — no MCP tool for auth URL config)

Auth → URL Configuration must allow the redirect targets or OAuth/magic-link will error:
- **Site URL:** `https://stacks-peter-oomens-projects.vercel.app`
- **Redirect URLs:** add `https://stacks-peter-oomens-projects.vercel.app/**`,
  `https://stacks-wheat.vercel.app/**`, and `http://localhost:3000/**` (local dev).

## Out of scope

- Restricting sign-up to an allow-list (any Google account can create a session, but RLS
  means only the owner's uid sees data). Add an email allow-list later if desired.
