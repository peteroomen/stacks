import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

// Handles the redirect back from Supabase for both flows:
//  - OAuth (Google) and PKCE magic links arrive with ?code=...
//  - Email OTP magic links may arrive with ?token_hash=...&type=...
//
// Session cookies are bound directly to the redirect response so they reliably
// reach the browser (otherwise the exchange succeeds but the session never
// persists and middleware bounces back to /login).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next") ?? "/";
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // --- diagnostics (temporary) ---
  const cookieNames = request.cookies.getAll().map((c) => c.name);
  console.log("[auth/callback] incoming", {
    hasCode: !!code,
    hasTokenHash: !!tokenHash,
    type,
    cookieNames,
    hasVerifier: cookieNames.some((n) => n.includes("code-verifier") || n.includes("auth-token")),
  });

  const success = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]
        ) => cookiesToSet.forEach(({ name, value, options }) => success.cookies.set(name, value, options)),
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return success;
    console.error("[auth/callback] exchangeCodeForSession failed:", error.status, error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return success;
    console.error("[auth/callback] verifyOtp failed:", error.status, error.message);
  } else {
    console.error("[auth/callback] no code or token_hash present");
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
