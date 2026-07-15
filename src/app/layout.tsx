import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Vinyl } from "@/components/Vinyl";
import NavLinks from "@/components/NavLinks";

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
            <Link href="/" className="btn btn-ghost text-2xl font-black tracking-tight">
              stacks<Vinyl />
            </Link>
          </div>
          {user && (
            <nav className="flex items-center gap-1">
              <NavLinks />
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="btn btn-ghost btn-sm rounded-lg text-base-content/60 transition-colors hover:bg-error/15 hover:text-error"
                >
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
