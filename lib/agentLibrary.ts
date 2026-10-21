// The Agent library: every voice agent from the Kollect State Machine (kollect-statemachine.onrender.com/api/agent-catalog),
// snapshotted into agentCatalog.json with lender names anonymised. Refresh the snapshot to pick up new agents.
import catalog from "./agentCatalog.json";

export interface LibraryAgent {
  id: string; name: string; gender?: string;
  service: string; line: "Collections" | "Sales" | string;
  products: string[]; stage?: string; objective: string;
  personaTone: string; toneNote?: string; description: string;
  languages: string[]; rating?: number; status: "Live" | "Dev" | "Demo" | string; real?: boolean;
  provider?: string; minutesSpoken?: number; callsPlaced?: number;
  performance?: { latencyMs?: number; qcScore?: number; wordsPerMin?: number };
  badge?: string; client?: string; bestRegion?: string; variables?: string[];
}

export const AGENTS = catalog.agents as LibraryAgent[];
export const FACETS = catalog.facets as Record<"services" | "products" | "stages" | "objectives" | "languages" | "personas", string[]>;

/** The dashboard's product names, as the catalog writes them. */
const PRODUCT_ALIAS: Record<string, string[]> = {
  "Credit Card": ["Credit Cards"], "Two-Wheeler Loan": ["Two-Wheeler Loan", "Auto Loan", "Vehicle Loan"], BNPL: ["BNPL"], "Personal Loan": ["Personal Loan"],
};
/** Stages in the catalog mapped to the dashboard's DPD buckets. */
export const STAGE_FOR_BUCKET: Record<string, string> = { Current: "Pre-due", "1–30": "Bucket X", "31–60": "Bucket 1", "61–90": "Bucket 2", "90+": "Bucket 3" };
export const STAGE_LABEL: Record<string, string> = { "Pre-due": "Pre-due", "Bucket X": "Bucket X · 1–30 DPD", "Bucket 1": "Bucket 1 · 31–60 DPD", "Bucket 2": "Bucket 2 · 61–90 DPD", "Bucket 3": "Bucket 3 · 90+ DPD" };

export const handlesProduct = (a: LibraryAgent, product: string) => (PRODUCT_ALIAS[product] ?? [product]).some((p) => a.products.includes(p));

/** Collections agents that fit a product, stage and language, best first (QC score, then rating, then minutes). */
export function bestAgents(opts: { product?: string; bucket?: string; languages?: string[]; limit?: number }) {
  const stage = opts.bucket ? STAGE_FOR_BUCKET[opts.bucket] : undefined;
  return AGENTS.filter((a) => a.line === "Collections" && a.status !== "Dev"
      && (!opts.product || handlesProduct(a, opts.product))
      && (!stage || a.stage === stage)
      && (!opts.languages?.length || a.languages.some((l) => opts.languages!.includes(l) || l === "Hinglish")))
    .sort((a, b) => (b.performance?.qcScore ?? 0) - (a.performance?.qcScore ?? 0) || (b.rating ?? 0) - (a.rating ?? 0) || (b.minutesSpoken ?? 0) - (a.minutesSpoken ?? 0))
    .slice(0, opts.limit ?? 12);
}
