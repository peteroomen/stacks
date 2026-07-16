import { anthropic } from "@ai-sdk/anthropic";
import { convertToCoreMessages, streamText, tool, type Message } from "ai";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { buildLibraryDigest } from "@/lib/digest";
import { natKey } from "@/lib/albums";
import { trimHistory } from "@/lib/history";

export const maxDuration = 30;

// Compact projection the model reasons over — full rows stay behind get_album.
const LIST_COLS =
  "id, artist, title, year, genre, genre_parent, rating, listen_count, collection_status, comments";

// PostgREST's .or() treats , ( ) as structure and " \ as quoting; strip those so
// a search like `(What's the Story)` can't 400 the request. Same fix as /api/albums.
const orIlike = (raw: string) => {
  const safe = raw.replace(/[\\"]/g, " ").trim();
  return safe
    ? `artist.ilike."%${safe}%",title.ilike."%${safe}%",comments.ilike."%${safe}%"`
    : null;
};

const WINDOW_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
  all: null,
};

// POST /api/chat — streaming chat with hands (search / read / edit / stats) over
// the caller's own library. All tools run on the RLS session client, so they can
// only ever touch this user's rows; no service-role anywhere in this path.
export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: Message[] };
  const supabase = await supabaseServer();

  // Digest stays as taste/voice grounding; hard facts now come from tools —
  // so the chat gets the slim shape (insights keeps the full one).
  const { data: albums } = await supabase.from("albums").select("*");
  const digest = buildLibraryDigest(albums ?? [], {
    favourites: 15,
    revisit: 12,
    comments: 12,
  });

  const tools = {
    search_library: tool({
      description:
        "Search the listener's library. Returns compact album rows (with ids) to cite or feed into other tools.",
      parameters: z.object({
        q: z.string().optional().describe("free text over artist/title/comments"),
        artist: z.string().optional(),
        genreParent: z.string().optional(),
        ratingMin: z.number().min(0).max(10).optional(),
        ratingMax: z.number().min(0).max(10).optional(),
        unratedOnly: z.boolean().optional(),
        sort: z
          .enum(["rating.desc", "rating.asc", "year.desc", "year.asc", "listen_count.desc", "artist.asc"])
          .optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async (a) => {
        try {
          let query = supabase.from("albums").select(LIST_COLS);
          if (a.q) {
            const clause = orIlike(a.q);
            if (clause) query = query.or(clause);
          }
          if (a.artist) query = query.ilike("artist", `%${a.artist}%`);
          if (a.genreParent) query = query.eq("genre_parent", a.genreParent);
          if (a.ratingMin != null) query = query.gte("rating", a.ratingMin);
          if (a.ratingMax != null) query = query.lte("rating", a.ratingMax);
          if (a.unratedOnly) query = query.is("rating", null);
          const [col, dir] = (a.sort ?? "rating.desc").split(".");
          query = query.order(col, { ascending: dir === "asc", nullsFirst: false });
          const { data, error } = await query.limit(a.limit ?? 12);
          if (error) return { error: error.message };
          const rows = (data ?? []).map(({ comments, ...r }) => ({
            ...r,
            has_comments: !!comments,
          }));
          return { count: rows.length, albums: rows };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "search failed" };
        }
      },
    }),

    get_album: tool({
      description:
        "Full detail for one album by id: comments and the tracklist (track_no, title, rating, play_count, duration_ms).",
      parameters: z.object({ id: z.string().uuid() }),
      execute: async ({ id }) => {
        try {
          const { data: album, error } = await supabase
            .from("albums")
            .select(LIST_COLS)
            .eq("id", id)
            .single();
          if (error) return { error: error.message };
          const { data: tracks } = await supabase
            .from("tracks")
            .select("track_no, title, rating, play_count, duration_ms")
            .eq("album_id", id)
            .order("track_no", { ascending: true, nullsFirst: false });
          return { album, tracks: tracks ?? [] };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "lookup failed" };
        }
      },
    }),

    update_album: tool({
      description:
        "Edit one album (rating 0–10, comments, or collection_status). Only call on a clear request; returns before/after so you can echo the change.",
      parameters: z.object({
        id: z.string().uuid(),
        rating: z.number().min(0).max(10).nullable().optional(),
        comments: z.string().max(10_000).nullable().optional(),
        collection_status: z.string().max(100).nullable().optional(),
      }),
      execute: async ({ id, ...patch }) => {
        try {
          const clean = Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== undefined)
          );
          if (Object.keys(clean).length === 0) return { error: "nothing to update" };
          const { data: before, error: readErr } = await supabase
            .from("albums")
            .select("id, artist, title, rating, comments, collection_status")
            .eq("id", id)
            .single();
          if (readErr) return { error: readErr.message };
          const { data: after, error } = await supabase
            .from("albums")
            .update(clean)
            .eq("id", id)
            .select("id, artist, title, rating, comments, collection_status")
            .single();
          if (error) return { error: error.message };
          // Echo only what changed (plus identity) — a rating tweak shouldn't
          // replay a 10K-char comments field into the context on every step.
          const clip = (v: unknown) =>
            typeof v === "string" && v.length > 200 ? v.slice(0, 197) + "…" : v;
          const beforeOut: Record<string, unknown> = { id, artist: after.artist, title: after.title };
          const afterOut: Record<string, unknown> = { ...beforeOut };
          for (const k of ["rating", "comments", "collection_status"] as const) {
            if (before[k] !== after[k]) {
              beforeOut[k] = clip(before[k]);
              afterOut[k] = clip(after[k]);
            }
          }
          return { before: beforeOut, after: afterOut };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "update failed" };
        }
      },
    }),

    add_album: tool({
      description:
        "Add an album to the library (defaults to Wishlist). Only call on a clear request. Dupe-checked; if it already exists it returns the existing row with already_existed: true.",
      parameters: z.object({
        artist: z.string().min(1).max(300),
        title: z.string().min(1).max(300),
        year: z.number().int().min(1900).max(2100).nullable().optional(),
        genre: z.string().max(100).optional(),
        collection_status: z.string().max(100).optional(),
      }),
      execute: async ({ artist, title, year, genre, collection_status }) => {
        try {
          const key = natKey(artist, title, year);
          // Pre-check: exact nat_key, or a case-insensitive artist+title match.
          const { data: byKey } = await supabase
            .from("albums")
            .select(LIST_COLS)
            .eq("nat_key", key)
            .limit(1);
          const { data: byName } = await supabase
            .from("albums")
            .select(LIST_COLS)
            .ilike("artist", artist)
            .ilike("title", title)
            .limit(1);
          const existing = byKey?.[0] ?? byName?.[0];
          if (existing) return { album: existing, already_existed: true };

          const { data: userRes } = await supabase.auth.getUser();
          const owner = userRes.user?.id;
          if (!owner) return { error: "not signed in" };

          const { data, error } = await supabase
            .from("albums")
            .insert({
              owner_id: owner,
              artist,
              title,
              year: year ?? null,
              genre: genre ?? null,
              collection_status: collection_status ?? "Wishlist",
              source: "chat",
              nat_key: key,
            })
            .select(LIST_COLS)
            .single();
          if (error) return { error: error.message };
          return { album: data, already_existed: false };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "add failed" };
        }
      },
    }),

    listening_stats: tool({
      description:
        "Top-N listening stats from the plays timeline, grouped by album, artist, or genre over a time window. " +
        "spins = full album listening sessions (>=3 distinct tracks within a 4h window, same definition as the importer); " +
        "track_plays = raw per-track scrobbles. Describe album listening in spins, not track_plays — " +
        "24 track_plays of a 12-track album is two listens, not twenty-four.",
      parameters: z.object({
        window: z.enum(["7d", "30d", "90d", "365d", "all"]).optional(),
        by: z.enum(["album", "artist", "genre"]).optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async ({ window = "30d", by = "album", limit = 10 }) => {
        try {
          let query = supabase
            .from("plays")
            .select("album_id, listened_at, track, albums(artist, title, genre_parent, cover_art_url)")
            .not("album_id", "is", null)
            .order("listened_at", { ascending: false })
            .limit(5000);
          const days = WINDOW_DAYS[window];
          if (days != null) {
            const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
            query = query.gte("listened_at", cutoff);
          }
          const { data, error } = await query;
          if (error) return { error: error.message };

          type Row = {
            album_id: string;
            listened_at: string;
            track: string;
            albums: {
              artist: string;
              title: string;
              genre_parent: string | null;
              cover_art_url: string | null;
            } | null;
          };
          const rows = (data ?? []) as unknown as Row[];

          // Sessionize per album first — a "spin" is a cluster of that album's
          // plays within a 4h gap containing >=3 distinct tracks (the importer's
          // definition), so one stray shuffle track never counts as a listen.
          const GAP_MS = 4 * 60 * 60 * 1000;
          const MIN_TRACKS = 3;
          const byAlbumRows = new Map<string, Row[]>();
          for (const p of rows) {
            (byAlbumRows.get(p.album_id) ?? byAlbumRows.set(p.album_id, []).get(p.album_id)!).push(p);
          }
          const albumStats = new Map<
            string,
            { alb: Row["albums"]; spins: number; track_plays: number; last: string }
          >();
          for (const [albumId, ps] of byAlbumRows) {
            const sorted = [...ps].sort((a, b) => a.listened_at.localeCompare(b.listened_at));
            let spins = 0;
            let prev = -Infinity;
            let cur: Set<string> | null = null;
            const flush = () => { if (cur && cur.size >= MIN_TRACKS) spins++; };
            for (const p of sorted) {
              const at = new Date(p.listened_at).getTime();
              if (at - prev > GAP_MS) { flush(); cur = new Set(); }
              cur!.add(p.track.toLowerCase());
              prev = at;
            }
            flush();
            albumStats.set(albumId, {
              alb: ps[0].albums,
              spins,
              track_plays: ps.length,
              last: sorted[sorted.length - 1].listened_at,
            });
          }

          // Aggregate album stats up to the requested grouping.
          const groups = new Map<
            string,
            { label: string; spins: number; track_plays: number; albums: Set<string>; last: string }
          >();
          for (const [albumId, s] of albumStats) {
            const label =
              by === "artist"
                ? s.alb?.artist ?? "Unknown"
                : by === "genre"
                ? s.alb?.genre_parent ?? "Unknown"
                : s.alb
                ? `${s.alb.artist} — ${s.alb.title}`
                : "Unknown";
            const key = by === "album" ? albumId : label;
            const g =
              groups.get(key) ??
              { label, spins: 0, track_plays: 0, albums: new Set<string>(), last: s.last };
            g.spins += s.spins;
            g.track_plays += s.track_plays;
            g.albums.add(albumId);
            if (s.last > g.last) g.last = s.last;
            groups.set(key, g);
          }
          const top = [...groups.entries()]
            .sort(([, x], [, y]) => y.spins - x.spins || y.track_plays - x.track_plays)
            .slice(0, limit)
            .map(([key, g]) => {
              // Album grouping = single-album groups; enrich for the stats card
              // (cover thumb + YT link need artist/title/cover, id for drill-in).
              const alb = by === "album" ? albumStats.get(key)?.alb : null;
              return {
                label: g.label,
                spins: g.spins,
                track_plays: g.track_plays,
                distinct_albums: g.albums.size,
                last_played: g.last,
                album_id: by === "album" ? key : undefined,
                artist: alb?.artist,
                title: alb?.title,
                cover_art_url: alb?.cover_art_url ?? null,
              };
            });
          return { window, by, results: top };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "stats failed" };
        }
      },
    }),

    show_albums: tool({
      description:
        "Render album cards in the UI for the given library album ids (max 8). Use after recommending albums that are already in the library. Ids must come from earlier tool results — never invent them.",
      parameters: z.object({ ids: z.array(z.string().uuid()).min(1).max(8) }),
      execute: async ({ ids }) => {
        try {
          const { data, error } = await supabase
            .from("albums")
            .select("id, artist, title, year, rating, cover_art_url, listen_count")
            .in("id", ids);
          if (error) return { error: error.message };
          // Preserve the model's requested order.
          const byId = new Map((data ?? []).map((a) => [a.id, a]));
          const albums = ids.map((id) => byId.get(id)).filter(Boolean);
          return { albums };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "show failed" };
        }
      },
    }),
  };

  const system = [
    "You are a music companion for one listener, grounded in THEIR album library.",
    "You know their ratings (0–10), their genres, and — most importantly — their own written notes.",
    "Speak to their actual taste. Reference specific albums they own by artist and title.",
    "When you recommend something NOT in their library, say so plainly and give one sentence of why it fits, tied to their notes or ratings.",
    "Never invent albums. If unsure an album exists, say you're not certain and suggest they verify.",
    "Be concise and opinionated, like a friend with great taste — not a database.",
    "",
    "TOOLS — you can search, read, edit, and pull stats from their library:",
    "- Use search_library / get_album / listening_stats to check facts instead of guessing. Never invent album ids; ids come only from tool results.",
    "- Only call update_album or add_album when the user clearly asks for the change. After a write, restate exactly what changed (e.g. 'Rumours: rating 8 → 9').",
    "- REQUIRED, not optional: whenever your reply recommends or highlights specific albums that ARE in the library (revisits, deep cuts, favourites), you MUST also call show_albums with their ids — the UI renders them as cards. Do not end such a reply without calling it.",
    "- listening_stats results render as a ranked stats card in the UI automatically. Do NOT retype the ranking as a list; add one or two observations about it instead.",
    "- When you recommend albums NOT in the library, give each a YouTube Music link as a markdown link: [Artist — Title](https://music.youtube.com/search?q=<url-encoded 'Artist Title'>). Un-sort names like 'Beatles, The' to 'The Beatles' first.",
    "",
    "LIBRARY DIGEST (JSON):",
    JSON.stringify(digest),
  ].join("\n");

  // Prompt caching: tools + system + digest render first, so a breakpoint on
  // the system message caches the whole fixed prefix (~3.5K tokens) — every
  // step after the first, and every later turn, reads it at ~0.1× price. The
  // digest is deterministic (see digest.ts), so the prefix bytes repeat.
  const cached = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

  const history = convertToCoreMessages(trimHistory(messages));
  // Second breakpoint on the newest message: later turns re-read the whole
  // history up to here instead of re-paying it at full price.
  const last = history[history.length - 1];
  if (last) last.providerOptions = cached;

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    messages: [{ role: "system", content: system, providerOptions: cached }, ...history],
    tools,
    maxSteps: 6,
    onFinish: ({ usage, providerMetadata }) => {
      // One line in the Vercel logs to confirm caching works in production:
      // cacheRead should be non-zero from the second step of any tool turn on.
      const a = providerMetadata?.anthropic as
        | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
        | undefined;
      console.log(
        `[chat] in=${usage.promptTokens} out=${usage.completionTokens}` +
          ` cacheRead=${a?.cacheReadInputTokens ?? 0} cacheWrite=${a?.cacheCreationInputTokens ?? 0}`
      );
    },
  });
  return result.toDataStreamResponse();
}
