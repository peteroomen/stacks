"use client";

import { useChat } from "ai/react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    api: "/api/chat",
  });

  return (
    <div className="card bg-base-200/40 border border-base-content/10 h-[70vh] sm:h-[520px] flex flex-col">
      <div className="card-body p-4 gap-3 overflow-y-auto flex-1">
        {messages.length === 0 && (
          <div className="text-sm text-base-content/50 space-y-2">
            <p>Try:</p>
            <ul className="space-y-1">
              <li>· “Something like Madvillainy but jazzier”</li>
              <li>· “Which Bowie era am I missing?”</li>
              <li>· “Build me a 5-album path into post-punk”</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat ${m.role === "user" ? "chat-end" : "chat-start"}`}>
            <div className={`chat-bubble text-sm ${m.role === "user" ? "chat-bubble-primary" : ""}`}>
              {m.content}
            </div>
          </div>
        ))}
        {status === "streaming" && (
          <div className="chat chat-start"><div className="chat-bubble">
            <span className="loading loading-dots loading-sm" /></div></div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="p-3 border-t border-base-content/10 flex gap-2">
        <input value={input} onChange={handleInputChange}
          className="input input-bordered input-sm flex-1"
          placeholder="Ask anything about your taste…" />
        <button className="btn btn-primary btn-sm" type="submit"
          disabled={status === "streaming"}>Send</button>
      </form>
    </div>
  );
}
