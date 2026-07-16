# "Did you mean?" — artist/title verification sweep

## Why

The library's artist/title strings come from a hand-typed CSV, and typos
fossilize: *Rumors*, *Speaking In Tounges*, *Progidy*, *Kraftwek* survived
multiple enrichment passes because Deezer/MusicBrainz exact-ish matching is
unforgiving. Every typo silently blocks cover art, tracklists, and play
rollup for that album. Two manual correction sweeps (2026-07-16) fixed 32
albums; this makes that repeatable and catches future imports at the door.

## What

A new pipeline script, `scripts/verify_titles.mjs`, following the house
pattern (`node --env-file=.env.local`, dry-run by default, `--apply` to
write, idempotent, resumable):

```
node --env-file=.env.local scripts/verify_titles.mjs [--all] [--llm] [--apply] [--limit=N]
```

### Scope

Default: only albums **missing an enrichment signal** — no tracks, or no
`cover_art_url`, or no `mbid`. A typo is the plausible blocker exactly for
those; fully-enriched albums already matched something real. `--all` sweeps
everything (useful once, or after schema changes).

### Pipeline per album

1. **Normalize** what we have: un-sort the artist ("Beatles, The" → "The
   Beatles"), strip edition suffixes from the title (reuse the existing
   `unsort`/`stripEdition`/`norm` patterns from `import_takeout.mjs`).
2. **Candidate lookup, typo-tolerant:**
   - Primary: Deezer free-text album search (`search/album?q=<artist> <title>`,
     no field scoping — the field-scoped form is exact-ish; free text is the
     typo-tolerant one). Top 5 candidates. ~150 ms between calls.
   - Fallback: MusicBrainz release-group search when Deezer returns nothing
     (1.1 s between calls, proper User-Agent — same etiquette as
     `enrich_covers.mjs`).
3. **Score** each candidate against ours with normalized Levenshtein
   similarity, computed separately for artist and title (title compared
   after edition-stripping both sides). Small helper, ~20 lines, no deps.
4. **Classify:**
   - `ok` — a candidate is norm-identical (only case/punctuation/diacritics
     differ). Not a typo; never suggest (protects deliberate stylings).
   - `suggest` (high confidence) — best candidate has artist similarity ≥ 0.80
     AND title similarity ≥ 0.75, but differs on the normalized string
     (a real edit, e.g. Theif→Thief). These are written by `--apply`.
   - `ambiguous` — something matched but below thresholds (e.g. artist
     credit differs entirely: Various Artists vs Kendrick Lamar). Reported,
     never auto-applied.
   - `no_match` — nothing plausible found (Vallow, Fabriclive-type cases).
     Reported for manual review.
5. **`--llm` (optional):** ambiguous cases are batched to the Anthropic API
   (claude-haiku-4-5, plain `fetch`, no new deps; needs `ANTHROPIC_API_KEY`)
   with a strict-JSON prompt: given our string and the candidates, return
   `{same: bool, artist, title}` per album. LLM-confirmed corrections are
   applied only with `--apply --llm`, and printed distinctly.

### Output

- Console table: `current → suggested (similarity, source, class)`.
- `scripts/out/title_report.csv` for the full sweep (gitignored dir already
  used for generated output).
- With `--apply`: prints every write as `old → new`; only `suggest`-class
  (and LLM-confirmed) rows are written. `updated_at` is touched by the
  existing trigger; `nat_key` deliberately untouched (it's an import-dedupe
  key, not derived from current strings).

### Guard rails

- Never touches `rating` / `comments` / `listen_count` — artist/title only.
- Never applies `ambiguous`/`no_match` without the LLM path explicitly on.
- `--limit=N` for a bounded trial run.
- Deezer error/quota responses → retry with backoff (same as sibling
  scripts); MB 503 → single retry then skip.

## Not in scope (this pass)

- Import-time integration (running the check inside `import_takeout.mjs`).
  The sweep is composable: run it after any import. Wire-in can come later.
- Renaming to sort-name conventions or any style normalization — this only
  fixes wrongness, not style.

## Acceptance

- `npm run typecheck` stays green (script is plain .mjs; nothing app-side
  changes).
- Script self-verifies with a stubbed-fetch smoke test (sandbox has no
  egress to Deezer/MB): known typo pairs (Theif→Thief, Progidy→The Prodigy)
  classify as `suggest`; norm-identical pairs classify as `ok`; garbage
  classifies as `no_match`.
- README pipeline-scripts section gains one line.
