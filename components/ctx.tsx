"use client";
import { createContext, useContext } from "react";
import type { Lang } from "@/lib/languages";
import type { CampaignDef } from "@/lib/mock";
import type { Filters, Role, ScenarioKey, Scope } from "@/lib/types";

export interface Meta {
  scenario: ScenarioKey;
  scenarios: { key: ScenarioKey; label: string; products: string[] }[];
  portfolios: string[];
  products: string[];
  campaigns: CampaignDef[];
  languages: Lang[];
  enabledLanguages: string[];
  unservedBorrowers: number;
  windowOpen: boolean;
  source: "mock" | "excel" | "api";
  live: boolean;
  clientPortfolio: string | null;
}

export interface Ctx {
  user: { username: string; name: string; role: Role; portfolio?: string };
  filters: Filters;
  setFilters: (f: Filters) => void;
  qs: string;
  meta: Meta;
  refreshMeta: () => Promise<void>;
  scope: Scope;
  version: number;
  bump: () => void;
  openBorrower: (idOrLoan: string) => void;
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);
