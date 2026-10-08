import { bad, requireUser } from "@/lib/api";
import { buildEscalationFile } from "@/lib/excel";
import { audit, saveStore } from "@/lib/store";

// GET ?ids=B1001,B1002 -> .xlsx escalation pack for the human desk.
export async function GET(req: Request) {
  const a = await requireUser("escalate");
  if ("res" in a) return a.res;
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 50);
  const borrowers = a.store.borrowers.filter((b) => ids.includes(b.id) && (!a.scope.portfolio || b.portfolio === a.scope.portfolio));
  if (!borrowers.length) return bad("No matching escalations", 404);
  audit(a.store, a.user, "escalation_file", borrowers.map((b) => b.loanId).join(", "), `${borrowers.length} borrower(s)`);
  saveStore(a.store, { throttle: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(new Uint8Array(buildEscalationFile(a.store, borrowers)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="escalation-${borrowers.length === 1 ? borrowers[0].loanId : `${borrowers.length}-borrowers`}-${stamp}.xlsx"`,
    },
  });
}
