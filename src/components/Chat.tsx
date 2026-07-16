"use client";

import { useEffect, useRef } from "react";
import { useChat } from "ai/react";
import type { Message, ToolInvocation } from "ai";
import ReactMarkdown from "react-markdown";
import { ytMusicUrl } from "@/lib/yt";

const STORAGE_KEY = "stacks-chat-v1";

const EXAMPLES = [
  "What have I been playing this month?",
  "Set Rumours to a 9 — earned it",
  "Something like Madvillainy but jazzier",
];

// Album cards from a show_albums result — reuses the dashboard "recently played" look.
type CardAlbum = {
  id: string;
  artist: string;
  title: string;
  year: number | null;
  rating: number | null;
  cover_art_url: string | null;
  listen_count: number;
};

function AlbumCards({ albums }: { albums: CardAlbum[] }) {
  if (!albums.length) return null;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 mt-1">
      {albums.map((a) => (
        <a key={a.id} href={ytMusicUrl(a.artist, a.title)} target="_blank"
          rel="noopener noreferrer" title={`Play ${a.title} on YouTube Music`}
          className="group w-24 shrink-0 space-y-1">
          {a.cover_art_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.cover_art_url} alt="" loading="lazy"
              className="aspect-square w-full rounded-md object-cover shadow-md
                         group-hover:ring-2 ring-primary transition" />
          ) : (
            <div className="cover-fallback aspect-square w-full rounded-md shadow-md
                            group-hover:ring-2 ring-primary transition flex items-center justify-center">
              <span className="rating-num text-lg font-black text-base-content/60">
                {a.rating ?? "?"}
              </span>
            </div>
          )}
          <div className="text-[11px] font-semibold truncate flex items-center gap-1">
            <span className="truncate">{a.title}</span>
            {a.rating != null && (
              <span className="badge badge-xs badge-primary shrink-0">{a.rating}</span>
            )}
          </div>
          <div className="text-[10px] text-base-content/60 truncate -mt-1">{a.artist}</div>
        </a>
      ))}
    </div>
  );
}

// One-line summary for a tool call, shown as an activity chip.
function chipLabel(inv: ToolInvocation): { icon: string; text: string; write: boolean } {
  const args = (inv.args ?? {}) as Record<string, unknown>;
  const result = inv.state === "result" ? (inv.result as Record<string, unknown> | undefined) : undefined;
  const err = result?.error as string | undefined;

  switch (inv.toolName) {
    case "search_library": {
      const q = (args.q ?? args.artist ?? args.genreParent ?? "library") as string;
      const n = result?.count as number | undefined;
      return { icon: "🔍", text: err ? `search failed` : `searched *${q}*${n != null ? ` — ${n} results` : ""}`, write: false };
    }
    case "get_album":
      return { icon: "📖", text: "opened an album", write: false };
    case "listening_stats": {
      const w = (args.window ?? "30d") as string;
      const by = (args.by ?? "album") as string;
      const label = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days", "365d": "last year", all: "all time" }[w] ?? w;
      return { icon: "📊", text: `stats: ${label} by ${by}`, write: false };
    }
    case "update_album": {
      if (err) return { icon: "✏️", text: "edit failed", write: true };
      const before = result?.before as Record<string, unknown> | undefined;
      const after = result?.after as Record<string, unknown> | undefined;
      const title = (after?.title ?? before?.title ?? "album") as string;
      const changes: string[] = [];
      if (before && after) {
        for (const k of ["rating", "collection_status", "comments"] as const) {
          if (before[k] !== after[k]) {
            changes.push(k === "comments" ? "notes updated" : `${k === "collection_status" ? "status" : k} ${before[k] ?? "—"} → ${after[k] ?? "—"}`);
          }
        }
      }
      return { icon: "✏️", text: `*${title}*: ${changes.join(", ") || "updated"}`, write: true };
    }
    case "add_album": {
      if (err) return { icon: "➕", text: "add failed", write: true };
      const alb = result?.album as Record<string, unknown> | undefined;
      const title = (alb?.title ?? "album") as string;
      if (result?.already_existed) return { icon: "➕", text: `*${title}* already in library`, write: true };
      const status = (alb?.collection_status ?? "Wishlist") as string;
      return { icon: "➕", text: `added *${title}* to ${status}`, write: true };
    }
    case "show_albums":
      return { icon: "🎴", text: "showing albums", write: false };
    default:
      return { icon: "⚙️", text: inv.toolName, write: false };
  }
}

function ToolChip({ inv }: { inv: ToolInvocation }) {
  // show_albums renders as cards, not a chip.
  if (inv.toolName === "show_albums" && inv.state === "result") {
    const albums = ((inv.result as { albums?: CardAlbum[] } | undefined)?.albums ?? []) as CardAlbum[];
    return <AlbumCards albums={albums} />;
  }
  const pending = inv.state !== "result";
  const { icon, text, write } = chipLabel(inv);
  return (
    <div
      className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border w-fit
        ${write ? "border-warning/40 bg-warning/10 text-warning" : "border-base-content/15 bg-base-content/5 text-base-content/70"}
        ${pending ? "opacity-60" : ""}`}
    >
      <span>{icon}</span>
      {/* Minimal emphasis rendering: *word* → bold. */}
      <span>
        {text.split(/(\*[^*]+\*)/).map((seg, i) =>
          seg.startsWith("*") && seg.endsWith("*") ? (
            <strong key={i}>{seg.slice(1, -1)}</strong>
          ) : (
            <span key={i}>{seg}</span>
          )
        )}
      </span>
      {pending && <span className="loading loading-dots loading-xs" />}
    </div>
  );
}

// Assistant text rendered as themed markdown; links open in a new tab.
function MarkdownText({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed space-y-2
                    [&_p]:my-1 [&_strong]:font-semibold
                    [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1
                    [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1 [&_li]:my-0.5
                    [&_code]:bg-base-content/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs">
      <ReactMarkdown
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="link link-primary">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, status, error, append, reload, setMessages } =
    useChat({ api: "/api/chat" });
  const bottomRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  // Hydrate from localStorage once on mount (after SSR, so no markup mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length) setMessages(saved as Message[]);
      }
    } catch {
      /* corrupt storage → start fresh */
    }
    hydrated.current = true;
  }, [setMessages]);

  // Persist the thread whenever it changes (only after hydration).
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* quota / serialization — non-fatal */
    }
  }, [messages]);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const busy = status === "streaming" || status === "submitted";

  const newChat = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setMessages([]);
  };

  return (
    <div className="card bg-base-200/40 border border-base-content/10 h-[calc(100dvh-12rem)] min-h-[420px] flex flex-col">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Companion</span>
        {messages.length > 0 && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={newChat}>
            New chat
          </button>
        )}
      </div>

      <div className="card-body p-4 pt-2 gap-3 overflow-y-auto flex-1">
        {messages.length === 0 && (
          <div className="text-sm text-base-content/50 space-y-2">
            <p>Try:</p>
            <ul className="space-y-1">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button type="button"
                    className="link link-hover text-left"
                    onClick={() => append({ role: "user", content: ex })}>
                    · “{ex}”
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`chat ${m.role === "user" ? "chat-end" : "chat-start"}`}>
            <div
              className={`chat-bubble text-sm ${m.role === "user" ? "chat-bubble-primary whitespace-pre-wrap" : "bg-base-100/60"}`}
            >
              {m.role === "user"
                ? m.content
                : (m.parts ?? []).map((part, i) => {
                    if (part.type === "text") return <MarkdownText key={i} text={part.text} />;
                    if (part.type === "tool-invocation")
                      return (
                        <div key={i} className="my-1">
                          <ToolChip inv={part.toolInvocation} />
                        </div>
                      );
                    return null;
                  })}
            </div>
          </div>
        ))}

        {status === "submitted" && (
          <div className="chat chat-start"><div className="chat-bubble">
            <span className="loading loading-dots loading-sm" /></div></div>
        )}
        {error && (
          <div className="chat chat-start">
            <div className="chat-bubble chat-bubble-error text-sm">
              Something went wrong.{" "}
              <button type="button" className="link" onClick={() => reload()}>Retry</button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t border-base-content/10 flex gap-2">
        <input value={input} onChange={handleInputChange}
          className="input input-bordered input-sm flex-1"
          placeholder="Ask, search, or edit your library…" />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
