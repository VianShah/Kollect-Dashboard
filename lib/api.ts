import { NextResponse } from "next/server";
import { can, getSession, scopeFor, type SessionUser } from "./auth";
import type { Action } from "./roles";
import { getStore } from "./store";
import type { Filters, Scope, Store } from "./types";

type Ok = { user: SessionUser; store: Store; scope: Scope };

export async function requireUser(action?: Action): Promise<Ok | { res: NextResponse }> {
  const user = await getSession();
  if (!user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (action && !can(user, action)) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const store = getStore();
  return { user, store, scope: scopeFor(user, store) };
}

export function filtersFrom(url: URL): Filters {
  const p = url.searchParams;
  return {
    range: (p.get("range") as Filters["range"]) ?? "30d",
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    portfolio: p.get("portfolio") ?? undefined,
    product: p.get("product") ?? undefined,
    channel: p.get("channel") ?? undefined,
  };
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
