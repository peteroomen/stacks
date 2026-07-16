// "Did you mean?" — verify album artist/title strings against the real world and
// fix the fossilized typos (Rumors, Progidy, Kraftwek, Speaking In Tounges) that
// silently block cover art, tracklists, and play rollup.
//
// Run (Node >= 20.6, reads .env.local for the Supabase service-role key):
//   node --env-file=.env.local scripts/verify_titles.mjs [--all] [--llm] [--apply] [--limit=N]
//
// DRY RUN by default: looks up each album (Deezer free-text search, MusicBrainz
// fallback), scores candidates with normalized Levenshtein similarity, prints a
// `current → suggested` table, and writes scripts/out/title_report.csv. Nothing
// is written to the DB until you add --apply.
//
//   --all       sweep every album (default: only albums missing an enrichment
//               signal — no tracks, or no cover_art_url, or no mbid; a typo is
//               the plausible blocker exactly for those).
//   --llm       batch the ambiguous cases to the Anthropic API (claude-haiku-4-5,
//               needs ANTHROPIC_API_KEY) for a same/different verdict.
//   --apply     write the corrections. Only `suggest`-class rows (and, with
//               --llm, LLM-confirmed ones) are written — artist/title only.
//   --limit=N   bound the run to N albums (trial run).
//   --self-test run the offline classifier smoke test and exit (no env/network).
//
// Only artist/title are ever touched, scoped by album id. nat_key / rating /
// comments / listen_count are never modified.

const flags = process.argv.slice(2);
const SELF_TEST = flags.includes("--self-test");
const ALL = flags.includes("--all");
const LLM = flags.includes("--llm");
const APPLY = flags.includes("--apply");
const LIMIT = Number((flags.find((f) => f.startsWith("--limit=")) || "=0").split("=")[1]) || 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- normalizers
// Copied from import_takeout.mjs (these scripts are self-contained by convention).
const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const unsort = (a) => String(a).replace(/^(.*?),\s*(the|a|an)$/i, "$2 $1");
// normalize an artist for matching: un-sort, then drop a leading article, since
// the library mixes "Beatles, The" / "The Kinks" / "smashing pumpkins".
const akey = (a) => norm(unsort(a)).replace(/^(?:the|a|an) /, "");
// Drop reissue/edition cruft so "Abbey Road (Remastered)" / "(Super Deluxe Edition)"
// collapse onto the album you actually own. Keeps legit tags like "(Soundtrack)".
const stripEdition = (t) => String(t)
  .replace(/\s*[([][^)\]]*\b(remaster(?:ed)?|deluxe|expanded|reissue|mono|stereo|anniversary|special\s*edition|bonus|collector'?s|version|edition)\b[^)\]]*[)\]]/gi, "")
  .replace(/\s*[-–]\s*(\d{4}\s*[-–]?\s*)?(remaster(?:ed)?|deluxe|expanded|mono|stereo|\d+(?:st|nd|rd|th)?\s*anniversary|special\s*edition).*$/gi, "")
  .replace(/\s{2,}/g, " ").trim();
// title comparison key: edition-stripped, then normalized.
const tkey = (t) => norm(stripEdition(t));

// ---------------------------------------------------------------- similarity
// Classic Levenshtein edit distance (iterative, two-row DP), no deps.
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
// Normalized similarity in [0,1]: 1.0 == identical, degrades with edit distance.
const sim = (a, b) => {
  if (!a && !b) return 1;
  const total = a.length + b.length;
  return total ? (total - levenshtein(a, b)) / total : 1;
};

const ART_MIN = 0.80; // artist similarity floor for a confident suggestion
const TIT_MIN = 0.75; // title similarity floor for a confident suggestion

// Classify our (artist,title) against a list of {artist,title,source} candidates.
// Returns { klass, best, artistSim, titleSim } where klass is one of
// ok | suggest | ambiguous | no_match.
function classify(ourArtist, ourTitle, candidates) {
  if (!candidates || !candidates.length) return { klass: "no_match", best: null, artistSim: 0, titleSim: 0 };
  const oa = akey(ourArtist), ot = tkey(ourTitle);
  const scored = candidates.map((c) => {
    const artistSim = sim(oa, akey(c.artist));
    const titleSim = sim(ot, tkey(c.title));
    const identical = akey(c.artist) === oa && tkey(c.title) === ot;
    return { ...c, artistSim, titleSim, identical, score: artistSim + titleSim };
  }).sort((x, y) => y.score - x.score);
  const best = scored[0];
  // ok: a candidate is norm-identical — only case/punctuation/diacritics differ.
  // Not a typo; never suggest (protects deliberate stylings).
  if (best.identical) return { klass: "ok", best, artistSim: best.artistSim, titleSim: best.titleSim };
  // suggest: high confidence on both fields, and it's a real edit (differs on the
  // normalized string). These are the rows --apply writes.
  if (best.artistSim >= ART_MIN && best.titleSim >= TIT_MIN) {
    return { klass: "suggest", best, artistSim: best.artistSim, titleSim: best.titleSim };
  }
  // something matched but below thresholds (e.g. Various Artists vs Kendrick Lamar).
  return { klass: "ambiguous", best, artistSim: best.artistSim, titleSim: best.titleSim };
}

// ---------------------------------------------------------------- self-test
// Runs entirely offline (no env, no network): exercises the normalizers,
// Levenshtein, and classification against fixture cases. Exits non-zero on any
// failure. Deliberately runs BEFORE env validation so CI can invoke it bare.
function runSelfTest() {
  let failed = 0;
  const check = (name, cond) => { if (cond) { console.log(`  ok   ${name}`); } else { console.log(`  FAIL ${name}`); failed++; }; };

  // normalizers
  check("unsort 'Beatles, The' -> 'The Beatles'", unsort("Beatles, The") === "The Beatles");
  check("akey un-sorts + drops article", akey("Beatles, The") === "beatles" && akey("The Beatles") === "beatles");
  check("stripEdition drops remaster cruft", tkey("Abbey Road (Remastered)") === "abbey road");
  // levenshtein
  check("levenshtein theif/thief == 2", levenshtein("theif", "thief") === 2);
  check("levenshtein identical == 0", levenshtein("prodigy", "prodigy") === 0);
  check("sim identical == 1", sim("prodigy", "prodigy") === 1);

  // classification fixtures (candidate lists as they'd arrive from a lookup)
  const cases = [
    { name: "Theif -> Thief", a: "Radiohead", t: "Hail to the Theif", cands: [{ artist: "Radiohead", title: "Hail to the Thief", source: "fixture" }], want: "suggest" },
    { name: "Progidy -> The Prodigy", a: "Progidy", t: "The Fat of the Land", cands: [{ artist: "The Prodigy", title: "The Fat of the Land", source: "fixture" }], want: "suggest" },
    { name: "Beatles, The == The Beatles (norm-identical)", a: "Beatles, The", t: "Abbey Road", cands: [{ artist: "The Beatles", title: "Abbey Road", source: "fixture" }], want: "ok" },
    { name: "Vallow / Sunroom (no candidates)", a: "Vallow", t: "Sunroom", cands: [], want: "no_match" },
    { name: "Various Artists vs Kendrick Lamar (artist too low)", a: "Various Artists", t: "Black Panther - The Album", cands: [{ artist: "Kendrick Lamar", title: "Black Panther The Album", source: "fixture" }], want: "ambiguous" },
  ];
  for (const c of cases) {
    const got = classify(c.a, c.t, c.cands).klass;
    check(`${c.name} -> ${c.want} (got ${got})`, got === c.want);
  }

  if (failed) { console.error(`\nself-test: ${failed} failure(s).`); process.exit(1); }
  console.log("\nself-test: all passed.");
  process.exit(0);
}

if (SELF_TEST) runSelfTest();

// ---------------------------------------------------------------- env (live run)
const { createClient } = await import("@supabase/supabase-js");
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER = process.env.OWNER_USER_ID;
if (!SUPA_URL || !KEY || !OWNER) { console.error("Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OWNER_USER_ID)"); process.exit(1); }
if (LLM && !process.env.ANTHROPIC_API_KEY) { console.error("--llm needs ANTHROPIC_API_KEY"); process.exit(1); }

const supabase = createClient(SUPA_URL, KEY, { db: { schema: "stacks" }, auth: { persistSession: false } });
const UA = "stacks-album-tracker/1.0 (petertheoomen@gmail.com)";

// ---------------------------------------------------------------- lookups
// Primary: Deezer free-text album search. Free text (no field scoping) is the
// typo-tolerant form — the field-scoped query is exact-ish and would miss the
// very typos we're hunting. Top 5 candidates. ~150 ms between calls.
async function deezerCandidates(artist, title) {
  const q = `${unsort(artist)} ${stripEdition(title)}`.replace(/[[\]()★]/g, " ").replace(/\s+/g, " ").trim();
  const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) return [];
      const data = await res.json();
      if (data?.error) { await sleep(1000 * (attempt + 1)); continue; } // quota — back off
      return (data.data ?? []).slice(0, 5).map((r) => ({ artist: r.artist?.name ?? "", title: r.title ?? "", source: "deezer" }));
    } catch { await sleep(700 * (attempt + 1)); }
  }
  return [];
}

// Fallback: MusicBrainz release-group search when Deezer returns nothing. Same
// etiquette as enrich_covers.mjs — 1.1 s between calls, real User-Agent. MB 503
// gets a single retry, then we skip.
async function mbCandidates(artist, title) {
  const q = `artist:"${unsort(artist).replace(/"/g, " ")}" AND releasegroup:"${stripEdition(title).replace(/"/g, " ")}"`;
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=5`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 503) { await sleep(1100); continue; }
      if (!res.ok) return [];
      const data = await res.json();
      return (data["release-groups"] ?? []).slice(0, 5).map((g) => ({
        artist: g["artist-credit"]?.map((c) => c.name).join(g["artist-credit"]?.[0]?.joinphrase || "") || g["artist-credit"]?.[0]?.name || "",
        title: g.title ?? "",
        source: "mb",
      }));
    } catch { await sleep(1100); }
  }
  return [];
}

// ---------------------------------------------------------------- llm (optional)
// Batch the ambiguous cases to the Anthropic Messages API for a same/different
// verdict. Strict JSON out; plain fetch, no new deps. Chunked so a big sweep
// can't truncate the JSON array at max_tokens (silently dropping verdicts),
// and compact-serialized — pretty-printing is ~30-40% more input tokens for
// zero model benefit.
const LLM_BATCH = 25;
async function llmVerdictsBatch(rows, offset) {
  const items = rows.map((r, i) => ({
    index: i,
    have: { artist: r.artist, title: r.title },
    candidates: r.candidates.slice(0, 5).map((c) => ({ artist: c.artist, title: c.title })),
  }));
  const prompt = `You are cleaning a personal album library. Each item has the artist/title we currently have stored (possibly with a typo) and a list of real-world candidate albums. For each item decide whether one candidate is clearly THE SAME album as ours (just mistyped), and if so give the corrected artist and title from that candidate.

Return ONLY a JSON array, one object per item, no prose:
[{"index": <int>, "same": <bool>, "artist": "<corrected or ''>", "title": "<corrected or ''>"}]

Items:
${JSON.stringify(items)}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) { console.error(`  LLM call failed: ${res.status}`); return []; }
  const data = await res.json();
  const text = (data.content ?? []).map((c) => c.text ?? "").join("");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) { console.error("  LLM returned no JSON array"); return []; }
  try {
    const verdicts = JSON.parse(m[0]);
    // Re-base batch-local indexes onto the full ambiguous list.
    return verdicts
      .filter((v) => v && Number.isInteger(v.index) && v.index >= 0 && v.index < rows.length)
      .map((v) => ({ ...v, index: offset + v.index }));
  } catch { console.error("  LLM JSON parse failed"); return []; }
}
async function llmVerdicts(rows) {
  const out = [];
  for (let start = 0; start < rows.length; start += LLM_BATCH) {
    if (rows.length > LLM_BATCH) console.log(`  … batch ${start / LLM_BATCH + 1}/${Math.ceil(rows.length / LLM_BATCH)}`);
    out.push(...(await llmVerdictsBatch(rows.slice(start, start + LLM_BATCH), start)));
  }
  return out;
}

// ---------------------------------------------------------------- scope
const { data: albums, error } = await supabase.from("albums").select("id, artist, title, mbid, cover_art_url").eq("owner_id", OWNER);
if (error) { console.error("DB read failed:", error.message); process.exit(1); }
const { data: trackRows } = await supabase.from("tracks").select("album_id").eq("owner_id", OWNER);
const haveTracks = new Set((trackRows ?? []).map((t) => t.album_id));

let todo = ALL ? albums : albums.filter((a) => !haveTracks.has(a.id) || !a.cover_art_url || !a.mbid);
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`Verifying ${todo.length} album${todo.length === 1 ? "" : "s"}${ALL ? " (--all)" : " (missing tracks/cover/mbid)"} of ${albums.length}.${APPLY ? "" : " Dry run — nothing written."}\n`);

// ---------------------------------------------------------------- sweep
const results = [];
let ok = 0, suggestN = 0, ambiguousN = 0, noMatchN = 0;
for (const [i, a] of todo.entries()) {
  let candidates = [];
  try { candidates = await deezerCandidates(a.artist, a.title); } catch { /* ignore */ }
  await sleep(150);
  if (!candidates.length) {
    try { candidates = await mbCandidates(a.artist, a.title); } catch { /* ignore */ }
    await sleep(1100); // MusicBrainz: ~1 req/sec
  }
  const c = classify(a.artist, a.title, candidates);
  const row = { id: a.id, artist: a.artist, title: a.title, candidates, ...c };
  results.push(row);
  if (c.klass === "ok") { ok++; }
  else if (c.klass === "suggest") {
    suggestN++;
    console.log(`  ~ suggest   ${a.artist} — ${a.title}  →  ${c.best.artist} — ${c.best.title}  (a=${c.artistSim.toFixed(2)} t=${c.titleSim.toFixed(2)}, ${c.best.source})`);
  } else if (c.klass === "ambiguous") {
    ambiguousN++;
    console.log(`  ? ambiguous ${a.artist} — ${a.title}  ≈  ${c.best.artist} — ${c.best.title}  (a=${c.artistSim.toFixed(2)} t=${c.titleSim.toFixed(2)}, ${c.best.source})`);
  } else {
    noMatchN++;
    console.log(`  ✗ no match  ${a.artist} — ${a.title}`);
  }
  if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${todo.length}  (${ok} ok, ${suggestN} suggest, ${ambiguousN} ambiguous, ${noMatchN} no-match)`);
}
console.log(`\nDone scanning: ${ok} ok, ${suggestN} suggest, ${ambiguousN} ambiguous, ${noMatchN} no-match.`);

// ---------------------------------------------------------------- csv report
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvPath = new URL("./out/title_report.csv", import.meta.url);
const header = ["id", "class", "current_artist", "current_title", "suggested_artist", "suggested_title", "artist_sim", "title_sim", "source"];
const lines = [header.join(",")];
for (const r of results) {
  lines.push([
    r.id, r.klass, r.artist, r.title,
    r.best?.artist ?? "", r.best?.title ?? "",
    r.artistSim.toFixed(3), r.titleSim.toFixed(3), r.best?.source ?? "",
  ].map(csvCell).join(","));
}
const { writeFileSync } = await import("node:fs");
writeFileSync(csvPath, lines.join("\n") + "\n");
console.log(`Wrote report → scripts/out/title_report.csv (${results.length} rows).`);

// ---------------------------------------------------------------- llm pass
const llmConfirmed = new Map(); // id -> { artist, title }
if (LLM) {
  const ambiguous = results.filter((r) => r.klass === "ambiguous" && r.candidates.length);
  if (ambiguous.length) {
    console.log(`\nAsking claude-haiku-4-5 about ${ambiguous.length} ambiguous case${ambiguous.length === 1 ? "" : "s"}…`);
    const verdicts = await llmVerdicts(ambiguous);
    for (const v of verdicts) {
      const r = ambiguous[v?.index];
      if (r && v?.same && v.artist && v.title) {
        llmConfirmed.set(r.id, { artist: v.artist, title: v.title });
        console.log(`  ~ llm-fix   ${r.artist} — ${r.title}  →  ${v.artist} — ${v.title}`);
      }
    }
    console.log(`LLM confirmed ${llmConfirmed.size} correction${llmConfirmed.size === 1 ? "" : "s"}.`);
  } else {
    console.log("\nNo ambiguous cases to send to the LLM.");
  }
}

// ---------------------------------------------------------------- apply
if (!APPLY) {
  const writable = suggestN + (LLM ? llmConfirmed.size : 0);
  console.log(`\nDry run — nothing written. Re-run with --apply to commit ${writable} correction${writable === 1 ? "" : "s"}.`);
  process.exit(0);
}

console.log(`\nApplying corrections…`);
let written = 0;
// suggest-class rows
for (const r of results) {
  if (r.klass !== "suggest") continue;
  const next = { artist: r.best.artist, title: r.best.title };
  const { error: e } = await supabase.from("albums").update(next).eq("id", r.id).eq("owner_id", OWNER);
  if (e) { console.error(`  ! ${r.artist} — ${r.title}: ${e.message}`); continue; }
  console.log(`  ✓ ${r.artist} — ${r.title}  →  ${next.artist} — ${next.title}`);
  written++;
}
// LLM-confirmed corrections (only when --apply --llm)
if (LLM) {
  for (const r of results) {
    const fix = llmConfirmed.get(r.id);
    if (!fix) continue;
    const { error: e } = await supabase.from("albums").update({ artist: fix.artist, title: fix.title }).eq("id", r.id).eq("owner_id", OWNER);
    if (e) { console.error(`  ! ${r.artist} — ${r.title}: ${e.message}`); continue; }
    console.log(`  ✓ (llm) ${r.artist} — ${r.title}  →  ${fix.artist} — ${fix.title}`);
    written++;
  }
}
console.log(`\nDone. Wrote ${written} correction${written === 1 ? "" : "s"}. Re-run enrich_covers.mjs / enrich_tracks.mjs to fill the now-matchable albums.`);
