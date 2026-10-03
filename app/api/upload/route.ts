import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { parseWorkbook } from "@/lib/excel";
import { audit, saveStore } from "@/lib/store";

export async function POST(req: Request) {
  const a = await requireUser("upload");
  if ("res" in a) return a.res;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("Attach an .xlsx file as 'file'");
  if (file.size > 25 * 1024 * 1024) return bad("File too large (25MB max)", 413);
  let parsed;
  try { parsed = parseWorkbook(Buffer.from(await file.arrayBuffer())); }
  catch { return bad("Could not read the workbook"); }

  const { store, user } = a;
  if (parsed.borrowers?.length) {
    store.borrowers = parsed.borrowers;
    store.portfolios = [...new Set(parsed.borrowers.map((b) => b.portfolio))];
    store.products = [...new Set(parsed.borrowers.map((b) => b.product))];
  }
  if (parsed.calls?.length) store.calls = parsed.calls;
  if (parsed.agents?.length) store.agents = parsed.agents;
  if (parsed.touches) store.touches = parsed.touches;
  if (parsed.followUps) store.followUps = parsed.followUps;
  const applied = !!(parsed.borrowers?.length || parsed.calls?.length || parsed.agents?.length || parsed.touches?.length || parsed.followUps?.length);
  if (applied) {
    store.source = "excel";
    store.demo.live = false;
    audit(store, user, "data_upload", file.name, parsed.report.map((r) => `${r.sheet}: ${r.imported}/${r.rows}`).join("; "));
    saveStore(store);
  }
  return NextResponse.json({ applied, report: parsed.report, source: store.source });
}
