import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { BLOCKS, CATEGORIES, TONES, blockById, simulateTest, toolsIn } from "@/lib/prompts";
import { audit, saveStore } from "@/lib/store";
import type { PromptDoc, PromptVersion, Tone } from "@/lib/types";

const TONE_KEYS = TONES.map((t) => t.key);
type BlockIn = { blockId: string; category: string; text: string };

function cleanBlocks(list: unknown): PromptVersion["blocks"] | string {
  if (!Array.isArray(list) || !list.length || list.length > 60) return "A prompt needs between 1 and 60 blocks";
  const out: PromptVersion["blocks"] = [];
  for (const raw of list as BlockIn[]) {
    const cat = CATEGORIES.find((c) => c.key === raw?.category);
    if (!cat || typeof raw.text !== "string" || typeof raw.blockId !== "string") return "Invalid block";
    out.push({ blockId: raw.blockId.slice(0, 20), category: cat.key, text: raw.text.slice(0, 6000) });
  }
  return out;
}

export async function GET() {
  const a = await requireUser("managePrompts");
  if ("res" in a) return a.res;
  return NextResponse.json({ prompts: a.store.prompts, blocks: BLOCKS });
}

// Create from the wizard: { client, product, tone, languages, ticket, dpd, blocks }
export async function POST(req: Request) {
  const a = await requireUser("managePrompts");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  const client = typeof body.client === "string" ? body.client.trim().slice(0, 60) : "";
  if (!client) return bad("Name the client");
  if (!TONE_KEYS.includes(body.tone)) return bad("Choose a tone");
  const blocks = cleanBlocks(body.blocks);
  if (typeof blocks === "string") return bad(blocks);
  const now = new Date().toISOString();
  const doc: PromptDoc = {
    id: `P${store.prompts.length + 1}_${Date.now().toString(36)}`, client, product: String(body.product ?? "").slice(0, 40), tone: body.tone as Tone,
    languages: Array.isArray(body.languages) ? body.languages.slice(0, 10).map(String) : [], ticket: Number(body.ticket) || 0, dpd: String(body.dpd ?? "").slice(0, 20),
    status: "Draft", current: 1, versions: [{ v: 1, blocks, note: "Assembled by the new-client wizard", by: user.username, at: now }], tools: toolsIn(blocks.map((b) => b.text)), updatedAt: now,
  };
  store.prompts.push(doc);
  audit(store, user, "prompt_create", client, `${doc.product} · ${doc.tone} · ${blocks.length} blocks`);
  saveStore(store);
  return NextResponse.json({ prompt: doc });
}

// { id, action: "save", blocks, note } | { id, action: "rollback", v } | { id, action: "test" } | { id, action: "publish" }
export async function PATCH(req: Request) {
  const a = await requireUser("managePrompts");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  const p = store.prompts.find((x) => x.id === body.id);
  if (!p) return bad("Prompt not found", 404);
  const now = new Date().toISOString();
  const cur = p.versions.find((v) => v.v === p.current)!;
  const next = Math.max(...p.versions.map((v) => v.v)) + 1;

  if (body.action === "save") {
    const blocks = cleanBlocks(body.blocks);
    if (typeof blocks === "string") return bad(blocks);
    p.versions.push({ v: next, blocks, note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 140) : "Edited", by: user.username, at: now });
    p.current = next; p.status = "Draft"; p.tools = toolsIn(blocks.map((b) => b.text));
    audit(store, user, "prompt_version", p.client, `v${next}: ${p.versions.at(-1)!.note}`);
  } else if (body.action === "rollback") {
    const from = p.versions.find((v) => v.v === body.v);
    if (!from) return bad("Version not found");
    p.versions.push({ v: next, blocks: structuredClone(from.blocks), note: `Rolled back to v${from.v}`, by: user.username, at: now });
    p.current = next; p.status = "Draft";
    audit(store, user, "prompt_rollback", p.client, `v${from.v} → v${next}`);
  } else if (body.action === "test") {
    cur.test = { ...simulateTest(cur.blocks, p.tone), at: now };
    if (cur.test.passed) p.status = "Tested";
    audit(store, user, "prompt_test", p.client, `v${cur.v}: ${cur.test.passed ? "passed" : `failed (${cur.test.failedBlocks.map((id) => blockById(id)?.category ?? id).join(", ")})`}`);
  } else if (body.action === "publish") {
    if (!cur.test?.passed) return bad("Run a passing test call on this version before publishing");
    p.status = "Published";
    audit(store, user, "prompt_publish", p.client, `v${cur.v}`);
  } else return bad("Unknown action");
  p.updatedAt = now;
  saveStore(store);
  return NextResponse.json({ prompt: p });
}
