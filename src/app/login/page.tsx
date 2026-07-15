"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
      setMessage(`Check ${email} for a sign-in link.`);
    }
  }

  async function signInWithGoogle() {
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="card bg-base-200/60 border border-base-content/10 w-full max-w-sm">
        <div className="card-body gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              stacks<span className="text-primary">.</span>
            </h1>
            <p className="text-sm text-base-content/60">Sign in to your library.</p>
          </div>

          <button
            type="button"
            onClick={signInWithGoogle}
            className="btn btn-outline w-full"
            aria-label="Continue with Google"
          >
            Continue with Google
          </button>

          <div className="divider text-xs text-base-content/40 my-1">or</div>

          <form onSubmit={sendMagicLink} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input input-bordered w-full"
              autoComplete="email"
            />
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={status === "sending" || status === "sent"}
            >
              {status === "sending" ? "Sending…" : "Email me a magic link"}
            </button>
          </form>

          {message && (
            <p
              className={`text-sm ${status === "error" ? "text-error" : "text-base-content/70"}`}
              role="status"
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
