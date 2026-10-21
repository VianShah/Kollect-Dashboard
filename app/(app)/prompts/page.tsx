"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, GripVertical, History, Lock, PhoneCall, Plus, Rocket, Save, Sparkles, Wand2 } from "lucide-react";
import { post, useApi } from "@/components/useApi";
import { Badge, Card, Empty, ErrorNote, Kpi, Loading, Tabs } from "@/components/ui";
import {
  CATEGORIES, LOCKED, SOURCES, TARGET_PAGES, TONES, TOOLS, blockById, catLabel, pagesOf, pickBlocks, rewrite, toolsIn, transcript, variablesIn,
} from "@/lib/prompts";
import { d, num } from "@/lib/format";
import type { Agent, BlockCategory, PromptBlock, PromptDoc, PromptVersion, Tone } from "@/lib/types";

type VBlock = PromptVersion["blocks"][number];
interface Data { prompts: PromptDoc[]; blocks: PromptBlock[]; agents: Agent[] }
const PRODUCTS = ["BNPL", "Personal Loan", "Credit Card", "Two-Wheeler Loan"];
/** How a prompt is named in the catalog: product, DPD bucket and the persona its tone gives the agent. */
const PERSONA: Record<Tone, string> = { aggressive: "Aggressive", pushy: "Pushy & persistent", silent: "Silent listener", supportive: "Supportive & engaging", compliant: "Strictly compliant" };
const catalogName = (p: Pick<PromptDoc, "product" | "dpd" | "tone">) => `${p.product} · ${!p.dpd || p.dpd === "All" ? "All DPD" : /^\d/.test(p.dpd) ? `${p.dpd} DPD` : p.dpd} · ${PERSONA[p.tone]}`;
type StudioTab = "Agent library" | "Prompt catalog" | "Block library" | "New client";
const STATUS_BADGE: Record<PromptDoc["status"], string> = { Draft: "Draft", Tested: "Scheduled", Published: "Running" };
const toneLabel = (t: Tone) => TONES.find((x) => x.key === t)!.label;

export default function PromptsPage() {
  return <Suspense fallback={<Loading rows={1} />}><Prompts /></Suspense>;
}

function Prompts() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, error, setData } = useApi<Data>("/api/prompts", () => ({ prompts: [], blocks: [], agents: [] }));
  const [tab, setTab] = useState<StudioTab>("Prompt catalog");
  const [reference, setReference] = useState<string | null>(null);
  const openId = params.get("prompt");
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const open = data.prompts.find((p) => p.id === openId);
  const go = (id: string | null) => router.replace(id ? `/prompts?prompt=${id}` : "/prompts", { scroll: false });
  const upsert = (p: PromptDoc) => setData({ ...data, prompts: data.prompts.some((x) => x.id === p.id) ? data.prompts.map((x) => (x.id === p.id ? p : x)) : [...data.prompts, p] });

  if (open) return <Editor key={open.id} doc={open} focusBlock={params.get("block")} onBack={() => go(null)} onSaved={upsert} />;
  return (
    <>
      <p className="text-[13px] text-muted">Predixion only. The agents that call borrowers, the prompts they speak from, catalogued by product and persona, and a wizard that starts a new client from a proven prompt. Lender names are anonymised.</p>
      <Tabs tabs={["Agent library", "Prompt catalog", "Block library", "New client"] as const} value={tab} onChange={setTab} />
      {tab === "Agent library" && <AgentLibrary agents={data.agents} prompts={data.prompts} />}
      {tab === "Prompt catalog" && <><Catalog prompts={data.prompts} onOpen={go} onStartFrom={(id) => { setReference(id); setTab("New client"); }} /><PromptList prompts={data.prompts} onOpen={go} /></>}
      {tab === "Block library" && <BlockLibrary blocks={data.blocks} />}
      {tab === "New client" && <Wizard prompts={data.prompts} reference={reference} onCreated={(p) => { upsert(p); go(p.id); }} />}
    </>
  );
}

/** Voice and IVR agents: what each one handles, in which language and voice, and how it's doing. */
function AgentLibrary({ agents, prompts }: { agents: Agent[]; prompts: PromptDoc[] }) {
  const [product, setProduct] = useState("all");
  const [channel, setChannel] = useState("all");
  const [lang, setLang] = useState("all");
  const languages = [...new Set(agents.map((a) => a.language))].sort();
  const list = agents.filter((a) => (product === "all" || a.product === product) && (channel === "all" || a.channel === channel) && (lang === "all" || a.language === lang));
  const promptFor = (a: Agent) => prompts.find((p) => p.status === "Published" && p.product === a.product);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Agents" value={num(agents.length)} sub={`${agents.filter((a) => a.channel === "AI Voice").length} AI voice · ${agents.filter((a) => a.channel === "IVR").length} IVR`} />
        <Kpi label="Languages" value={num(languages.length)} sub={languages.slice(0, 4).join(", ")} />
        <Kpi label="Live now" value={num(agents.reduce((n, a) => n + a.live, 0))} sub={`of ${num(agents.reduce((n, a) => n + a.max, 0))} at once`} />
        <Kpi label="Resolved" value={num(agents.reduce((n, a) => n + a.resolved, 0))} tone="good" sub={`${num(agents.reduce((n, a) => n + a.open, 0))} still open`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Product"><button aria-pressed={product === "all"} onClick={() => setProduct("all")}>All products</button>{PRODUCTS.map((p) => <button key={p} aria-pressed={product === p} onClick={() => setProduct(p)}>{p}</button>)}</div>
        <select className="input" aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="all">All channels</option>{[...new Set(agents.map((a) => a.channel))].map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input" aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}><option value="all">All languages</option>{languages.map((l) => <option key={l}>{l}</option>)}</select>
        <a className="ml-auto text-[12.5px] text-brand hover:underline" href="https://kollect-statemachine.onrender.com/" target="_blank" rel="noopener noreferrer">Open the State Machine →</a>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((a) => {
          const p = promptFor(a);
          const rate = a.resolved + a.open ? Math.round((a.resolved / (a.resolved + a.open)) * 100) : 0;
          return (
            <section key={a.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sunk"><Bot size={17} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{a.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-muted">{a.code}</div>
                </div>
                <span className="shrink-0 rounded bg-sunk px-1.5 py-0.5 text-[11px] text-ink-2">{a.channel}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[12.5px]">
                <dt className="text-muted">Product</dt><dd className="text-right">{a.product === "All" ? "All products" : a.product}</dd>
                <dt className="text-muted">Language · voice</dt><dd className="text-right">{a.language} · {a.voice}</dd>
                <dt className="text-muted">Calls at once</dt><dd className="text-right num">{a.live} / {a.max}</dd>
                <dt className="text-muted">Resolved</dt><dd className="text-right num">{num(a.resolved)} <span className="text-muted">({rate}%)</span></dd>
                <dt className="text-muted">Speaks from</dt><dd className="truncate text-right">{p ? `${p.client} v${p.current}` : "—"}</dd>
              </dl>
            </section>
          );
        })}
      </div>
      {!list.length && <Card><Empty title="No agents match">Clear a filter.</Empty></Card>}
    </>
  );
}

/** The prompt catalog: every product, the personas built for it, and the gaps still to build. */
function Catalog({ prompts, onOpen, onStartFrom }: { prompts: PromptDoc[]; onOpen: (id: string) => void; onStartFrom: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {PRODUCTS.map((product) => {
        const mine = prompts.filter((p) => p.product === product);
        const missing = (["supportive", "aggressive"] as Tone[]).filter((t) => !mine.some((p) => p.tone === t));
        return (
          <Card key={product} title={product} sub={`${mine.length} prompt${mine.length === 1 ? "" : "s"} · ${mine.filter((p) => p.status === "Published").length} published`}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {mine.map((p) => {
                const v = p.versions.find((x) => x.v === p.current);
                return (
                  <article key={p.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <button className="text-left text-[13.5px] font-semibold hover:text-brand hover:underline" onClick={() => onOpen(p.id)}>{catalogName(p)}</button>
                      <Badge>{STATUS_BADGE[p.status]}</Badge>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{p.client}{p.source ? " · production source" : ""} · v{p.current} · {p.languages.join(", ") || "—"}</div>
                    <div className="mt-2 flex flex-wrap gap-x-3 text-[12px]">
                      <span>Last test: {v?.test ? <b className={v.test.passed ? "text-good" : "text-bad"}>{v.test.score}%</b> : <span className="text-muted">not run</span>}</span>
                      {p.ticket > 0 && <span className="text-muted">Avg ticket ₹{num(p.ticket)}</span>}
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <button className="btn min-h-8 px-2 text-[12px]" onClick={() => onOpen(p.id)}>Open</button>
                      <button className="btn min-h-8 px-2 text-[12px]" onClick={() => onStartFrom(p.id)}><Wand2 size={12} aria-hidden="true" />New client from this</button>
                    </div>
                  </article>
                );
              })}
              {missing.map((t) => (
                <article key={t} className="flex flex-col justify-between rounded-lg border border-dashed border-line-strong p-3">
                  <div><div className="text-[13.5px] font-semibold text-muted">{product} · {PERSONA[t]}</div><div className="text-[12px] text-muted">Not built yet</div></div>
                  {(mine[0] ?? prompts.find((x) => x.status === "Published")) && <button className="btn mt-2 min-h-8 self-start px-2 text-[12px]" onClick={() => onStartFrom((mine[0] ?? prompts.find((x) => x.status === "Published"))!.id)}><Plus size={12} aria-hidden="true" />Build it</button>}
                </article>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function PromptList({ prompts, onOpen }: { prompts: PromptDoc[]; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Prompts" value={num(prompts.length)} sub={`${prompts.filter((p) => p.source).length} production sources`} />
        <Kpi label="Published" value={num(prompts.filter((p) => p.status === "Published").length)} tone="good" sub="Live on agents" />
        <Kpi label="Drafts" value={num(prompts.filter((p) => p.status !== "Published").length)} sub="Being built or tested" />
        <Kpi label="Reusable blocks" value={num(CATEGORIES.length * SOURCES.length)} sub={`${CATEGORIES.length} types from ${SOURCES.length} lenders`} />
      </div>
      <Card pad={false} title="Prompts" sub="Production sources and client prompts built from them">
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Client</th><th>Product</th><th>Tone</th><th>Status</th><th className="text-right">Version</th><th className="text-right">Last test</th><th className="text-right">Length</th><th>Updated</th></tr></thead>
            <tbody>
              {prompts.map((p) => {
                const cur = p.versions.find((v) => v.v === p.current)!;
                const pages = pagesOf(cur.blocks.map((b) => b.text));
                return (
                  <tr key={p.id} className="cursor-pointer hover:bg-sunk/40" onClick={() => onOpen(p.id)}>
                    <td><span className="font-medium">{p.client}</span>{p.source && <span className="ml-2 rounded bg-sunk px-1.5 py-0.5 text-[11px] text-muted">Production source</span>}</td>
                    <td>{p.product}</td><td>{toneLabel(p.tone)}</td>
                    <td><Badge>{STATUS_BADGE[p.status]}</Badge> <span className="text-[12px] text-muted">{p.status}</span></td>
                    <td className="text-right num">v{p.current} of {p.versions.length}</td>
                    <td className="text-right num">{cur.test ? `${cur.test.score}% ${cur.test.passed ? "pass" : "fail"}` : "—"}</td>
                    <td className="text-right num">{pages.toFixed(1)} pages</td>
                    <td className="num">{d(p.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function BlockLibrary({ blocks }: { blocks: PromptBlock[] }) {
  const [cat, setCat] = useState<BlockCategory | "all">("all");
  const [src, setSrc] = useState("all");
  const rows = blocks.filter((b) => (cat === "all" || b.category === cat) && (src === "all" || b.source === src));
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Block type" className="input" value={cat} onChange={(e) => setCat(e.target.value as BlockCategory | "all")}>
          <option value="all">All block types</option>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select aria-label="Source" className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="all">All sources</option>{SOURCES.map((s) => <option key={s.name}>{s.name}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {SOURCES.filter((s) => src === "all" || s.name === src).map((s) => (
          <div key={s.name} className="card p-3 text-[12.5px]"><div className="font-semibold">{s.name}</div><div className="text-muted">{s.kind} · {toneLabel(s.tone)}</div><div className="mt-1 text-muted">{s.note}</div></div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((b) => (
          <section key={b.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-mono text-muted">{b.id}</span>
              <span className="font-semibold">{catLabel(b.category)}</span>
              {b.locked && <span className="inline-flex items-center gap-1 rounded bg-sunk px-1.5 py-0.5 text-muted"><Lock size={11} aria-hidden="true" />Locked</span>}
              <span className="ml-auto text-muted">{b.source} · {b.product} · {toneLabel(b.tone)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{b.text}</p>
            <div className="mt-3 flex gap-4 text-[12px] text-muted">
              <span><span className="font-medium text-ink num">{num(b.testCalls)}</span> test calls</span>
              <span><span className={`font-medium num ${b.passRate >= 90 ? "text-good" : b.passRate < 85 ? "text-bad" : "text-ink"}`}>{b.passRate}%</span> pass rate</span>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function Wizard({ prompts, reference, onCreated }: { prompts: PromptDoc[]; reference: string | null; onCreated: (p: PromptDoc) => void }) {
  const proven = prompts.filter((p) => p.status === "Published" || p.source);
  const [refId, setRefId] = useState(reference ?? proven[0]?.id ?? "");
  const ref = prompts.find((p) => p.id === refId);
  const [form, setForm] = useState({ client: "Brisk Pay", product: ref?.product ?? "BNPL", ticket: String(ref?.ticket ?? 4200), dpd: ref?.dpd || "1–30", languages: ref?.languages.length ? ref.languages : ["Hindi", "English"], tone: (ref?.tone ?? "aggressive") as Tone, guardrails: "", opening: "" });
  useEffect(() => { if (ref) setForm((f) => ({ ...f, product: ref.product, ticket: String(ref.ticket || f.ticket), dpd: ref.dpd || f.dpd, languages: ref.languages.length ? ref.languages : f.languages })); }, [refId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [phase, setPhase] = useState<"form" | "thinking" | "result">("form");
  const [msg, setMsg] = useState("");
  const picks = useMemo(() => pickBlocks(form.product, form.tone), [form.product, form.tone]);
  // With a reference, its own blocks are the starting point; without one, the best-proven block for each part of the call.
  const refBlocks = ref?.versions.find((v) => v.v === ref.current)?.blocks;
  const base: VBlock[] = refBlocks ?? picks.map((p) => ({ blockId: p.block.id, category: p.category, text: p.block.text }));
  const assembled: VBlock[] = base.map((b) => {
    let text = LOCKED.includes(b.category) ? b.text : rewrite(b.text, b.category, form.tone);
    if (b.category === "opening" && form.opening.trim()) text = form.opening.trim();
    if (b.category === "guardrails" && form.guardrails.trim()) text = `${text}\n${form.guardrails.trim().split(/\n+/).map((l) => `- ${l.replace(/^[-•]\s*/, "")}`).join("\n")}`;
    return { ...b, text };
  });
  const texts = assembled.map((b) => b.text);
  const generate = () => { setPhase("thinking"); setTimeout(() => setPhase("result"), 1400); };
  async function create() {
    const r = await post("/api/prompts", { ...form, ticket: Number(form.ticket), blocks: assembled, reference: ref ? `${ref.client} v${ref.current}` : "" });
    if (r.ok) onCreated(r.json.prompt); else setMsg(r.json.error ?? "Couldn't create the draft.");
  }
  const LANGS = ["Hindi", "English", "Marathi", "Tamil", "Telugu", "Bengali", "Gujarati", "Kannada"];
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <Card title="New client" sub="Start from a proven prompt, describe the client, then the assistant rewrites it for the tone. Compliance blocks stay as they are.">
        <fieldset disabled={phase === "thinking"} className="space-y-3 text-[12px] text-muted">
          <label className="block">Start from (reference prompt)
            <select className="input mt-1 block w-full" value={refId} onChange={(e) => setRefId(e.target.value)}>
              <option value="">No reference: best-proven blocks</option>
              {proven.map((p) => <option key={p.id} value={p.id}>{catalogName(p)} · {p.client} v{p.current}</option>)}
            </select>
          </label>
          <label className="block">Client name<input className="input mt-1 block w-full" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></label>
          <label className="block">Product
            <select className="input mt-1 block w-full" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
              {["BNPL", "Personal Loan", "Credit Card", "Two-Wheeler Loan"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">Average ticket (₹)<input type="number" min={0} className="input mt-1 block w-full" value={form.ticket} onChange={(e) => setForm({ ...form, ticket: e.target.value })} /></label>
            <label className="block">DPD bucket
              <select className="input mt-1 block w-full" value={form.dpd} onChange={(e) => setForm({ ...form, dpd: e.target.value })}>{["Pre-due", "1–30", "31–60", "61–90", "90+"].map((x) => <option key={x}>{x}</option>)}</select>
            </label>
          </div>
          <div>Languages
            <div className="mt-1 flex flex-wrap gap-1.5">
              {LANGS.map((l) => {
                const on = form.languages.includes(l);
                return <button type="button" key={l} aria-pressed={on} onClick={() => setForm({ ...form, languages: on ? form.languages.filter((x) => x !== l) : [...form.languages, l] })}
                  className={`rounded-full border px-2.5 py-1 text-[12px] ${on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line text-ink-2"}`}>{l}</button>;
              })}
            </div>
          </div>
          <div>Tone (client mandate)
            <div className="mt-1 grid gap-1.5">
              {TONES.map((t) => (
                <label key={t.key} className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 ${form.tone === t.key ? "border-brand bg-brand-soft" : "border-line"}`}>
                  <input type="radio" name="tone" className="mt-0.5 accent-[var(--color-brand)]" checked={form.tone === t.key} onChange={() => setForm({ ...form, tone: t.key })} />
                  <span><span className="block text-[13px] font-medium text-ink">{t.label}</span>{t.hint}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="block">Specific opening (optional)<textarea rows={2} className="input mt-1 block w-full" placeholder="e.g. Namaste {first_name}, this is Riya from Brisk Pay…" value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} /></label>
          <label className="block">Extra guardrails or compliance lines (one per line)<textarea rows={3} className="input mt-1 block w-full" placeholder={"Never mention the co-borrower\nNo calls on Sundays"} value={form.guardrails} onChange={(e) => setForm({ ...form, guardrails: e.target.value })} /></label>
          <button type="button" className="btn btn-primary w-full" onClick={generate}><Wand2 size={14} aria-hidden="true" />Assemble prompt</button>
          <p>Disclosure, complaint handling and compliance guardrails are locked: the tone never rewrites them.</p>
        </fieldset>
      </Card>

      {phase === "form" && <Card><Empty title="Nothing assembled yet">Fill in the client and press Assemble prompt.</Empty></Card>}
      {phase === "thinking" && (
        <Card><div className="flex items-center gap-3 py-10 text-[13px] text-muted" role="status"><Sparkles size={16} className="animate-pulse text-brand" aria-hidden="true" />Choosing blocks from {SOURCES.length} production prompts and rewriting them for a {toneLabel(form.tone).toLowerCase()} tone…</div></Card>
      )}
      {phase === "result" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Blocks" value={num(assembled.length)} sub={`${assembled.filter((b) => LOCKED.includes(b.category)).length} locked`} />
            <Kpi label="Length" value={`${pagesOf(texts).toFixed(1)} pages`} tone={pagesOf(texts) > TARGET_PAGES ? "bad" : "good"} sub={`Target about ${TARGET_PAGES}`} />
            <Kpi label="Tools" value={num(toolsIn(texts).length)} sub={toolsIn(texts).map((k) => TOOLS.find((t) => t.key === k)!.label).join(", ")} />
            <Kpi label="Variables" value={num(variablesIn(texts).length)} sub={variablesIn(texts).slice(0, 5).join(" ")} />
          </div>
          <Card title={`${form.client} · ${form.product} · ${toneLabel(form.tone)}`} sub="Simulated LLM output: engineering connects the real model. Review every block before testing."
            right={<button className="btn btn-primary" onClick={create}><Save size={14} aria-hidden="true" />Create draft</button>}>
            <ol className="space-y-3">
              {assembled.map((b, i) => (
                <li key={`${b.category}-${i}`} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="font-semibold">{i + 1}. {catLabel(b.category)}</span>
                    {LOCKED.includes(b.category) && <span className="inline-flex items-center gap-1 rounded bg-sunk px-1.5 py-0.5 text-muted"><Lock size={11} aria-hidden="true" />Locked</span>}
                    <span className="ml-auto text-muted">{ref ? `From ${ref.client} v${ref.current}` : (() => { const p = picks.find((x) => x.category === b.category); return p ? `From ${p.block.source} (${p.block.id}) · ${p.reason}` : ""; })()}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[13px]">{b.text}</p>
                  {base[i].text !== b.text && (
                    <details className="mt-1.5 text-[12px] text-muted"><summary className="cursor-pointer select-none">Compare with the reference</summary><p className="mt-1 whitespace-pre-wrap rounded bg-sunk px-2 py-1.5">{base[i].text}</p></details>
                  )}
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap gap-1.5 text-[12px]"><span className="text-muted">Needs variables:</span>{variablesIn(texts).map((v) => <code key={v} className="rounded bg-sunk px-1.5 py-0.5">{v}</code>)}</div>
            {msg && <p className="mt-2 text-[12.5px] text-bad" role="alert">{msg}</p>}
          </Card>
        </div>
      )}
    </div>
  );
}

/** Word-level diff for the side-by-side view. */
function diffWords(a: string, b: string) {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  const m = x.length, n = y.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const left: { t: string; k: "same" | "del" }[] = [], right: { t: string; k: "same" | "add" }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) { left.push({ t: x[i], k: "same" }); right.push({ t: y[j], k: "same" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) left.push({ t: x[i++], k: "del" });
    else right.push({ t: y[j++], k: "add" });
  }
  while (i < m) left.push({ t: x[i++], k: "del" });
  while (j < n) right.push({ t: y[j++], k: "add" });
  return { left, right };
}

const QC_FAILURES = [
  { category: "identity" as BlockCategory, calls: 6, issue: "AI and recording notice not played", example: "call_7k2m9q" },
  { category: "objection" as BlockCategory, calls: 11, issue: "Borrower disputed the amount; agent kept asking for payment", example: "call_3vx81d" },
  { category: "negotiation" as BlockCategory, calls: 4, issue: "No promise captured before the call ended", example: "call_q09zrt" },
];

function Editor({ doc, focusBlock, onBack, onSaved }: { doc: PromptDoc; focusBlock: string | null; onBack: () => void; onSaved: (p: PromptDoc) => void }) {
  const cur = doc.versions.find((v) => v.v === doc.current)!;
  const [blocks, setBlocks] = useState<VBlock[]>(cur.blocks);
  const [sel, setSel] = useState<string | null>(focusBlock && cur.blocks.some((b) => b.blockId === focusBlock) ? focusBlock : cur.blocks[0]?.blockId ?? null);
  const [side, setSide] = useState<"Compare" | "Versions" | "Test call" | "QC results">("Compare");
  const [drag, setDrag] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const dirty = JSON.stringify(blocks) !== JSON.stringify(cur.blocks);
  useEffect(() => { if (focusBlock) document.getElementById(`blk-${focusBlock}`)?.scrollIntoView({ block: "center" }); }, [focusBlock]);

  const texts = blocks.map((b) => b.text);
  const pages = pagesOf(texts);
  const selBlock = blocks.find((b) => b.blockId === sel);
  const source = sel ? blockById(sel) : undefined;

  async function act(body: object, done: string) {
    const r = await post("/api/prompts", { id: doc.id, ...body }, "PATCH");
    if (r.ok) { onSaved(r.json.prompt); setMsg(done); } else setMsg(r.json.error ?? "That didn't work.");
    return r;
  }
  const move = (from: number, to: number) => setBlocks((bs) => { const next = [...bs]; const [it] = next.splice(from, 1); next.splice(to, 0, it); return next; });
  const swap = (idx: number, blockId: string) => {
    const b = blockById(blockId)!;
    setBlocks((bs) => bs.map((x, i) => (i === idx ? { blockId, category: b.category, text: rewrite(b.text, b.category, doc.tone) } : x)));
    setSel(blockId);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost" onClick={() => { if (!dirty || window.confirm("Leave without saving this version?")) onBack(); }}><ArrowLeft size={14} aria-hidden="true" />All prompts</button>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold">{doc.client}</div>
          <div className="text-[12px] text-muted">{doc.product} · {toneLabel(doc.tone)} · {doc.languages.join(", ")} · v{doc.current} · {doc.status}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-56" placeholder="Version note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Version note" />
        <button className="btn" disabled={!dirty} onClick={async () => { const r = await act({ action: "save", blocks, note }, "Saved as a new version."); if (r.ok) setNote(""); }}><Save size={14} aria-hidden="true" />Save version</button>
        <button className="btn" disabled={dirty || testing} onClick={async () => { setTesting(true); setSide("Test call"); await new Promise((r) => setTimeout(r, 1200)); await act({ action: "test" }, "Test call finished."); setTesting(false); }}><PhoneCall size={14} aria-hidden="true" />{testing ? "Calling…" : "Test call"}</button>
        <button className="btn btn-primary" disabled={dirty || !cur.test?.passed || doc.status === "Published"} onClick={() => act({ action: "publish" }, "Published. Agents using this prompt get v" + doc.current + ".")}><Rocket size={14} aria-hidden="true" />Publish</button>
      </div>
      {msg && <p className="text-[12.5px] text-ink-2" role="status">{msg}</p>}
      {dirty && <p className="text-[12.5px] text-warn">Unsaved changes. Save a version to test and publish it.</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Length" value={`${pages.toFixed(1)} pages`} tone={pages > TARGET_PAGES ? "bad" : "good"} sub={pages > TARGET_PAGES ? "Too long: long prompts cause hallucinations" : `Under the ${TARGET_PAGES}-page target`} />
        <Kpi label="Last test" value={cur.test ? `${cur.test.score}%` : "Not tested"} tone={cur.test ? (cur.test.passed ? "good" : "bad") : undefined} sub={cur.test ? (cur.test.passed ? "Passed" : `${cur.test.failedBlocks.length} block(s) failed`) : "Run a test call before publishing"} />
        <Kpi label="Tools" value={num(toolsIn(texts).length)} sub={toolsIn(texts).map((k) => TOOLS.find((t) => t.key === k)!.label).join(", ") || "None"} />
        <Kpi label="Variables" value={num(variablesIn(texts).length)} sub={variablesIn(texts).slice(0, 4).join(" ")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card pad={false} title="Blocks" sub="Drag to reorder. Swap in a block from another lender or edit the text.">
          <ol className="space-y-2 p-3">
            {blocks.map((b, i) => {
              const lib = blockById(b.blockId);
              const failed = cur.test?.failedBlocks.includes(b.blockId);
              const locked = LOCKED.includes(b.category);
              return (
                <li key={`${b.blockId}-${i}`} id={`blk-${b.blockId}`} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null && drag !== i) move(drag, i); setDrag(null); }}
                  onClick={() => setSel(b.blockId)}
                  className={`rounded-md border p-3 ${sel === b.blockId ? "border-ink" : failed ? "border-bad/50 bg-bad-soft/40" : "border-line"} ${drag === i ? "opacity-50" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <GripVertical size={14} className="cursor-grab text-muted" aria-hidden="true" />
                    <span className="font-semibold">{catLabel(b.category)}</span>
                    {locked && <span className="inline-flex items-center gap-1 rounded bg-sunk px-1.5 py-0.5 text-muted"><Lock size={11} aria-hidden="true" />Locked</span>}
                    {failed && <span className="rounded bg-bad-soft px-1.5 py-0.5 font-medium text-bad">Failed test</span>}
                    <select aria-label={`Source block for ${catLabel(b.category)}`} className="input ml-auto h-7 py-0 text-[12px]" value={b.blockId} onChange={(e) => swap(i, e.target.value)} onClick={(e) => e.stopPropagation()}>
                      {pickBlocks(doc.product, doc.tone).find((p) => p.category === b.category)!.options.map((o) => <option key={o.id} value={o.id}>{o.source} · {o.passRate}%</option>)}
                    </select>
                  </div>
                  <textarea aria-label={`${catLabel(b.category)} text`} rows={Math.min(8, Math.max(2, Math.ceil(b.text.length / 90)))} readOnly={locked}
                    className={`input mt-2 block w-full text-[12.5px] leading-relaxed ${locked ? "bg-sunk/50" : ""}`} value={b.text}
                    onChange={(e) => setBlocks((bs) => bs.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
                  {lib && <div className="mt-1 text-[11.5px] text-muted">{lib.source} · {num(lib.testCalls)} test calls · {lib.passRate}% pass</div>}
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-3">
          <Tabs tabs={["Compare", "Versions", "Test call", "QC results"] as const} value={side} onChange={setSide} />
          {side === "Compare" && (selBlock && source ? (() => {
            const { left, right } = diffWords(source.text, selBlock.text);
            return (
              <Card title={catLabel(selBlock.category)} sub={`Left: the original block from ${source.source}. Right: this prompt.`}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-sunk/60 p-3 text-[12.5px] leading-relaxed">{left.map((t, k) => <span key={k} className={t.k === "del" ? "bg-bad-soft text-bad line-through" : ""}>{t.t}</span>)}</div>
                  <div className="rounded-md bg-sunk/60 p-3 text-[12.5px] leading-relaxed">{right.map((t, k) => <span key={k} className={t.k === "add" ? "bg-good-soft text-good" : ""}>{t.t}</span>)}</div>
                </div>
              </Card>
            );
          })() : <Card><Empty title="Select a block">Its side-by-side comparison with the source shows here.</Empty></Card>)}

          {side === "Versions" && (
            <Card pad={false} title="Versions" sub="Every save is a new version. Rolling back creates a new version from an old one.">
              <ul className="divide-y divide-line">
                {[...doc.versions].reverse().map((v) => (
                  <li key={v.v} className="flex items-start gap-3 px-4 py-3 text-[12.5px]">
                    <History size={14} className="mt-0.5 text-muted" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">v{v.v}{v.v === doc.current ? " · current" : ""}</div>
                      <div className="text-muted">{v.note} · {v.by} · {d(v.at)}{v.test ? ` · test ${v.test.score}% ${v.test.passed ? "pass" : "fail"}` : ""}</div>
                    </div>
                    {v.v !== doc.current && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => { setBlocks(v.blocks); act({ action: "rollback", v: v.v }, `Rolled back to v${v.v}.`); }}>Roll back</button>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {side === "Test call" && (
            <Card title="Test call" sub={cur.test ? `Simulated call on v${cur.v}, ${d(cur.test.at)}: ${cur.test.score}% · ${cur.test.passed ? "passed" : "failed"}` : "Run a test call to see the transcript. Engineering connects this to a real Voiz test line."}>
              {testing ? <p className="text-[13px] text-muted" role="status">Calling a test borrower…</p> : cur.test ? (
                <ol className="space-y-1.5">
                  {transcript(cur.blocks, cur.test.failedBlocks).map((l, k) => (
                    <li key={k} className={`rounded-md px-3 py-1.5 text-[12.5px] ${l.who === "Agent" ? (l.failed ? "bg-bad-soft" : "bg-sunk/60") : "ml-8 border border-line"}`}>
                      <span className="font-semibold">{l.who}:</span> {l.text}
                      {l.failed && <button className="ml-2 text-[11.5px] font-medium text-bad underline" onClick={() => { setSel(l.blockId); setSide("Compare"); document.getElementById(`blk-${l.blockId}`)?.scrollIntoView({ block: "center" }); }}>Failed here: open block</button>}
                    </li>
                  ))}
                </ol>
              ) : <Empty title="Not tested yet" />}
            </Card>
          )}

          {side === "QC results" && (
            <Card pad={false} title="QC results from live calls" sub="Failures found in Conversations, traced to the block that caused them.">
              <ul className="divide-y divide-line">
                {QC_FAILURES.map((f) => {
                  const b = blocks.find((x) => x.category === f.category);
                  return (
                    <li key={f.category} className="px-4 py-3 text-[12.5px]">
                      <div className="flex items-center justify-between gap-2"><span className="font-medium">{catLabel(f.category)}</span><span className="text-bad num">{f.calls} calls</span></div>
                      <div className="text-muted">{f.issue} · e.g. {f.example}</div>
                      {b && <button className="mt-1 text-[12px] text-brand hover:underline" onClick={() => { setSel(b.blockId); setSide("Compare"); document.getElementById(`blk-${b.blockId}`)?.scrollIntoView({ block: "center" }); }}>Open the {catLabel(f.category).toLowerCase()} block →</button>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
