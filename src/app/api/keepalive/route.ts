import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Daily ping so the free-tier Supabase project never hits the 7-day inactivity pause.
// Deliberately independent of app config/data. Protected by CRON_SECRET like the other crons.
//
// personal-apps (this app's DB, shared with budget-app/forkcast) is touched through two
// separate paths so one breaking (e.g. `stacks` dropped from the exposed schemas) doesn't
// silence the other. Other projects (e.g. guitar-ai-db) keep themselves awake from their
// own apps.
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

  const result = {
    rest: rest.error ? rest.error.message || `HTTP ${rest.status}` : "ok",
    auth: authPing.error ? authPing.error.message : "ok",
  };
  // 500 if anything failed so it shows up red in Vercel's cron logs.
  const ok = Object.values(result).every((v) => v === "ok");
  if (!ok) console.error("keepalive failed", result);
  return NextResponse.json(result, { status: ok ? 200 : 500 });
}
