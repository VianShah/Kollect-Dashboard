"use client";
// Offline fallback: the same seeded mock the server starts from, computed in the browser.
import { DEFAULT_LANGUAGES, LANGUAGES } from "@/lib/languages";
import { SCENARIOS, campaignsFor, generateStore } from "@/lib/mock";
import type { Store } from "@/lib/types";
import type { Meta } from "./ctx";

let cache: Store | null = null;
export const localStore = (): Store => (cache ??= generateStore("nbfc"));

export const localMeta = (): Meta => ({
  scenario: "nbfc",
  scenarios: (Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((key) => ({ key, label: SCENARIOS[key].label, products: SCENARIOS[key].products.map((p) => p.name) })),
  portfolios: SCENARIOS.nbfc.portfolios,
  products: SCENARIOS.nbfc.products.map((p) => p.name),
  campaigns: campaignsFor("nbfc"),
  languages: LANGUAGES,
  enabledLanguages: DEFAULT_LANGUAGES,
  unservedBorrowers: 0,
  windowOpen: true,
  source: "mock",
  live: false,
  clientPortfolio: null,
});
