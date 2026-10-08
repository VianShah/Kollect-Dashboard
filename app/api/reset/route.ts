import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { audit, loadScenario, saveStore } from "@/lib/store";

// Replaces uploaded data with the demo dataset. Needs { confirm: "RESET" } so it cannot be triggered by accident.
export async function POST(req: Request) {
  const a = await requireUser("upload");
  if ("res" in a) return a.res;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_USERS !== "1") return bad("Reset is disabled in production", 404);
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "RESET") return bad("Confirm the reset by sending confirm: \"RESET\"");
  const s = loadScenario(a.store.scenario);
  audit(s, a.user, "data_reset", "Mock data");
  saveStore(s);
  return NextResponse.json({ source: s.source });
}
