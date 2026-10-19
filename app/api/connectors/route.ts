import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { connectorDef, maskConnector } from "@/lib/campaigns";
import { audit, saveStore } from "@/lib/store";
import { fetchHealth, syncWaConnector, waConfig, waState } from "@/lib/whatsapp";
import type { ConnectorKind } from "@/lib/types";

export async function GET() {
  const a = await requireUser(undefined, "campaigns");
  if ("res" in a) return a.res;
  return NextResponse.json({ connectors: a.store.connectors.map(maskConnector) });
}

// Save settings: { kind, provider?, config? }   Disconnect: { kind, disconnect: true }   Test: { kind, test: true }
export async function PATCH(req: Request) {
  const a = await requireUser("manageConnectors");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  const c = store.connectors.find((x) => x.kind === body.kind as ConnectorKind);
  if (!c) return bad("Unknown integration", 404);
  const def = connectorDef(c.kind);

  // WhatsApp runs on Meta's Cloud API with keys in env vars, so "test" is a real check and the keys can't be edited here.
  if (c.kind === "whatsapp" && !waConfig().missing.length) {
    if (!body.test) return bad("WhatsApp keys are set in the server's environment variables. Use the WhatsApp tab to check the connection.", 409);
    const h = await fetchHealth();
    waState(store).health = { checkedAt: new Date().toISOString(), ok: h.ok, ...(h.ok ? { number: h.number } : { error: h.error }) };
    syncWaConnector(store);
    audit(store, user, "connector_test", def.title, c.lastResult ?? "");
    saveStore(store);
    return NextResponse.json({ connector: maskConnector(c) });
  }

  if (body.disconnect) {
    c.status = "Not connected"; c.config = {}; c.lastResult = "Disconnected";
    audit(store, user, "connector_disconnect", def.title, c.provider);
  } else if (body.test) {
    const missing = def.fields.filter((f) => !c.config[f.key]).map((f) => f.label);
    c.lastTest = new Date().toISOString();
    if (missing.length) { c.status = "Error"; c.lastResult = `Missing: ${missing.join(", ")}`; }
    else { c.status = "Connected"; c.lastResult = `Reached ${c.provider} (demo check)`; }
    audit(store, user, "connector_test", def.title, c.lastResult);
  } else {
    if (typeof body.provider === "string" && def.providers.includes(body.provider)) c.provider = body.provider;
    if (body.config && typeof body.config === "object") {
      for (const f of def.fields) {
        const v = body.config[f.key];
        if (typeof v !== "string") continue;
        if (f.secret && v.startsWith("••••")) continue; // masked value sent back unchanged
        c.config[f.key] = v.trim().slice(0, 300);
      }
    }
    c.status = "Not connected"; c.lastResult = "Saved. Run a test to connect.";
    audit(store, user, "connector_save", def.title, c.provider);
  }
  saveStore(store);
  return NextResponse.json({ connector: maskConnector(c) });
}
