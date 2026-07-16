import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { buildLibraryDigest } from "@/lib/digest";

// Schema-enforced output: no "STRICT JSON" prompting, no markdown-fence
// stripping, and a malformed reply can't burn the whole spend into a 502.
const InsightsSchema = z.object({
  revisit_queue: z.object({
    title: z.string(),
    items: z.array(z.object({ album: z.string(), why: z.string() })),
  }),
  blind_spots: z.object({
    title: z.string(),
    items: z.array(z.object({ area: z.string(), why: z.string() })),
  }),
  recent_run: z.object({ title: z.string(), summary: z.string() }),
  recommendations: z.object({
    items: z.array(z.object({ album: z.string(), why: z.string() })),
  }),
});

export const maxDuration = 60;

// GET  /api/insights          -> return cached cards
// POST /api/insights (refresh) -> regenerate + cache
export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("insights").select("*");
  return NextResponse.json({ insights: data ?? [] });
}

export async function POST() {
  const supabase = await supabaseServer();
  const { data: userRes } = await supabase.auth.getUser();
  const owner = userRes.user?.id;
  if (!owner) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: albums } = await supabase.from("albums").select("*");
  const digest = buildLibraryDigest(albums ?? []);

  const prompt = `Given this listener's library digest, produce four insight cards.
Rules: revisit_queue must draw from revisitCandidates. Recommendations must be real albums NOT already
owned, each justified against their ratings or notes. Keep every "why" under 22 words.

DIGEST:
${JSON.stringify(digest)}`;

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: InsightsSchema,
    prompt,
  });

  const rows = Object.entries(object).map(([kind, payload]) => ({
    owner_id: owner, kind, payload, generated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("insights").upsert(rows, { onConflict: "owner_id,kind" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ insights: rows });
}
