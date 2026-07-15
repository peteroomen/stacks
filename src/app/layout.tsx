import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Stacks — album listening tracker",
  description: "Your listening, rated and remembered.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0a1520",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" data-theme="abyss">
      <body className="min-h-screen">
        <div className="navbar bg-base-200/60 backdrop-blur border-b border-base-content/10 sticky top-0 z-30">
          <div className="flex-1">
            <Link href="/" className="btn btn-ghost text-xl font-black tracking-tight">
              stacks<span className="text-primary">.</span>
            </Link>
          </div>
          {user && (
            <nav className="flex items-center gap-1">
              <Link href="/" className="btn btn-ghost btn-sm">
                Dashboard
              </Link>
              <Link href="/library" className="btn btn-ghost btn-sm">
                Library
              </Link>
              <form action="/auth/signout" method="post">
                <button type="submit" className="btn btn-ghost btn-sm text-base-content/60">
                  Sign out
                </button>
              </form>
            </nav>
          )}
        </div>
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">{children}</main>
      </body>
    </html>
  );
}
