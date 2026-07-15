import Chat from "@/components/Chat";
import { Vinyl } from "@/components/Vinyl";

export default function ChatPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
          Ask about your library<Vinyl />
        </h1>
        <p className="text-base-content/60 text-sm">
          Recommendations and insights grounded in your ratings and your own notes.
        </p>
      </div>
      <Chat />
    </div>
  );
}
