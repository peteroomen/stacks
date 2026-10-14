import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Daily ping so free-tier Supabase projects never hit the 7-day inactivity pause.
// Deliberately independent of app config/data. Protected by CRON_SECRET like the other crons.
//
// - personal-apps (this app's DB, shared with budget-app/forkcast): touched through two
//   separate paths so one breaking (e.g. `stacks` dropped from the exposed schemas) doesn't
//   silence the other.
// - guitar-ai-db: a separate project with no app of its own on a schedule; pinged via GoTrue
//   (auth.users lookup = a real Postgres query) using GUITAR_AI_SUPABASE_URL +
//   GUITAR_AI_SUPABASE_SERVICE_ROLE_KEY. Reported as "not configured" (and fails) until set.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();

  // 1. PostgREST → stacks schema (also surfaces exposure breakage in the cron logs).
  const rest = await supabase.from("albums").select("id", { count: "exact", head: true });

  // 2. GoTrue → auth.users. Hits Postgres without going through PostgREST's schema list.
  const authPing = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });

  // 3. guitar-ai-db.
  let guitar = "not configured";
  const gUrl = process.env.GUITAR_AI_SUPABASE_URL;
  const gKey = process.env.GUITAR_AI_SUPABASE_SERVICE_ROLE_KEY;
  if (gUrl && gKey) {
    const g = await createClient(gUrl, gKey, { auth: { persistSession: false } })
      .auth.admin.listUsers({ page: 1, perPage: 1 });
    guitar = g.error ? g.error.message : "ok";
  }

  const result = {
    rest: rest.error ? rest.error.message : "ok",
    auth: authPing.error ? authPing.error.message : "ok",
    guitar,
  };
  // 500 if anything failed so it shows up red in Vercel's cron logs.
  const ok = Object.values(result).every((v) => v === "ok");
  if (!ok) console.error("keepalive failed", result);
  return NextResponse.json(result, { status: ok ? 200 : 500 });
}
