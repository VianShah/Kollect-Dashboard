import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { clientPortfolio } from "@/lib/auth";
import { windowOpen } from "@/lib/contact";
import { LANGUAGES } from "@/lib/languages";
import { SCENARIOS, campaignsFor, languageUnserved } from "@/lib/mock";

export async function GET() {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const { store, user } = a;
  return NextResponse.json({
    scenario: store.scenario,
    scenarios: Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label, products: s.products.map((p) => p.name) })),
    portfolios: user.role === "client" ? [clientPortfolio(user, store)] : store.portfolios,
    products: store.products,
    campaigns: campaignsFor(store.scenario, store.languages),
    languages: LANGUAGES,
    enabledLanguages: store.languages,
    unservedBorrowers: user.role === "client" ? 0 : store.borrowers.filter((b) => languageUnserved(b, store.languages)).length,
    windowOpen: windowOpen(store.compliance),
    source: store.source,
    live: store.demo.live,
    clientPortfolio: user.role === "client" ? clientPortfolio(user, store) : null,
    updatedAt: store.updatedAt,
  });
}
