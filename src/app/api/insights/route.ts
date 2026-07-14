import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { supabaseServer } from "@/lib/supabase/server";
import { buildLibraryDigest } from "@/lib/digest";

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

  const prompt = `Given this listener's library digest, produce four insight cards as STRICT JSON
(no markdown, no prose outside JSON) with this shape:
{
  "revisit_queue":   { "title": string, "items": [{ "album": string, "why": string }] },
  "blind_spots":     { "title": string, "items": [{ "area": string, "why": string }] },
  "recent_run":      { "title": string, "summary": string },
  "recommendations": { "items": [{ "album": string, "why": string }] }
}
Rules: revisit_queue must draw from revisitCandidates. Recommendations must be real albums NOT already
owned, each justified against their ratings or notes. Keep every "why" under 22 words.

DIGEST:
${JSON.stringify(digest)}`;

  const { text } = await generateText({ model: anthropic("claude-sonnet-4-6"), prompt });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return NextResponse.json({ error: "model returned non-JSON", raw: text }, { status: 502 });
  }

  const rows = Object.entries(parsed).map(([kind, payload]) => ({
    owner_id: owner, kind, payload, generated_at: new Date().toISOString(),
  }));
  await supabase.from("insights").upsert(rows, { onConflict: "owner_id,kind" });
  return NextResponse.json({ insights: rows });
}
