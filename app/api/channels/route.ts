import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { audit, saveStore, tick } from "@/lib/store";
import type { Store } from "@/lib/types";

const payload = (s: Store) => ({ agents: s.agents, globalMax: s.globalMax, live: s.agents.reduce((n, x) => n + x.live, 0) });

export async function GET() {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const { store } = a;
  if (tick(store)) saveStore(store, { throttle: true });
  // While on demo data, live channel counts drift so the capacity view moves. Real sources report their own.
  if (store.source === "mock" && store.demo.live) {
    for (const ag of store.agents) ag.live = Math.max(0, Math.min(ag.max, ag.live + Math.round(Math.random() * 2 - 1)));
  }
  return NextResponse.json(payload(store));
}

// { globalMax?, recalculate?, agentId?, max? }
export async function PATCH(req: Request) {
  const a = await requireUser("editCapacity");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  if (typeof body.globalMax === "number" && body.globalMax > 0) store.globalMax = Math.floor(body.globalMax);
  if (body.agentId && typeof body.max === "number") {
    const ag = store.agents.find((x) => x.id === body.agentId);
    if (ag) {
      audit(store, user, "capacity_agent", ag.code, `max ${ag.max} → ${Math.max(0, Math.floor(body.max))}`);
      ag.max = Math.max(0, Math.floor(body.max)); ag.live = Math.min(ag.live, ag.max);
    }
  }
  if (body.recalculate) {
    const total = store.agents.reduce((s, x) => s + x.max, 0) || 1;
    store.agents.forEach((ag) => { ag.max = Math.max(1, Math.round((ag.max / total) * store.globalMax)); ag.live = Math.min(ag.live, ag.max); });
    audit(store, user, "capacity_global", "All agents", `global max ${store.globalMax}`);
  }
  saveStore(store);
  return NextResponse.json(payload(store));
}
