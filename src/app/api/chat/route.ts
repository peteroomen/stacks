import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { supabaseServer } from "@/lib/supabase/server";
import { buildLibraryDigest } from "@/lib/digest";

export const maxDuration = 30;

// POST /api/chat  — streaming chat grounded in the user's library digest.
export async function POST(req: Request) {
  const { messages } = await req.json();
  const supabase = await supabaseServer();
  const { data: albums } = await supabase.from("albums").select("*");
  const digest = buildLibraryDigest(albums ?? []);

  const system = [
    "You are a music companion for one listener, grounded in THEIR album library.",
    "You know their ratings (0–10), their genres, and — most importantly — their own written notes.",
    "Speak to their actual taste. Reference specific albums they own by artist and title.",
    "When you recommend something NOT in their library, say so plainly and give one sentence of why it fits, tied to their notes or ratings.",
    "Never invent albums. If unsure an album exists, say you're not certain and suggest they verify.",
    "Be concise and opinionated, like a friend with great taste — not a database.",
    "",
    "LIBRARY DIGEST (JSON):",
    JSON.stringify(digest),
  ].join("\n");

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system,
    messages,
  });
  return result.toDataStreamResponse();
}
