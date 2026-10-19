import type { BlockCategory, PromptBlock, PromptDoc, PromptVersion, Tone } from "./types";

// Placeholder wording modelled on three production collection prompts, anonymised under invented lender names.
// Replace the text with the real anonymised prompts; the structure, tags and metrics stay the same.

export const CATEGORIES: { key: BlockCategory; label: string; hint: string }[] = [
  { key: "identity", label: "Identity & disclosure", hint: "Who is calling, on whose behalf, AI and recording notice" },
  { key: "opening", label: "Opening", hint: "First turn and permission to continue" },
  { key: "verification", label: "Verification", hint: "Confirm it is the borrower before discussing the debt" },
  { key: "reason", label: "Reason for call", hint: "Amount, due date and days overdue" },
  { key: "negotiation", label: "Negotiation / PTP", hint: "Ask for payment, settle on a promise to pay" },
  { key: "objection", label: "Objection handling", hint: "No money, will pay later, wrong amount" },
  { key: "complaint", label: "Complaint handling", hint: "Log it, give the grievance route, stop selling" },
  { key: "escalation", label: "Escalation / handoff", hint: "When and how to hand to a human" },
  { key: "payment", label: "Payment link", hint: "Send the link and walk through paying" },
  { key: "callback", label: "Callback", hint: "Book a time the borrower chooses, inside calling hours" },
  { key: "closing", label: "Closing", hint: "Recap the promise and end politely" },
  { key: "guardrails", label: "Compliance guardrails", hint: "Hard rules the agent can never break" },
];
export const catLabel = (k: BlockCategory) => CATEGORIES.find((c) => c.key === k)!.label;

/** Blocks the tone rewrite never touches: disclosure, complaints and the hard rules stay word for word. */
export const LOCKED: BlockCategory[] = ["identity", "complaint", "guardrails"];

export const TONES: { key: Tone; label: string; hint: string }[] = [
  { key: "aggressive", label: "Aggressive", hint: "Direct and firm, states consequences plainly, within the law" },
  { key: "pushy", label: "Pushy", hint: "Persistent, asks for commitment repeatedly, link early" },
  { key: "silent", label: "Silent", hint: "Listen-first, short turns, lets the borrower talk" },
  { key: "supportive", label: "Supportive", hint: "Empathetic, offers part-payment and new dates" },
  { key: "compliant", label: "Highly compliant", hint: "Verbatim disclosures, consent first, no pressure language" },
];

export const SOURCES = [
  { name: "Northwind Finserv", kind: "NBFC · personal loans", product: "Personal Loan", tone: "compliant" as Tone, note: "Lean SMFG-style structure, about 13 pages" },
  { name: "Cartwheel Pay", kind: "BNPL · pay later", product: "BNPL", tone: "supportive" as Tone, note: "Short turns, link-first, young salaried borrowers" },
  { name: "Lumen Credit", kind: "Digital lender · small tickets", product: "Credit Card", tone: "pushy" as Tone, note: "High volume, persistent PTP asks" },
];

export const TOOLS = [
  { key: "send_payment_link", label: "Send payment link" },
  { key: "schedule_callback", label: "Schedule callback" },
  { key: "escalate", label: "Escalate" },
  { key: "transfer_to_human", label: "Transfer to telecaller" },
  { key: "send_whatsapp_summary", label: "WhatsApp summary" },
];

type Seed = Record<BlockCategory, [string, number, number]>; // text, test calls, pass rate
const NORTHWIND: Seed = {
  identity: ["Hello, this is {agent_name}, an AI assistant calling on behalf of {lender}. This call is recorded for quality and compliance. I'm calling about your loan account.", 1840, 98],
  opening: ["Am I speaking with {name}? I'd like two minutes of your time about your {lender} loan. Is now a good time?", 1840, 94],
  verification: ["Before I share account details, could you confirm the last four digits of your loan number or your date of birth? If you are not {name}, I'll end the call and won't share anything.", 1620, 96],
  reason: ["Your EMI of {emi} was due on {due_date} and is now {dpd} days overdue. The total outstanding is {outstanding}.", 1610, 93],
  negotiation: ["Can you clear the {emi} today? If not today, what date in the next three days works? I'll note it as your promise to pay. [tool: schedule_callback if they need time to arrange funds]", 1580, 88],
  objection: ["I understand money is tight. Could you pay part of it now, even half, and the rest by {callback_time}? If the amount looks wrong, I'll raise it for review before asking for payment.", 1210, 84],
  complaint: ["I'm sorry about that. I've logged your complaint. You can also reach our Grievance Redressal Officer, {gro_name}, on {gro_phone}. I won't discuss payment further on this call unless you want to. [tool: escalate]", 640, 97],
  escalation: ["If the borrower asks for a person, mentions hardship, illness or a dispute, or is distressed: say you're connecting them to a colleague and hand over. [tool: transfer_to_human]", 720, 95],
  payment: ["I'm sending a secure payment link to your registered number now. It shows {emi} for loan {loan_id}. [tool: send_payment_link] Let me know once it arrives and I'll stay on while you pay.", 1490, 91],
  callback: ["What time suits you for a call back? I can call between 8 am and 7 pm. [tool: schedule_callback]", 980, 92],
  closing: ["Thank you, {name}. To confirm: {emi} by {callback_time}. You'll get a WhatsApp reminder. Have a good day.", 1550, 95],
  guardrails: ["Never threaten, shame or use abusive language. Never contact family, friends or employers about the debt. Only call between 8 am and 7 pm. Stop if the borrower asks you to. Don't promise waivers you can't give.", 1840, 99],
};
const CARTWHEEL: Seed = {
  identity: ["Hi, I'm {agent_name}, a virtual assistant from {lender}. This call is recorded.", 2210, 97],
  opening: ["Hi {name}! Quick one about your {lender} pay-later bill. Got a minute?", 2210, 95],
  verification: ["Just to be sure I've got the right person, can you confirm your registered email or the last 4 digits of your phone?", 2050, 93],
  reason: ["Your bill of {emi} was due on {due_date}. It's {dpd} days late now, so a late fee may apply.", 2040, 92],
  negotiation: ["Can you pay {emi} now from the link? It takes under a minute. If not now, would today evening or tomorrow work better?", 1990, 90],
  objection: ["Totally get it. If the full amount is hard, you can split it: pay part now and the rest on your next salary date.", 1670, 87],
  complaint: ["Sorry about that. I've logged it, and someone from our team will contact you within 48 hours. You can also write to {gro_email}. [tool: escalate]", 520, 95],
  escalation: ["Hand over if they're upset, mention a dispute, or ask for a human. Send a WhatsApp summary to the agent first. [tool: send_whatsapp_summary] [tool: transfer_to_human]", 610, 93],
  payment: ["Sending the link on WhatsApp right now. [tool: send_payment_link] Tap it, choose UPI and you're done.", 2120, 94],
  callback: ["No worries, when should I ping you back? Anytime 8 am to 7 pm. [tool: schedule_callback]", 1380, 91],
  closing: ["Great, so {emi} by {callback_time}. Thanks {name}, have a good one!", 2010, 96],
  guardrails: ["Be polite and short. No threats, no contacting anyone but the borrower, only 8 am–7 pm, stop on request.", 2210, 98],
};
const LUMEN: Seed = {
  identity: ["This is {agent_name}, an automated assistant for {lender}. This call is recorded and may be monitored.", 3120, 96],
  opening: ["{name}, I'm calling about your overdue {lender} account. This will take two minutes.", 3120, 89],
  verification: ["Please confirm your date of birth so I can continue.", 2890, 90],
  reason: ["Your payment of {emi} is {dpd} days overdue. Outstanding is {outstanding}. Late fees are adding to this every month and it is reported to the credit bureaus.", 2870, 86],
  negotiation: ["I need a commitment today. Can you pay {emi} now? If not the full amount, how much can you pay right now? Let's fix the date: today or tomorrow?", 2810, 82],
  objection: ["I hear you, but delaying makes it more expensive. Even a part-payment today stops it getting worse. What amount can you do now?", 2400, 79],
  complaint: ["I've recorded your complaint and it will be reviewed. Our grievance officer is {gro_name}, {gro_phone}. [tool: escalate]", 480, 94],
  escalation: ["Transfer to a human if the borrower disputes the debt, mentions hardship, or asks twice for a person. [tool: transfer_to_human]", 700, 90],
  payment: ["I'm sending the payment link now. [tool: send_payment_link] Please complete it while we're on the call.", 2760, 88],
  callback: ["When exactly will you have the funds? I'll call you then. [tool: schedule_callback]", 1900, 85],
  closing: ["Noted: {emi} by {callback_time}. Missing this date will add charges. Thank you.", 2650, 90],
  guardrails: ["No threats, abuse or harassment. Don't contact third parties. 8 am–7 pm only. Stop if asked. State only consequences that are in the loan agreement.", 3120, 97],
};

function blocksFrom(seed: Seed, source: string, product: string, tone: Tone, prefix: string): PromptBlock[] {
  return CATEGORIES.map((c, i) => {
    const [text, testCalls, passRate] = seed[c.key];
    return { id: `${prefix}-${String(i + 1).padStart(2, "0")}`, category: c.key, source, product, tone, text, testCalls, passRate, locked: LOCKED.includes(c.key) };
  });
}

export const BLOCKS: PromptBlock[] = [
  ...blocksFrom(NORTHWIND, "Northwind Finserv", "Personal Loan", "compliant", "NW"),
  ...blocksFrom(CARTWHEEL, "Cartwheel Pay", "BNPL", "supportive", "CW"),
  ...blocksFrom(LUMEN, "Lumen Credit", "Credit Card", "pushy", "LM"),
];
export const blockById = (id: string) => BLOCKS.find((b) => b.id === id);

const STYLE: Record<Tone, string> = {
  aggressive: "Style: direct and firm. State the overdue amount and the contractual consequences (late fees, bureau reporting) plainly. Never threaten, abuse or mislead.",
  pushy: "Style: persistent. Ask for a payment commitment at least twice before accepting a later date, and offer the link early.",
  silent: "Style: listen-first. Keep each turn under two sentences, pause for the borrower and don't repeat the amount more than once.",
  supportive: "Style: empathetic. Acknowledge their situation and offer a part-payment or new date before asking for the full amount.",
  compliant: "Style: highly compliant. Read disclosures word for word, confirm consent before discussing the debt and avoid pressure language.",
};
const SWAPS: Record<Tone, [RegExp, string][]> = {
  aggressive: [[/Can you clear/g, "You need to clear"], [/Could you pay/g, "You should pay"], [/what date in the next three days works\?/g, "you must commit to a date within 48 hours."], [/I understand money is tight\./g, "I understand, but this is overdue."], [/Have a good day\./g, "Please make sure this is paid on time."]],
  pushy: [[/If not today, what date/g, "Can we do it today? If not, what date"], [/What time suits you for a call back\?/g, "Can we settle it now instead? If not, what time today suits you?"], [/Totally get it\./g, "I get it, but let's sort it now."]],
  silent: [[/ I'll stay on while you pay\./g, ""], [/ It takes under a minute\./g, ""]],
  supportive: [[/I need a commitment today\./g, "I'd like to help you find a date that works."], [/Late fees are adding to this every month and it is reported to the credit bureaus\./g, "Paying soon keeps your record clean."], [/Missing this date will add charges\./g, "We're here if anything changes."]],
  compliant: [[/ Late fees are adding to this every month and it is reported to the credit bureaus\./g, ""], [/I need a commitment today\./g, "May I ask when you'll be able to pay?"]],
};

/** Simulated LLM rewrite. Locked blocks are returned unchanged. */
export function rewrite(text: string, category: BlockCategory, tone: Tone) {
  if (LOCKED.includes(category)) return text;
  let out = text;
  for (const [re, rep] of SWAPS[tone]) out = out.replace(re, rep);
  return `${out}\n${STYLE[tone]}`;
}

/** Picks the best block per category for the client: pass rate first, then product and tone match, then how proven it is. */
export function pickBlocks(product: string, tone: Tone) {
  return CATEGORIES.map((c) => {
    const options = BLOCKS.filter((b) => b.category === c.key);
    const score = (b: PromptBlock) => b.passRate * 0.6 + (b.product === product ? 20 : 0) + (b.tone === tone ? 8 : 0) + Math.log10(b.testCalls) * 3;
    const best = [...options].sort((a, b) => score(b) - score(a))[0];
    return { category: c.key, block: best, options: options.sort((a, b) => score(b) - score(a)), reason: `${best.passRate}% pass over ${best.testCalls.toLocaleString("en-IN")} test calls${best.product === product ? `, same product (${product})` : ""}` };
  });
}

export const variablesIn = (texts: string[]) => [...new Set(texts.flatMap((t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => `{${m[1]}}`)))];
export const toolsIn = (texts: string[]) => TOOLS.filter((t) => texts.some((x) => x.includes(`tool: ${t.key}`))).map((t) => t.key);
export const WORDS_PER_PAGE = 450;
export const TARGET_PAGES = 13;
export const pagesOf = (texts: string[]) => texts.join(" ").split(/\s+/).filter(Boolean).length / WORDS_PER_PAGE;

/** Simulated test call: each block "passes" if its pass rate clears a bar that rises with stricter tones. */
export function simulateTest(blocks: { blockId: string; category: BlockCategory; text: string }[], tone: Tone) {
  const bar = tone === "aggressive" || tone === "pushy" ? 85 : 80;
  const failed = blocks.filter((b) => (blockById(b.blockId)?.passRate ?? 90) < bar && !LOCKED.includes(b.category)).map((b) => b.blockId);
  const score = Math.round(blocks.reduce((n, b) => n + (blockById(b.blockId)?.passRate ?? 90), 0) / Math.max(1, blocks.length));
  return { passed: failed.length === 0, score, failedBlocks: failed };
}

const BORROWER: Partial<Record<BlockCategory, string>> = {
  opening: "Haan, bolo. Who is this?", verification: "Last four digits are 4821.", reason: "I know, salary got delayed this month.",
  negotiation: "I can't pay all of it today.", objection: "Maybe half by Friday?", payment: "Okay, got the link.", callback: "Call me after 6.", closing: "Okay, thanks.",
};
export function transcript(blocks: { blockId: string; category: BlockCategory; text: string }[], failed: string[]) {
  return blocks.flatMap((b) => {
    const agent = b.text.split("\n")[0].replace(/\[tool: (\w+)[^\]]*\]/g, "→ $1").replace(/\{(\w+)\}/g, (_, v) => SAMPLE[v] ?? v);
    const lines = [{ who: "Agent", text: agent, blockId: b.blockId, failed: failed.includes(b.blockId) }];
    if (BORROWER[b.category]) lines.push({ who: "Borrower", text: BORROWER[b.category]!, blockId: b.blockId, failed: false });
    return lines;
  });
}
const SAMPLE: Record<string, string> = {
  agent_name: "Aarohi", lender: "Brisk Pay", name: "Rohan", emi: "₹4,200", due_date: "5 Oct", dpd: "14", outstanding: "₹18,600",
  loan_id: "LN2024004821", callback_time: "Friday", gro_name: "the Grievance Officer", gro_phone: "1800 000 0000", gro_email: "grievance@lender.example",
};

export function seedPrompts(now: number): PromptDoc[] {
  const iso = (d: number) => new Date(now - d * 86_400_000).toISOString();
  const fromSource = (src: (typeof SOURCES)[number], prefix: string, id: string): PromptDoc => {
    const blocks = BLOCKS.filter((b) => b.id.startsWith(prefix)).map((b) => ({ blockId: b.id, category: b.category, text: b.text }));
    const v1: PromptVersion = { v: 1, blocks: blocks.map((b) => ({ ...b, text: b.text.replace(/\[tool: \w+[^\]]*\]/g, "").trim() })), note: "Imported from production", by: "superadmin", at: iso(120), test: { passed: true, score: 88, at: iso(119), failedBlocks: [] } };
    const v2: PromptVersion = { v: 2, blocks, note: "Added tool calls and lean structure", by: "superadmin", at: iso(40), test: { ...simulateTest(blocks, src.tone), at: iso(39) } };
    return { id, client: src.name, product: src.product, tone: src.tone, languages: ["Hindi", "English"], ticket: 0, dpd: "All", status: "Published", current: 2, versions: [v1, v2], tools: toolsIn(blocks.map((b) => b.text)), source: true, updatedAt: iso(40) };
  };
  const draftPicks = pickBlocks("BNPL", "aggressive");
  // The draft starts with Lumen's weaker objection block so its first test call fails and shows the swap-and-retest loop.
  const draftBlocks = draftPicks.map((p) => {
    const b = p.category === "objection" ? blockById("LM-06")! : p.block;
    return { blockId: b.id, category: p.category, text: rewrite(b.text, p.category, "aggressive") };
  });
  return [
    fromSource(SOURCES[0], "NW", "P1"), fromSource(SOURCES[1], "CW", "P2"), fromSource(SOURCES[2], "LM", "P3"),
    { id: "P4", client: "Brisk Pay", product: "BNPL", tone: "aggressive", languages: ["Hindi", "English", "Marathi"], ticket: 4200, dpd: "1–30", status: "Draft", current: 1,
      versions: [{ v: 1, blocks: draftBlocks, note: "Assembled by the new-client wizard", by: "superadmin", at: iso(1) }], tools: toolsIn(draftBlocks.map((b) => b.text)), updatedAt: iso(1) },
  ];
}

/** Which prompt and block a QC failure on a call points to, for the Conversations page. */
export function qcFor(product: string, issue: "disclosure" | "dispute" | "unanswered-objection"): { promptId: string; blockId: string; label: string } {
  const promptId = product === "BNPL" ? "P2" : product === "Credit Card" ? "P3" : "P1";
  const prefix = promptId === "P2" ? "CW" : promptId === "P3" ? "LM" : "NW";
  const cat: BlockCategory = issue === "disclosure" ? "identity" : issue === "dispute" ? "objection" : "negotiation";
  const idx = CATEGORIES.findIndex((c) => c.key === cat) + 1;
  return { promptId, blockId: `${prefix}-${String(idx).padStart(2, "0")}`, label: catLabel(cat) };
}
