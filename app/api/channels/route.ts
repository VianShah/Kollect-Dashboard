import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { windowOpen } from "@/lib/contact";
import { FALLBACK_LANGUAGE, LANGUAGES } from "@/lib/languages";
import { languageUnserved, syncAgents } from "@/lib/mock";
import { audit, saveStore, tick } from "@/lib/store";
import type { Store } from "@/lib/types";

const payload = (s: Store) => {
  const need = new Map<string, number>();
  for (const b of s.borrowers) need.set(b.language, (need.get(b.language) ?? 0) + 1);
  return {
    agents: s.agents,
    globalMax: s.globalMax,
    live: s.agents.reduce((n, x) => n + x.live, 0),
    languages: LANGUAGES.map((l) => ({ ...l, enabled: s.languages.includes(l.name), borrowers: need.get(l.name) ?? 0 })),
    fallback: FALLBACK_LANGUAGE,
    unserved: s.borrowers.filter((b) => languageUnserved(b, s.languages)).length,
  };
};

export async function GET() {
  const a = await requireUser(undefined, "channels");
  if ("res" in a) return a.res;
  const { store } = a;
  if (tick(store)) saveStore(store, { throttle: true });
  // While on demo data, live channel counts drift so the capacity view moves. Real sources report their own.
  if (store.source === "mock" && store.demo.live) {
    const open = windowOpen(store.compliance); // no lines are busy outside calling hours
    for (const ag of store.agents) ag.live = open ? Math.max(0, Math.min(ag.max, ag.live + Math.round(Math.random() * 2 - 1))) : 0;
  }
  return NextResponse.json(payload(store));
}

// { globalMax?, recalculate?, agentId?, max?, languages?: string[] }
export async function PATCH(req: Request) {
  const a = await requireUser("editCapacity");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  if (Array.isArray(body.languages)) {
    const next = LANGUAGES.map((l) => l.name).filter((n) => body.languages.includes(n));
    if (!next.includes(FALLBACK_LANGUAGE)) return bad(`${FALLBACK_LANGUAGE} must stay on. It is the fallback for borrowers whose language isn't enabled.`);
    const added = next.filter((n) => !store.languages.includes(n)), removed = store.languages.filter((n) => !next.includes(n));
    if (added.length || removed.length) {
      store.languages = next;
      syncAgents(store);
      audit(store, user, "languages_changed", "Languages", [added.length ? `on: ${added.join(", ")}` : "", removed.length ? `off: ${removed.join(", ")}` : ""].filter(Boolean).join("; "));
    }
  }
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
