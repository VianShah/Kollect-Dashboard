import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { saveStore, tick } from "@/lib/store";

// Poll target for notifications. Advances demo traffic, then returns events after `since`.
export async function GET(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const { store, scope } = a;
  if (tick(store)) saveStore(store, { throttle: true });
  const since = Number(new URL(req.url).searchParams.get("since") ?? -1);
  const visible = store.events.filter((e) => !scope.portfolio || e.portfolio === scope.portfolio);
  const events = since < 0 ? visible.slice(-15) : visible.filter((e) => e.id > since);
  return NextResponse.json({ events, lastId: store.eventSeq, live: store.demo.live });
}
