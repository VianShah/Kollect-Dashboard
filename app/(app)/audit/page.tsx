import { redirect } from "next/navigation";

/** Conversations now live in Accounts. Old links (QC drill-downs, bookmarks) keep working. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") p.set(k, v);
  p.set("tab", "Conversations");
  redirect(`/borrowers?${p.toString()}`);
}
