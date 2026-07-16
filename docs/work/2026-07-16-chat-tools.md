# Chat with hands — tools for the AI companion

Approved by Peter 2026-07-16 (with amendment: album cards for recommendations
render **only for albums already in the library** — external-lookup cards are
a roadmap item, not this slice).

## Why

The chat is read-only and blind beyond its digest: it can't check a fact, fix
a rating you dictate, or hand you a play link. This gives it tools (Vercel AI
SDK multi-step tool use) plus a UI that can render what the tools return.

## Server: `/api/chat` tools (AI SDK `tool()` + zod, `maxSteps: 6`)

All tools run on the **session-cookie Supabase client** (RLS enforces
ownership — no service role anywhere in the chat path). The digest stays in
the system prompt as taste/voice context; facts move to tools.

1. `search_library({ q?, artist?, genreParent?, ratingMin?, ratingMax?,
   unratedOnly?, sort?, limit=12 })` → compact rows: id, artist, title, year,
   genre, genre_parent, rating, listen_count, collection_status,
   has_comments. `q` searches artist/title/comments (reuse the quoted-ilike
   escaping from /api/albums — the PostgREST `.or()` gotcha).
2. `get_album({ id })` → full album incl. comments + tracklist (track_no,
   title, rating, play_count, duration_ms).
3. `update_album({ id, rating?, comments?, collection_status? })` → patch,
   returns `{ before, after }` so the model can echo the change. Rating
   0–10; strings bounded (same zod shapes as /api/albums PATCH).
4. `add_album({ artist, title, year?, genre?, collection_status? })` →
   dupe-check first (nat_key + ilike on artist/title); if it exists, return
   the existing album with `already_existed: true` instead of inserting.
   Insert with `source: 'chat'`, default `collection_status: 'Wishlist'`,
   nat_key = sha1(`${artist.toLowerCase()}|${title.toLowerCase()}|${year ?? ""}`)
   .slice(0,16) — same recipe as clean_and_seed.py / import_takeout.mjs.
5. `listening_stats({ window: '7d'|'30d'|'90d'|'365d'|'all', by:
   'album'|'artist'|'genre', limit=10 })` → top-N from `plays` joined to
   albums (play counts, distinct albums, most-recent timestamps).
6. `show_albums({ ids: uuid[] (max 8) })` → fetches those albums (RLS) and
   returns id, artist, title, year, rating, cover_art_url, listen_count.
   Exists purely so the UI can render an album-card row. Because it reads
   from the DB, it can only ever show library albums — which is exactly the
   approved scope.

**No delete tool** — deliberate; deleting stays a UI action.

### System prompt additions

- Edit policy: only call `update_album`/`add_album` when the user clearly
  asks; always restate what changed in the reply.
- When recommending albums **in** the library (revisits etc.): after the
  prose, call `show_albums` with their ids (ids come from prior
  search_library/get_album results — never invent ids).
- When recommending albums **not** in the library: include a YouTube Music
  markdown link for each, built as
  `https://music.youtube.com/search?q=<encodeURIComponent("Artist Title")>`
  (un-sort "Beatles, The" style names first — same scheme as `ytMusicUrl`).
- Keep the existing voice/grounding rules.

## Client: `Chat.tsx`

- Render `message.parts` (v4 UIMessage parts) instead of `m.content`:
  - **text parts** → markdown via `react-markdown` (the one new dependency).
    Links styled to theme, `target="_blank" rel="noopener noreferrer"`
    (custom `a` component). No raw-HTML rendering.
  - **tool-invocation parts** → activity chips: "🔍 searched *bowie* — 12
    results", "📊 stats: last 30 days", "✏️ *Rumours*: rating 8 → 9",
    "➕ added *Titanic Rising* to Wishlist". Edits (update/add) styled
    distinctly (e.g. warning-tinted chip) so a write is impossible to miss.
    In-flight calls show a subtle pending state.
  - **show_albums results** → horizontal card row, reusing the
    dashboard/recently-played look: cover (or `cover-fallback`), title,
    artist, rating stamp if rated, and a ▶ link via `ytMusicUrl`. Lazy
    images.
- **localStorage persistence**: save messages per session
  (`stacks-chat-v1`), hydrate as `initialMessages`, add a "New chat" button
  that clears storage + state. Guard `JSON.parse` failures (corrupt storage
  → start fresh).
- Refresh example prompts to show off the new powers, e.g.:
  - "What have I been playing this month?"
  - "Set Rumours to a 9 — earned it"
  - "Something like Madvillainy but jazzier"
- Keep: auto-scroll, error + retry, disabled send while streaming.

## Guard rails

- RLS session client only; zod on every tool input; rating clamped 0–10;
  `show_albums` capped at 8 ids; `search_library` limit capped at 25.
- add_album can't duplicate (nat_key upsert semantics + pre-check).
- Tool errors return `{ error }` to the model (so it can apologize/adjust)
  rather than throwing the stream away.

## Out of scope (roadmapped on main)

- Listening queue; DB-backed chat threads; lookup-powered cards for
  non-library recommendations.

## Acceptance

- `npm run typecheck` and `next build` green.
- No live-LLM test possible in the sandbox (no ANTHROPIC_API_KEY / egress):
  PR must include a manual test script for Peter — the exact prompts to try
  and what each should do (search, stats, an edit with visible chip + echo,
  an in-library rec with cards, an out-of-library rec with YT links,
  localStorage survival across refresh, New chat).
- README: update the chat row in "What's built"; note `react-markdown` dep.
