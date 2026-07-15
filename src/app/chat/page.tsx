import Chat from "@/components/Chat";

export default function ChatPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
          Ask about your library<span className="text-primary">.</span>
        </h1>
        <p className="text-base-content/60 text-sm">
          Recommendations and insights grounded in your ratings and your own notes.
        </p>
      </div>
      <Chat />
    </div>
  );
}
