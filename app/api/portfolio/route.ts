import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { computePortfolio } from "@/lib/portfolio";
import { audit, saveStore } from "@/lib/store";
import { istDay } from "@/lib/time";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "portfolio");
  if ("res" in a) return a.res;
  const url = new URL(req.url);
  const company = url.searchParams.get("company") ?? "all";
  if (company !== "all" && !a.store.portfolios.includes(company)) return bad("Unknown company", 404);
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (IST days, inclusive). Without them: this month so far.
  const day = (v: string | null, end: boolean) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T${end ? "23:59:59" : "00:00:00"}+05:30`) : NaN);
  const from = day(url.searchParams.get("from"), false), to = day(url.searchParams.get("to"), true);
  const range = Number.isNaN(from) || Number.isNaN(to) || from > to ? undefined : { from, to: Math.min(to, Date.now()) };
  return NextResponse.json(computePortfolio(a.store, company, Date.now(), range));
}

// Set a target: { company, product, target }
export async function PATCH(req: Request) {
  const a = await requireUser("editGoals");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const { company, product, target } = await req.json().catch(() => ({}));
  if (!store.portfolios.includes(company)) return bad("Choose a company");
  if (product !== "All products" && !store.products.includes(product)) return bad("Choose a product");
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0 || target > 1e10) return bad("Enter a target in rupees");
  const month = istDay(Date.now()).slice(0, 7);
  const g = store.goals.find((x) => x.company === company && x.product === product);
  const before = g?.target;
  if (g) { g.target = Math.round(target); g.setBy = user.username; g.month = month; }
  else store.goals.push({ id: `G${Date.now()}`, company, product, target: Math.round(target), month, setBy: user.username });
  audit(store, user, "goal_set", `${company} · ${product}`, `${before ?? "none"} → ${Math.round(target)}`);
  saveStore(store);
  return NextResponse.json(computePortfolio(store, "all"));
}
