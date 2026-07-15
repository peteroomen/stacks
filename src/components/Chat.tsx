"use client";

import { useEffect, useRef } from "react";
import { useChat } from "ai/react";

const EXAMPLES = [
  "Something like Madvillainy but jazzier",
  "Which Bowie era am I missing?",
  "Build me a 5-album path into post-punk",
];

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, status, error, append, reload } =
    useChat({ api: "/api/chat" });
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const busy = status === "streaming" || status === "submitted";

  return (
    <div className="card bg-base-200/40 border border-base-content/10 h-[calc(100dvh-12rem)] min-h-[420px] flex flex-col">
      <div className="card-body p-4 gap-3 overflow-y-auto flex-1">
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
            <div className={`chat-bubble text-sm whitespace-pre-wrap ${m.role === "user" ? "chat-bubble-primary" : ""}`}>
              {m.content}
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
          placeholder="Ask anything about your taste…" />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
