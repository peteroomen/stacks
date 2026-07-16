import type { Message } from "ai";

// Keep the model's view of the conversation bounded: localStorage threads live
// for days and, unchecked, every turn re-sends the whole transcript (including
// every stale tool payload) × every step of the tool loop.
const MAX_MESSAGES = 16;
// Tool payloads (album rows, stats tables) stay useful for a beat or two, then
// are dead weight. Keep them on the newest assistant turns only.
const KEEP_TOOL_RESULTS = 2;

/**
 * Trim a useChat message history before it goes to the model:
 *  - keep only the most recent MAX_MESSAGES messages,
 *  - strip tool-invocation parts from all but the last KEEP_TOOL_RESULTS
 *    assistant messages (the UI keeps its own full copy client-side),
 *  - drop assistant messages left with no content at all.
 */
export function trimHistory(messages: Message[]): Message[] {
  const recent = messages.slice(-MAX_MESSAGES);
  const assistantIdx = recent
    .map((m, i) => (m.role === "assistant" ? i : -1))
    .filter((i) => i >= 0);
  const keepTools = new Set(assistantIdx.slice(-KEEP_TOOL_RESULTS));

  return recent
    .map((m, i) => {
      if (m.role !== "assistant" || keepTools.has(i)) return m;
      const parts = (m.parts ?? []).filter((p) => p.type !== "tool-invocation");
      return { ...m, parts, toolInvocations: undefined };
    })
    .filter(
      (m) =>
        m.role !== "assistant" ||
        (m.parts?.length ?? 0) > 0 ||
        (typeof m.content === "string" && m.content.length > 0)
    );
}
