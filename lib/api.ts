import { NextResponse } from "next/server";
import { can, getSession, scopeFor, type SessionUser } from "./auth";
import { ACCESS, type Action, type ModuleKey } from "./roles";
import { getStore } from "./store";
import type { Filters, Scope, Store } from "./types";

type Ok = { user: SessionUser; store: Store; scope: Scope };

/** `action` gates writes; `module` gates reads to the pages that role is allowed to open (any one of them, if a list). */
export async function requireUser(action?: Action, module?: ModuleKey | ModuleKey[]): Promise<Ok | { res: NextResponse }> {
  const user = await getSession();
  if (!user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (action && !can(user, action)) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const modules = module === undefined ? [] : Array.isArray(module) ? module : [module];
  if (modules.length && !modules.some((m) => ACCESS[user.role].includes(m))) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const store = getStore();
  return { user, store, scope: scopeFor(user, store) };
}

const RANGES: Filters["range"][] = ["today", "7d", "30d", "mtd", "custom"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function filtersFrom(url: URL): Filters {
  const p = url.searchParams;
  const range = p.get("range") as Filters["range"] | null;
  const from = p.get("from"), to = p.get("to");
  return {
    range: range && RANGES.includes(range) ? range : "30d",
    from: from && ISO_DAY.test(from) ? from : undefined,
    to: to && ISO_DAY.test(to) ? to : undefined,
    portfolio: p.get("portfolio") ?? undefined,
    product: p.get("product") ?? undefined,
    channel: p.get("channel") ?? undefined,
  };
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
