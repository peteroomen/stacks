import type { Album } from "./types";

/**
 * Compress a ~700-album library into a compact digest the LLM can reason over
 * without blowing the context window. This is the RAG-lite grounding used by
 * both the dashboard insight cards and the chat. Ratings AND comments are the
 * signal that makes recommendations feel personal rather than generic.
 *
 * Must be byte-stable for identical inputs: the chat route puts this in a
 * prompt-cached prefix, and any nondeterminism (Math.random, Date.now) would
 * silently invalidate the cache on every request.
 */
export type DigestOptions = {
  favourites?: number;
  revisit?: number;
  comments?: number;
};

export function buildLibraryDigest(albums: Album[], opts: DigestOptions = {}) {
  const { favourites = 30, revisit = 25, comments = 20 } = opts;
  const rated = albums.filter((a) => a.rating != null);
  const byParent = tally(albums.map((a) => a.genre_parent ?? "Unknown"));
  const byDecade = tally(
    albums.filter((a) => a.year).map((a) => `${Math.floor(a.year! / 10) * 10}s`)
  );

  // Top artists by album count
  const artistCounts = tally(albums.map((a) => a.artist));
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([artist, n]) => `${artist} (${n})`);

  // Albums whose comments hint you haven't cracked them yet — the revisit signal
  const revisitPhrases = /need (more|another|a few).*(listen|time)|more listens|didn'?t (quite )?(get|click|land)|grow(er)?|hasn'?t clicked|want(ed)? to (re)?listen/i;
  const revisitCandidates = rated
    .filter((a) => a.rating! >= 5.5 && a.rating! <= 7.5 && a.comments && revisitPhrases.test(a.comments))
    .map((a) => `${a.artist} — ${a.title} (${a.rating}, "${trim(a.comments!)}")`)
    .slice(0, revisit);

  // A sample of your actual notes so the model hears your voice. Selection is a
  // pseudo-random spread (hash order, not rating order) but DETERMINISTIC —
  // same library in, same bytes out — so the prompt cache can actually hit.
  const commentSample = albums
    .filter((a) => a.comments)
    .sort((a, b) => hash(a.artist + "|" + a.title) - hash(b.artist + "|" + b.title))
    .slice(0, comments)
    .map((a) => `${a.artist} — ${a.title} [${a.rating ?? "?"}]: "${trim(a.comments!)}"`);

  const highRated = rated
    .filter((a) => a.rating! >= 9)
    .map((a) => `${a.artist} — ${a.title} (${a.rating})`)
    .slice(0, favourites);

  return {
    totals: {
      albums: albums.length,
      rated: rated.length,
      artists: new Set(albums.map((a) => a.artist)).size,
      avgRating: rated.length ? round(rated.reduce((s, a) => s + a.rating!, 0) / rated.length) : null,
    },
    genreParentDistribution: byParent,
    decadeDistribution: byDecade,
    topArtists,
    favourites: highRated,
    revisitCandidates,
    commentSample,
  };
}

function tally(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}
// djb2 string hash — a cheap, stable "random" ordering key. NOT Math.random:
// per-request randomness in the digest would bust the prompt cache every turn.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
const round = (n: number) => Math.round(n * 10) / 10;
const trim = (s: string) => (s.length > 140 ? s.slice(0, 137) + "…" : s);
