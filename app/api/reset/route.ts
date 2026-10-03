import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { audit, loadScenario, saveStore } from "@/lib/store";

export async function POST() {
  const a = await requireUser("upload");
  if ("res" in a) return a.res;
  const s = loadScenario(a.store.scenario);
  audit(s, a.user, "data_reset", "Mock data");
  saveStore(s);
  return NextResponse.json({ source: s.source });
}
