# Token-efficiency audit + improvement plan

**Scope:** every place the app spends Anthropic tokens.
**Status:** implemented — all four phases below shipped in one pass. Remaining runtime check: after deploy, one tool-using chat turn should log `cacheRead > 0` (see `onFinish` logging in the chat route).

## Where tokens are spent

| Surface | Model | Frequency | Verdict |
|---|---|---|---|
| `POST /api/chat` (`src/app/api/chat/route.ts`) | `claude-sonnet-4-6` via `streamText`, 6 tools, `maxSteps: 6` | Every chat message — **the hot path** | Several inefficiencies, see findings |
| `POST /api/insights` (`src/app/api/insights/route.ts`) | `claude-sonnet-4-6` via `generateText` | Manual refresh only (button) | Minor: fragile JSON-by-prompt |
| `scripts/verify_titles.mjs --llm` | `claude-haiku-4-5` via raw fetch | Rare, offline | Minor: pretty-printed JSON, single unchunked batch |

Measured on the real seed data (692 albums, 411 with comments): the library digest serializes to **~5.6 KB ≈ 1,600 tokens**. Add the 6 tool schemas (~1.2–1.5K tokens) and the system instructions (~350 tokens) and every single API call carries a **~3.3–3.6K-token fixed prefix** before any conversation history.

The multiplier that makes this matter: `maxSteps: 6` means one user message that triggers tools becomes **2–5 API calls, each re-sending the full prefix plus the entire history**. A typical "what have I been playing?" turn (search + stats + show_albums + final text) costs roughly 15–25K input tokens today. None of it is cached.

## Findings, ranked by impact

### 1. Prompt caching is absent — and actively defeated (HIGH)

No `cacheControl` anywhere, so every step of every turn pays full input price on the ~3.5K-token prefix and the whole history.

Worse, caching couldn't work even if enabled: `buildLibraryDigest` (`src/lib/digest.ts:31`) picks `commentSample` with a Fisher–Yates **`shuffle()`** — ~680 tokens of the system prompt are re-randomized on every request, so the prompt bytes never repeat and a prefix cache can never hit across turns. (This is exactly the "silent invalidator" anti-pattern: nondeterminism early in the prompt.)

Cache reads cost ~0.1× input price. With the fix below, the fixed prefix + accumulated history get ~90% cheaper on every step after the first — the single biggest win available.

### 2. Unbounded conversation history (HIGH)

`Chat.tsx` persists the thread to `localStorage` (`stacks-chat-v1`) forever and posts the **entire** thread each turn; the server forwards it verbatim. History includes every past tool result (album rows, stats tables). A thread used across a few days grows monotonically — each new message re-pays the whole transcript × number of steps. There is no cap anywhere, client or server.

### 3. Fat tool results (MEDIUM)

Tool results enter the model context *and* get replayed in history on every subsequent step/turn:

- `get_album` returns `select("*")` — full row including `owner_id`, `nat_key`, `mbid`, `cover_art_url`, timestamps the model never uses — plus the full tracklist.
- `add_album` returns `select("*")` (and pre-check queries also select `*`).
- `update_album` returns before/after rows including the full `comments` text (up to 10K chars) even when only the rating changed.
- `search_library` and `listening_stats` are already compact — good.
- `show_albums` result must keep its payload (the client renders cards from it) — leave as is.

### 4. Digest is oversized for its current job (MEDIUM)

The route comment says it: *"Digest stays as taste/voice grounding; hard facts now come from tools."* But the digest still ships 30 favourites (329 tok), 25 revisit candidates with quotes (364 tok), and 20 comment quotes (679 tok). Since the model can now `search_library`/`get_album` for facts, the grounding blob can shrink ~40–50% without losing the "knows your taste" feel. (The insights route still wants the full digest — keep both shapes.)

Also: `select("*")` on all 692 albums runs on every chat message just to rebuild this digest. Not a token cost, but the same fix (build less, or cache the digest) helps latency and DB load.

### 5. Insights route: JSON by prompt (LOW — manual refresh only)

`generateText` + "return STRICT JSON" + regex fence-stripping + `JSON.parse` → on a malformed reply the whole spend is wasted and the user gets a 502. The AI SDK's `generateObject` with a zod schema guarantees parseable output for the same tokens.

### 6. `verify_titles.mjs` LLM pass (LOW — rare script)

- `JSON.stringify(items, null, 2)` pretty-prints the payload — ~30–40% more tokens than compact for zero model benefit.
- One unchunked request with `max_tokens: 2048`: a large ambiguous set can truncate the JSON array mid-way and silently drop verdicts.

### Non-issues checked

- Model choice (`claude-sonnet-4-6`) is current and appropriate for both routes; haiku for the script is right. No change proposed.
- `maxSteps: 6` is reasonable for the tool loop.
- Insight cards are cached in the DB and only regenerate on explicit refresh — fine.

## Plan

Ordered so each step is independently shippable; 1–3 are where the money is.

### Phase 1 — make the prefix cacheable, then cache it

1. **Make the digest deterministic** (`src/lib/digest.ts`): replace `shuffle(...)` for `commentSample` with a stable selection — e.g. sort commented albums by `rating desc, artist, title` (or a fixed hash of artist+title) and take the top 20. Variety across *days* can come from seeding on the date if wanted; never on `Math.random()` per request.
2. **Enable Anthropic prompt caching** in `/api/chat` via the AI SDK provider options — move `system` into the messages array with a cache breakpoint so tools + system + digest cache together:
   ```ts
   const result = streamText({
     model: anthropic("claude-sonnet-4-6"),
     messages: [
       {
         role: "system",
         content: system,
         providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
       },
       ...messages,
     ],
     tools,
     maxSteps: 6,
   });
   ```
   Optionally add a second breakpoint on the last user message so long threads cache incrementally. The prefix (~3.5K tok) clears Sonnet 4.6's 2,048-token cache minimum. Note: any album edit changes the digest and invalidates the cache on the *next* turn — expected and fine; within-turn steps still hit.
3. **Verify with usage logging**: in `streamText`'s `onFinish`, log `usage` + the Anthropic cache metrics from `providerMetadata` (`cache_read_input_tokens` should be non-zero from step 2 of any tool turn onward). Keep it as a one-line `console.log` — enough to confirm in Vercel logs.

Expected effect: ~90% price cut on the repeated prefix + history for every step after the first; overall chat input spend roughly **-60–75%** on tool-using turns.

### Phase 2 — bound the history

4. **Server-side cap** in `/api/chat`: keep only the most recent ~16 messages (`messages.slice(-16)`), and strip `tool-invocation` parts from all but the last two assistant messages before forwarding to the model (the UI keeps its own copy; the model rarely needs stale tool payloads).
5. **Client-side hygiene** in `Chat.tsx`: expire the `localStorage` thread after 24h (store a timestamp alongside), and cap persisted messages at ~40 so an ancient thread can't balloon a request.

### Phase 3 — slim payloads

6. **Trim tool results** in `/api/chat`:
   - `get_album`: select only `id, artist, title, year, genre, genre_parent, rating, listen_count, collection_status, comments` (reuse `LIST_COLS`); keep the tracklist as is.
   - `add_album`: return the same compact projection; pre-check queries select `id, artist, title` only.
   - `update_album`: return only the fields that changed (plus `id, artist, title`), and truncate `comments` in the echo to ~200 chars.
7. **Slim the chat digest**: add an options arg to `buildLibraryDigest` — chat uses `{ favourites: 15, revisit: 12, comments: 12 }` (~-700 tokens/prefix), insights keeps today's sizes.

### Phase 4 — small stuff

8. **Insights**: switch to `generateObject` with a zod schema for the four-card shape; delete the fence-stripping/502 path.
9. **verify_titles.mjs**: `JSON.stringify(items)` compact; chunk ambiguous cases into batches of ~25 with `max_tokens` sized per batch.

### Out of scope (deliberately)

- Model changes (e.g. Sonnet 5) — pricing/behaviour decision, not token efficiency; revisit separately.
- Moving chat threads server-side — bigger feature; Phase 2's caps solve the token problem.

## Estimated impact (typical tool-using chat turn, ~15–25K input tokens today)

| Change | Input-token / cost effect |
|---|---|
| Caching (Phase 1) | ~90% cheaper on prefix + history re-sends → biggest single win |
| History cap (Phase 2) | Bounds worst case; old threads stop costing forever |
| Result/digest trims (Phase 3) | ~1–1.5K fewer tokens per step, compounding across steps and turns |

Verification: after Phase 1 ships, one chat turn with tools should show `cache_read_input_tokens > 0` on steps ≥2 in the logs; after Phase 2, request payload size should plateau on long threads.
