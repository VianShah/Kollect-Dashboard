import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { SCENARIOS } from "@/lib/mock";
import { audit, loadScenario, saveStore } from "@/lib/store";
import type { ScenarioKey } from "@/lib/types";

// { scenario?: "nbfc"|"bank"|"bnpl", live?: boolean, reset?: true }
export async function POST(req: Request) {
  const a = await requireUser("demo");
  if ("res" in a) return a.res;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_USERS !== "1") return bad("Demo controls are disabled in production", 404);
  if (a.store.source !== "mock") return bad("This instance holds real data. Demo controls are only available on demo data.", 409);
  const body = await req.json().catch(() => ({}));
  let store = a.store;
  if (body.scenario || body.reset) {
    const key = (body.scenario ?? store.scenario) as ScenarioKey;
    if (!SCENARIOS[key]) return bad("Unknown scenario");
    store = loadScenario(key);
    audit(store, a.user, body.reset ? "demo_reset" : "demo_scenario", SCENARIOS[key].label);
  }
  if (typeof body.live === "boolean") {
    store.demo.live = body.live;
    store.demo.lastTick = Date.now();
    audit(store, a.user, "demo_live_traffic", body.live ? "on" : "off");
  }
  saveStore(store);
  return NextResponse.json({ scenario: store.scenario, live: store.demo.live });
}
