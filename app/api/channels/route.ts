import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { windowOpen } from "@/lib/contact";
import { FALLBACK_LANGUAGE, LANGUAGES } from "@/lib/languages";
import { COMM_CHANNELS, capacityOf, channelRows, drift, rebalance } from "@/lib/lines";
import { languageUnserved, syncAgents } from "@/lib/mock";
import { audit, saveStore, tick } from "@/lib/store";
import type { CommChannel, Store } from "@/lib/types";

const payload = (s: Store) => {
  const need = new Map<string, number>();
  for (const b of s.borrowers) need.set(b.language, (need.get(b.language) ?? 0) + 1);
  const channels = channelRows(s);
  return {
    agents: s.agents,
    channels,
    total: {
      live: channels.reduce((n, c) => n + c.live, 0),
      capacity: channels.reduce((n, c) => n + c.capacity, 0),
      lines: channels.filter((c) => c.unit === "line").reduce((n, c) => n + c.lines, 0),
      seats: channels.filter((c) => c.unit === "seat").reduce((n, c) => n + c.lines, 0),
    },
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
  // On demo data the live counts move so the view feels real; real dialers report their own through ingest.
  if (store.source === "mock" && store.demo.live) drift(store, windowOpen(store.compliance));
  return NextResponse.json(payload(store));
}

// { channel?, lines?, recalculate?, agentId?, max?, languages?: string[] }
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
  if (body.channel !== undefined) {
    const def = COMM_CHANNELS.find((c) => c.key === body.channel);
    if (!def) return bad("Unknown channel");
    const n = body.lines;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > def.maxLines) return bad(`${def.key} takes 0 to ${def.maxLines} ${def.unit}s`);
    const key = def.key as CommChannel;
    const before = store.lines[key].lines;
    store.lines[key].lines = n;
    store.lines[key].live = Math.min(store.lines[key].live, n * def.perLine);
    rebalance(store, key);
    if (before !== n) audit(store, user, "channel_lines", key, `${before} → ${n} ${def.unit}s (${n * def.perLine} concurrent)`);
  }
  if (body.agentId && typeof body.max === "number") {
    const ag = store.agents.find((x) => x.id === body.agentId);
    if (ag) {
      const key = COMM_CHANNELS.find((c) => c.agentChannel === ag.channel)?.key;
      const cap = key ? capacityOf(store, key) : 1000;
      const max = Math.max(0, Math.min(cap, Math.floor(body.max)));
      audit(store, user, "capacity_agent", ag.code, `max ${ag.max} → ${max}`);
      ag.max = max; ag.live = Math.min(ag.live, ag.max);
    }
  }
  if (body.recalculate) {
    rebalance(store);
    audit(store, user, "capacity_global", "All campaigns", "Capacity shared evenly within each channel");
  }
  saveStore(store);
  return NextResponse.json(payload(store));
}
