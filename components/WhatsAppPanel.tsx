"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, CheckCheck, CheckCircle2, CircleAlert, Clock, FilePlus2, MessageCircle, PauseCircle, Plus, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { Card, Empty, ErrorNote, Loading } from "@/components/ui";
import { can } from "@/lib/roles";
import type { WaMessage, WaTemplate } from "@/lib/types";
import { guessMapping, type WaFieldKey, type WaMapping } from "@/lib/waFields";

interface Todo { title: string; detail: string; state: "blocker" | "todo" | "parked" | "done"; due?: string }
interface View {
  configured: boolean; missing: string[]; mode: "test" | "live"; testNumbers: string[]; appId: string; wabaId: string; phoneNumberId: string; version: string; source: string;
  health?: { checkedAt: string; ok: boolean; number?: Record<string, string>; error?: { code?: number; title: string; detail?: string } };
  templates: WaTemplate[]; templatesSyncedAt?: string; lastWebhookAt?: string; messages: WaMessage[];
  openWindows: { to: string; until: string }[]; campaigns: { id: string; name: string; status: string; members: number }[];
  fields: readonly { key: WaFieldKey; label: string }[]; todos: Todo[];
  recipients: { phone: string; name?: string }[]; languages: string[];
  chats: Chat[]; numbers: { id: string; display_phone_number: string; verified_name?: string; quality_rating?: string; status?: string; code_verification_status?: string }[];
  defaultPhoneNumberId: string;
}
interface ChatMsg { id: string; ts: string; direction: "in" | "out"; text: string; status: string; template?: string; error?: { code?: number; title: string; detail?: string }; by?: string }
interface Chat {
  id: string; phone: string; name: string; loanId?: string; lastAt: string; lastText: string; lastDirection: "in" | "out"; lastOutStatus?: string;
  replies: number; unread: number; windowOpen: boolean; windowUntil?: string; messages: ChatMsg[];
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const tplKey = (t: WaTemplate) => `${t.name}|${t.language}`;
const STATUS_STYLE: Record<string, string> = {
  accepted: "bg-sunk text-ink-2", sent: "bg-info-soft text-info", delivered: "bg-info-soft text-info", read: "bg-good-soft text-good",
  failed: "bg-bad-soft text-bad", received: "bg-brand-soft text-brand",
};
const TODO_STYLE = { blocker: "bg-bad-soft text-bad", todo: "bg-warn-soft text-warn", parked: "bg-sunk text-ink-2", done: "bg-good-soft text-good" } as const;
const TODO_ICON = { blocker: CircleAlert, todo: Clock, parked: PauseCircle, done: CheckCircle2 } as const;

/** Meta error codes we've actually hit, explained in plain words. */
const ERROR_HELP: Record<number, string> = {
  131047: "More than 24 hours since this person last messaged us, so free text isn't allowed. Use a template.",
  131042: "Payment problem on the WhatsApp account. Add a payment method in WhatsApp Manager.",
  131037: "The sending number's display name hasn't been reviewed by Meta.",
  131026: "Couldn't be delivered: the number may not be on WhatsApp, or is on an old app version.",
  131009: "A value in the request isn't valid (often the phone number or a template variable).",
  131005: "Access denied: the token can't send from this number, or the number isn't fully set up.",
  132001: "The template name or language doesn't exist on this WhatsApp account.",
  132000: "The number of template variables doesn't match the template.",
  130472: "Meta held this message back as part of a test of marketing message limits.",
};

export default function WhatsAppPanel() {
  const { user } = useApp();
  const { data, error, setData, reload } = useApi<View | null>("/api/whatsapp", () => null, 5000);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={2} />;

  async function run(action: string, done: string) {
    setBusy(action); setNote("");
    const r = await post("/api/whatsapp", { action });
    if (r.ok) { setData(r.json); setNote(done); } else setNote(r.json.error ?? "That didn't work.");
    setBusy("");
  }
  const approved = data.templates.filter((t) => t.status === "APPROVED");
  const pending = data.templates.filter((t) => t.status === "PENDING");

  return (
    <div className="space-y-4">
      {!data.configured && (
        <div className="rounded-md border border-bad/30 bg-bad-soft px-4 py-3 text-[13px] text-bad">
          WhatsApp isn't connected on this server yet. Add these environment variables and redeploy: <span className="font-mono">{data.missing.join(", ")}</span>.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SendingNumber data={data} canChange={can(user.role, "manageConnectors")} onChange={(v) => setData(v)} />
        <section className="card p-4">
          <div className="label">Mode</div>
          <div className={`mt-1.5 text-[16px] font-semibold ${data.mode === "live" ? "text-bad" : ""}`}>{data.mode === "live" ? "Live: real borrowers" : "Test"}</div>
          <div className="mt-1 text-[12px] text-muted">{data.mode === "test" ? <>Borrower messages go to {data.testNumbers.join(", ") || "no test number set"} instead of the borrower.</> : "Messages go to borrowers' own numbers."}</div>
        </section>
        <section className="card p-4">
          <div className="label">Templates</div>
          <div className="mt-1.5 text-[16px] font-semibold">{approved.length} approved{pending.length ? <span className="text-warn"> · {pending.length} in review</span> : null}</div>
          <div className="mt-1 text-[12px] text-muted">Synced {when(data.templatesSyncedAt)}</div>
        </section>
        <section className="card p-4">
          <div className="label">Delivery updates</div>
          <div className="mt-1.5 text-[16px] font-semibold">{data.lastWebhookAt ? "Receiving" : "Nothing yet"}</div>
          <div className="mt-1 text-[12px] text-muted">{data.lastWebhookAt ? `Last update ${when(data.lastWebhookAt)}` : "Meta still sends them to the GFF demo"}</div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={!data.configured || !!busy} onClick={() => run("health", "Connection checked.")}><ShieldCheck size={14} aria-hidden="true" />{busy === "health" ? "Checking…" : "Check connection"}</button>
        <button className="btn" disabled={!data.configured || !!busy} onClick={() => run("syncTemplates", "Templates synced from Meta.")}><RefreshCw size={14} aria-hidden="true" />{busy === "syncTemplates" ? "Syncing…" : "Sync templates"}</button>
        {note && <span className="text-[12.5px] text-ink-2" role="status">{note}</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {can(user.role, "sendLink")
          ? <SingleSend data={data} onSent={(v) => setData(v)} />
          : <Card title="Send one message"><p className="text-[13px] text-muted">Your role can't send WhatsApp messages.</p></Card>}
        <RightPanel data={data} canReply={can(user.role, "sendLink")} onChange={(v) => setData(v)} todos={
          <ul className="space-y-2">
            {data.todos.map((t) => {
              const Icon = TODO_ICON[t.state];
              return (
                <li key={t.title} className="rounded-md border border-line p-3">
                  <div className="flex items-start gap-2">
                    <Icon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-medium">{t.title}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TODO_STYLE[t.state]}`}>{t.state === "todo" ? "To do" : t.state[0].toUpperCase() + t.state.slice(1)}</span>
                        {t.due && <span className="text-[11.5px] text-muted">Due {t.due}</span>}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted">{t.detail}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        } />
      </div>

      {can(user.role, "manageCampaigns") && <NewTemplate data={data} onDone={(v) => setData(v)} />}
      {can(user.role, "manageCampaigns") && <CampaignSend data={data} onDone={(v) => setData(v)} />}

      <Templates templates={data.templates} />
      <Log messages={data.messages} openWindows={data.openWindows} reload={reload} />
    </div>
  );
}

function SendingNumber({ data, canChange, onChange }: { data: View; canChange: boolean; onChange: (v: View) => void }) {
  const n = data.health?.number;
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(data.phoneNumberId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function call(action: string, extra: object = {}) {
    setBusy(true); setMsg("");
    const r = await post("/api/whatsapp", { action, ...extra });
    if (r.ok) onChange(r.json); else setMsg(r.json.error ?? "That didn't work.");
    setBusy(false);
    return r.ok;
  }
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Sending number</span>
        {canChange && data.configured && !open && <button className="text-[12px] text-brand hover:underline" onClick={async () => { setOpen(true); if (!data.numbers.length) await call("listNumbers"); }}>Change</button>}
      </div>
      <div className="mt-1.5 text-[16px] font-semibold num">{n?.display_phone_number ?? "Not checked yet"}</div>
      <div className="mt-1 text-[12px] text-muted">
        {n ? <>{n.verified_name} · {n.status?.toLowerCase()} · quality {n.quality_rating?.toLowerCase() ?? "—"}{n.code_verification_status && n.code_verification_status !== "VERIFIED" ? " · not verified" : ""}</>
          : data.health?.error ? <span className="text-bad">{data.health.error.code} {data.health.error.title}</span> : "Run a connection check."}
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {busy && !data.numbers.length ? <p className="text-[12px] text-muted">Loading numbers from Meta…</p> : (
            <>
              <select aria-label="Sending number" className="input block w-full text-[12.5px]" value={pick} onChange={(e) => setPick(e.target.value)}>
                {data.numbers.map((x) => (
                  <option key={x.id} value={x.id}>{x.display_phone_number} · {x.verified_name ?? "no name"}{x.id === data.defaultPhoneNumberId ? " (default)" : ""}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary min-h-8" disabled={busy || pick === data.phoneNumberId} onClick={async () => { if (await call("setNumber", { phoneNumberId: pick })) setOpen(false); }}>{busy ? "Switching…" : "Use this number"}</button>
                <button className="btn min-h-8" disabled={busy} onClick={() => call("listNumbers")}>Refresh list</button>
                <button className="btn btn-ghost min-h-8" onClick={() => setOpen(false)}>Cancel</button>
              </div>
              <p className="text-[11.5px] text-muted">Every number on this WhatsApp Business account. Templates are shared across them; quality and limits are per number.</p>
            </>
          )}
          {msg && <p className="text-[12px] text-bad" role="alert">{msg}</p>}
        </div>
      )}
    </section>
  );
}

function Ticks({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "read") return <CheckCheck size={14} className="shrink-0 text-[#2456c2]" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck size={14} className="shrink-0 text-muted" aria-label="Delivered" />;
  if (status === "sent") return <Check size={14} className="shrink-0 text-muted" aria-label="Sent" />;
  if (status === "failed") return <CircleAlert size={14} className="shrink-0 text-bad" aria-label="Failed" />;
  if (status === "accepted") return <Clock size={13} className="shrink-0 text-muted" aria-label="Waiting for Meta" />;
  return null;
}
const STATUS_WORD: Record<string, string> = { accepted: "Sending", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed", received: "Replied" };

function RightPanel({ data, canReply, onChange, todos }: { data: View; canReply: boolean; onChange: (v: View) => void; todos: React.ReactNode }) {
  const [tab, setTab] = useState<"Chats" | "To-dos">("Chats");
  const [openId, setOpenId] = useState<string | null>(null);
  const unread = data.chats.reduce((n, c) => n + c.unread, 0);
  const chat = data.chats.find((c) => c.id === openId);
  return (
    <section className="card flex max-h-[860px] flex-col">
      <header className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 className="text-[15px] font-semibold">{chat ? chat.name : tab === "Chats" ? "Chats" : "To-dos and blockers"}</h2>
        {!chat && (
          <div className="seg" role="group" aria-label="Panel">
            <button aria-pressed={tab === "Chats"} onClick={() => setTab("Chats")}>Chats{unread ? ` (${unread})` : ""}</button>
            <button aria-pressed={tab === "To-dos"} onClick={() => setTab("To-dos")}>To-dos</button>
          </div>
        )}
      </header>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "To-dos" && !chat ? todos : chat ? (
          <Thread chat={chat} data={data} canReply={canReply} onBack={() => setOpenId(null)} onChange={onChange} />
        ) : data.chats.length ? (
          <ul className="-mx-2 space-y-0.5">
            {data.chats.map((c) => (
              <li key={c.id}>
                <button className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-sunk/60" onClick={async () => {
                  setOpenId(c.id);
                  if (c.unread) { const r = await post("/api/whatsapp", { action: "markRead", chatId: c.id }); if (r.ok) onChange(r.json); }
                }}>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand">{c.name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "#"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-[13px] ${c.unread ? "font-semibold" : "font-medium"}`}>{c.name}</span>
                      <span className="shrink-0 text-[11px] text-muted num">{when(c.lastAt)}</span>
                    </span>
                    <span className="flex items-center gap-1 text-[12px] text-muted">
                      {c.lastDirection === "out" ? <Ticks status={c.lastOutStatus} /> : <MessageCircle size={12} className="shrink-0 text-brand" aria-hidden="true" />}
                      <span className="truncate">{c.lastDirection === "in" ? "Replied: " : ""}{c.lastText}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="text-muted">{c.phone}{c.loanId ? ` · ${c.loanId}` : ""}</span>
                      {c.lastOutStatus && <span className={`rounded px-1 ${STATUS_STYLE[c.lastOutStatus] ?? ""}`}>{STATUS_WORD[c.lastOutStatus] ?? c.lastOutStatus}</span>}
                      {c.replies > 0 && <span className="rounded bg-brand-soft px-1 text-brand">{c.replies} repl{c.replies === 1 ? "y" : "ies"}</span>}
                      {c.unread > 0 && <span className="rounded bg-brand px-1 text-white">{c.unread} new</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty title="No chats yet">Everyone you message shows here with whether they've read it, and their replies.</Empty>}
      </div>
    </section>
  );
}

function Thread({ chat, data, canReply, onBack, onChange }: { chat: Chat; data: View; canReply: boolean; onBack: () => void; onChange: (v: View) => void }) {
  const [mode, setMode] = useState<"text" | "template">(chat.windowOpen ? "text" : "template");
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [body, setBody] = useState<string[]>([]);
  const [header, setHeader] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const t = data.templates.find((x) => tplKey(x) === key);
  useEffect(() => { setBody(t ? t.bodyParams.map(() => "") : []); setHeader(t ? t.headerParams.map(() => "") : []); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat.messages.length, end]);

  async function send() {
    setBusy(true); setMsg("");
    const r = await post("/api/whatsapp", { action: "reply", chatId: chat.id, mode, ...(mode === "text" ? { text } : { template: t?.name, language: t?.language, params: body, headerParams: header }) });
    if (r.json.chats) onChange(r.json);
    if (r.ok) { setText(""); setKey(""); } else {
      const e = (r.json.message as WaMessage | undefined)?.error;
      setMsg(e ? `${e.code ?? ""} ${e.title}${e.code && ERROR_HELP[e.code] ? ` — ${ERROR_HELP[e.code]}` : ""}` : r.json.error ?? "Couldn't send.");
    }
    setBusy(false);
  }
  const ready = mode === "text" ? !!text.trim() : !!t && body.every(Boolean) && header.every(Boolean);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12px] text-muted">
        <button className="text-brand hover:underline" onClick={onBack}>← All chats</button>
        <span>{chat.phone}{chat.loanId ? ` · ${chat.loanId}` : ""}</span>
      </div>
      <div className="space-y-2 rounded-md bg-[#efeae2] p-3">
        {chat.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-relaxed shadow-sm ${m.direction === "out" ? "bg-[#d9fdd3]" : "bg-white"}`}>
              {m.template && <div className="font-mono text-[10.5px] text-muted">{m.template}</div>}
              <div className="whitespace-pre-wrap">{m.text}</div>
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-muted">
                <span className="num">{when(m.ts)}</span>
                {m.direction === "out" && <><Ticks status={m.status} /><span>{STATUS_WORD[m.status] ?? m.status}</span></>}
              </div>
              {m.error && <div className="mt-0.5 text-[11px] text-bad">{m.error.code} {m.error.title}{m.error.code && ERROR_HELP[m.error.code] ? <span className="block text-muted">{ERROR_HELP[m.error.code]}</span> : null}</div>}
            </div>
          </div>
        ))}
        <div ref={(el) => { end.current = el; }} />
      </div>

      {canReply ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="seg" role="group" aria-label="Reply type">
              <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>Reply</button>
              <button type="button" aria-pressed={mode === "template"} onClick={() => setMode("template")}>Template</button>
            </div>
            <span className={`text-[11.5px] ${chat.windowOpen ? "text-good" : "text-muted"}`}>{chat.windowOpen ? `Free text open until ${when(chat.windowUntil)}` : "24-hour window closed: template only"}</span>
          </div>
          {mode === "text" ? (
            <textarea className="input block w-full" rows={2} maxLength={4096} placeholder={chat.windowOpen ? "Type a reply" : "They haven't messaged in 24 hours. Use a template."} disabled={!chat.windowOpen}
              value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && ready && !busy) { e.preventDefault(); send(); } }} />
          ) : (
            <>
              <TemplatePicker templates={data.templates} value={key} onChange={setKey} />
              {t && [...t.headerParams.map((p, i) => ({ p, i, h: true })), ...t.bodyParams.map((p, i) => ({ p, i, h: false }))].map(({ p, i, h }) => (
                <input key={`${h}-${p}`} className="input block w-full text-[12.5px]" placeholder={`${h ? "Header " : ""}{{${p}}}`} value={(h ? header : body)[i] ?? ""}
                  onChange={(e) => { const next = [...(h ? header : body)]; next[i] = e.target.value; (h ? setHeader : setBody)(next); }} />
              ))}
            </>
          )}
          <div className="flex items-center gap-2">
            <button className="btn btn-primary min-h-8" disabled={!ready || busy || !data.configured} onClick={send}><Send size={13} aria-hidden="true" />{busy ? "Sending…" : "Send"}</button>
            {msg && <span className="text-[12px] text-bad" role="alert">{msg}</span>}
          </div>
        </div>
      ) : <p className="mt-3 text-[12px] text-muted">Your role can read chats but not reply.</p>}
    </div>
  );
}

function TemplatePicker({ templates, value, onChange }: { templates: WaTemplate[]; value: string; onChange: (k: string) => void }) {
  return (
    <select className="input mt-1 block w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose an approved template…</option>
      {templates.map((t) => <option key={tplKey(t)} value={tplKey(t)} disabled={t.status !== "APPROVED"}>{t.name} · {t.language}{t.status !== "APPROVED" ? ` (${t.status.toLowerCase()})` : ""}</option>)}
    </select>
  );
}

function Preview({ t, body, header }: { t?: WaTemplate; body: string[]; header: string[] }) {
  if (!t) return null;
  const fill = (text: string | undefined, names: string[], vals: string[]) => (text ?? "").replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => vals[names.indexOf(k)] || `{{${k}}}`);
  return (
    <div className="rounded-lg bg-[#e7f4ee] p-3 text-[13px] leading-relaxed text-ink">
      {t.header && <div className="mb-1 font-semibold">{fill(t.header, t.headerParams, header)}</div>}
      <div className="whitespace-pre-wrap">{fill(t.body, t.bodyParams, body)}</div>
    </div>
  );
}

function SingleSend({ data, onSent }: { data: View; onSent: (v: View) => void }) {
  const [target, setTarget] = useState<"number" | "borrower">("number");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [confirmMany, setConfirmMany] = useState(false);
  const [loanId, setLoanId] = useState("");
  const [found, setFound] = useState<{ borrower: { name: string; loanId: string; product: string; waConsent: boolean }; values: Record<string, string>; blocked: string | null; recipient: { to?: string; redirected?: boolean; error?: string } } | null>(null);
  const [mode, setMode] = useState<"template" | "text">("template");
  const [key, setKey] = useState("");
  const [body, setBody] = useState<string[]>([]);
  const [header, setHeader] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const t = data.templates.find((x) => tplKey(x) === key);

  // Picking a template (or a borrower) pre-fills its variables from the borrower's details.
  useEffect(() => {
    if (!t) { setBody([]); setHeader([]); return; }
    const fill = (params: string[]) => guessMapping(params).map((m) => (found && m.source === "field" ? found.values[m.key] ?? "" : ""));
    setBody(fill(t.bodyParams)); setHeader(fill(t.headerParams));
  }, [key, found]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup() {
    setFound(null); setMsg(null);
    const r = await post("/api/whatsapp", { action: "borrower", loanId });
    if (r.ok) setFound(r.json); else setMsg({ ok: false, text: r.json.error ?? "Couldn't find that borrower." });
  }
  // Every number this send goes to: ticked saved numbers plus anything typed (comma, space or new line between them).
  const numbers = [...new Set([...picked, ...to.split(/[\s,;]+/).map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 10)])];

  async function saveNumber() {
    setMsg(null);
    const r = await post("/api/whatsapp", { action: "saveRecipient", phone: newPhone, name: newName });
    if (r.ok) {
      onSent(r.json);
      const saved = (r.json as View).recipients.find((x) => x.phone.slice(-10) === newPhone.replace(/\D/g, "").slice(-10));
      if (saved) setPicked((p) => [...new Set([...p, saved.phone])]);
      setNewPhone(""); setNewName("");
    } else setMsg({ ok: false, text: r.json.error ?? "Couldn't save that number." });
  }
  async function removeNumber(phone: string) {
    const r = await post("/api/whatsapp", { action: "removeRecipient", phone });
    if (r.ok) { onSent(r.json); setPicked((p) => p.filter((x) => x !== phone)); }
  }
  async function send() {
    setSending(true); setMsg(null); setConfirmMany(false);
    const r = await post("/api/whatsapp", {
      action: "send", mode, ...(target === "number" ? { to: numbers } : { loanId }),
      ...(mode === "template" ? { template: t?.name, language: t?.language, params: body, headerParams: header } : { text }),
    });
    if (r.json.messages) onSent(r.json);
    const results = r.json.results as { to: string; ok: boolean; error?: string }[] | undefined;
    const m = r.json.message as WaMessage | undefined;
    if (results && results.length > 1) {
      const bad = results.filter((x) => !x.ok);
      setMsg({ ok: !bad.length, text: `Accepted by Meta for ${results.length - bad.length} of ${results.length}.${bad.length ? ` Failed: ${bad.map((x) => `${x.to} (${x.error})`).join(", ")}.` : ""} Delivery shows in the log below.` });
    } else setMsg(r.ok ? { ok: true, text: `Accepted by Meta (${m?.id.slice(0, 18)}…). Delivery shows in the log below once Meta reports it.` }
      : { ok: false, text: m?.error ? `${m.error.code ?? ""} ${m.error.title}${m.error.code && ERROR_HELP[m.error.code] ? ` — ${ERROR_HELP[m.error.code]}` : ""}` : r.json.error ?? "Couldn't send." });
    setSending(false);
  }
  const ready = (target === "number" ? numbers.length > 0 : !!found && !found.blocked && !found.recipient.error)
    && (mode === "text" ? !!text.trim() : !!t && body.every(Boolean) && header.every(Boolean));

  return (
    <Card title="Send message" sub="To saved or typed WhatsApp numbers, or to a borrower by loan ID.">
      <div className="space-y-3">
        <div className="seg" role="group" aria-label="Send to">
          <button type="button" aria-pressed={target === "number"} onClick={() => setTarget("number")}>Phone numbers</button>
          <button type="button" aria-pressed={target === "borrower"} onClick={() => setTarget("borrower")}>Borrower</button>
        </div>
        {target === "number" ? (
          <div className="space-y-3">
            <div>
              <div className="label mb-1">Saved numbers</div>
              {data.recipients.length ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {data.recipients.map((r) => (
                    <li key={r.phone} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={picked.includes(r.phone)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.phone] : p.filter((x) => x !== r.phone)))} />
                        <span className="truncate">{r.name || "—"}</span>
                        <span className="ml-auto font-mono text-[12px] text-muted num">+{r.phone}</span>
                      </label>
                      <button type="button" className="btn btn-ghost min-h-7 px-1.5" aria-label={`Remove ${r.name ?? r.phone}`} onClick={() => removeNumber(r.phone)}><X size={13} aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12px] text-muted">None yet. Add one below.</p>}
              {data.recipients.length > 1 && (
                <div className="mt-1 flex gap-3 text-[12px]">
                  <button type="button" className="text-brand hover:underline" onClick={() => setPicked(data.recipients.map((r) => r.phone))}>Select all</button>
                  <button type="button" className="text-brand hover:underline" onClick={() => setPicked([])}>Clear</button>
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block text-[12px] text-muted">Add number
                <input className="input mt-1 block w-full" inputMode="tel" placeholder="+91 98765 43210" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </label>
              <label className="block text-[12px] text-muted">Name (optional)
                <input className="input mt-1 block w-full" placeholder="Rahul, ops team" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <button type="button" className="btn" disabled={newPhone.replace(/\D/g, "").length < 10} onClick={saveNumber}><Plus size={14} aria-hidden="true" />Save</button>
            </div>
            <label className="block text-[12px] text-muted">Or type numbers for this send only (comma or new line between them)
              <textarea id="wa-to" className="input mt-1 block w-full" rows={2} inputMode="tel" placeholder="+91 98765 43210, +91 91234 56789" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <p className="text-[12px] text-muted">{numbers.length ? `Sending to ${numbers.length} number${numbers.length === 1 ? "" : "s"}.` : "Tick a saved number or type one."}</p>
          </div>
        ) : (
          <div>
            <label className="block text-[12px] text-muted">Loan ID
              <div className="mt-1 flex gap-2">
                <input id="wa-loan" className="input block w-full font-mono" placeholder="LN2024000123" value={loanId} onChange={(e) => { setLoanId(e.target.value); setFound(null); }} />
                <button type="button" className="btn" onClick={lookup} disabled={!loanId.trim()}>Find</button>
              </div>
            </label>
            {found && (
              <p className={`mt-2 rounded-md px-3 py-2 text-[12.5px] ${found.blocked || found.recipient.error ? "bg-bad-soft text-bad" : "bg-sunk text-ink-2"}`}>
                {found.borrower.name} · {found.borrower.product} · {found.borrower.loanId}.{" "}
                {found.blocked ? `Can't message: ${found.blocked}.` : found.recipient.error ? found.recipient.error : found.recipient.redirected ? `Test mode: this goes to ${found.recipient.to}, not the borrower.` : `Goes to ${found.recipient.to}.`}
              </p>
            )}
          </div>
        )}

        <div className="seg" role="group" aria-label="Message type">
          <button type="button" aria-pressed={mode === "template"} onClick={() => setMode("template")}>Approved template</button>
          <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>Free text</button>
        </div>

        {mode === "template" ? (
          <>
            <label className="block text-[12px] text-muted">Template<TemplatePicker templates={data.templates} value={key} onChange={setKey} /></label>
            {!data.templates.length && <p className="text-[12px] text-muted">No templates yet. Use "Sync templates" above.</p>}
            {t && [...t.headerParams.map((p, i) => ({ p, i, h: true })), ...t.bodyParams.map((p, i) => ({ p, i, h: false }))].map(({ p, i, h }) => (
              <label key={`${h}-${p}`} className="block text-[12px] text-muted">{h ? "Header" : "Variable"} {`{{${p}}}`}
                <input className="input mt-1 block w-full" value={(h ? header : body)[i] ?? ""} onChange={(e) => {
                  const next = [...(h ? header : body)]; next[i] = e.target.value; (h ? setHeader : setBody)(next);
                }} />
              </label>
            ))}
            <Preview t={t} body={body} header={header} />
          </>
        ) : (
          <>
            <textarea className="input block w-full" rows={4} maxLength={4096} placeholder="Your message" value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-[12px] text-muted">Free text only arrives if this person messaged our WhatsApp number in the last 24 hours. {data.openWindows.length ? `Open right now: ${data.openWindows.map((w) => `${w.to} until ${when(w.until)}`).join(", ")}.` : "No one has an open window right now."}</p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {confirmMany ? (
            <span className="flex flex-wrap items-center gap-2 rounded-md bg-warn-soft px-3 py-1.5 text-[12.5px] text-warn">
              Send to {numbers.length} numbers?
              <button className="btn btn-primary min-h-8" onClick={send}>Yes, send</button>
              <button className="btn btn-ghost min-h-8" onClick={() => setConfirmMany(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn btn-primary" disabled={!ready || sending || !data.configured} onClick={() => (target === "number" && numbers.length > 1 ? setConfirmMany(true) : send())}>
              <Send size={14} aria-hidden="true" />{sending ? "Sending…" : target === "number" && numbers.length > 1 ? `Send to ${numbers.length}` : "Send"}
            </button>
          )}
          {msg && <span className={`text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role="status">{msg.text}</span>}
        </div>
      </div>
    </Card>
  );
}

function MappingRow({ label, value, fields, onChange }: { label: string; value: WaMapping; fields: View["fields"]; onChange: (m: WaMapping) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[110px_1fr_1fr] sm:items-center">
      <span className="font-mono text-[12px] text-muted">{label}</span>
      <select className="input" value={value.source === "text" ? "__text" : value.key} onChange={(e) => onChange(e.target.value === "__text" ? { source: "text", value: "" } : { source: "field", key: e.target.value as WaFieldKey })}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        <option value="__text">Fixed text…</option>
      </select>
      {value.source === "text" ? <input className="input" placeholder="Same text for everyone" value={value.value} onChange={(e) => onChange({ source: "text", value: e.target.value })} /> : <span />}
    </div>
  );
}

interface CampaignPreview { campaign: string; members: number; eligible: number; willSend: number; skipped: Record<string, number>; mode: string; cap: number; testNumbers: string[]; sample: { name: string; loanId: string; text: string } | null; liveBlocked: string | null }

function CampaignSend({ data, onDone }: { data: View; onDone: (v: View) => void }) {
  const [campaignId, setCampaignId] = useState("");
  const [key, setKey] = useState("");
  const [mapping, setMapping] = useState<WaMapping[]>([]);
  const [headerMapping, setHeaderMapping] = useState<WaMapping[]>([]);
  const [limit, setLimit] = useState(data.mode === "test" ? 5 : 50);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const t = data.templates.find((x) => tplKey(x) === key);
  useEffect(() => { setMapping(t ? guessMapping(t.bodyParams) : []); setHeaderMapping(t ? guessMapping(t.headerParams) : []); setPreview(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPreview(null); setConfirm(false); }, [campaignId, mapping, headerMapping, limit]);

  const payload = () => ({ campaignId, template: t?.name, language: t?.language, mapping, headerMapping, limit });
  async function doPreview() {
    setMsg(null);
    const r = await post("/api/whatsapp", { action: "campaignPreview", ...payload() });
    if (r.ok) setPreview(r.json.preview); else setMsg({ ok: false, text: r.json.error ?? "Couldn't preview." });
  }
  async function doSend() {
    setBusy(true); setMsg(null); setConfirm(false);
    const r = await post("/api/whatsapp", { action: "campaignSend", ...payload() });
    if (r.json.messages) onDone(r.json);
    if (r.ok) {
      const errs = Object.entries(r.json.result.errors as Record<string, number>).map(([k, v]) => `${k} (${v})`).join(", ");
      setMsg({ ok: !r.json.result.failed, text: `Sent ${r.json.result.sent}, failed ${r.json.result.failed}${errs ? `: ${errs}` : ""}. Watch the log for delivery.` });
    } else setMsg({ ok: false, text: r.json.error ?? "Couldn't send." });
    setBusy(false);
  }
  const ready = !!campaignId && !!t && t.status === "APPROVED";

  return (
    <Card title="Send to a campaign" sub={data.mode === "test"
      ? `Test mode: each borrower's message, with their own details, goes to ${data.testNumbers.join(", ") || "the test numbers"}. Capped at 5 per send.`
      : "Live mode: messages go to each borrower's own number, opted-in and undisputed only, inside the calling window."}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-[12px] text-muted">Campaign
            <select className="input mt-1 block w-full" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Choose a campaign…</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.status} · {c.members} borrowers</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-muted">Template<TemplatePicker templates={data.templates} value={key} onChange={setKey} /></label>
          {t && (t.headerParams.length + t.bodyParams.length > 0) && (
            <div className="space-y-2">
              <div className="label">Fill each variable with</div>
              {t.headerParams.map((p, i) => <MappingRow key={`h${p}`} label={`Header {{${p}}}`} value={headerMapping[i] ?? { source: "field", key: "first" }} fields={data.fields} onChange={(m) => setHeaderMapping(headerMapping.map((x, j) => (j === i ? m : x)))} />)}
              {t.bodyParams.map((p, i) => <MappingRow key={`b${p}`} label={`{{${p}}}`} value={mapping[i] ?? { source: "field", key: "first" }} fields={data.fields} onChange={(m) => setMapping(mapping.map((x, j) => (j === i ? m : x)))} />)}
            </div>
          )}
          <label className="block text-[12px] text-muted">Send to at most
            <input type="number" min={1} max={data.mode === "test" ? 5 : 250} className="input mt-1 block w-32" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!ready} onClick={doPreview}>Preview</button>
            {preview && !confirm && <button className="btn btn-primary" disabled={!preview.willSend || !!preview.liveBlocked || busy} onClick={() => setConfirm(true)}><Send size={14} aria-hidden="true" />Send {preview.willSend} message{preview.willSend === 1 ? "" : "s"}</button>}
            {confirm && preview && (
              <span className="flex flex-wrap items-center gap-2 rounded-md bg-warn-soft px-3 py-1.5 text-[12.5px] text-warn">
                Send {preview.willSend} WhatsApp message{preview.willSend === 1 ? "" : "s"}{data.mode === "test" ? " to the test numbers" : " to real borrowers"}?
                <button className="btn btn-primary min-h-8" onClick={doSend}>Yes, send</button>
                <button className="btn btn-ghost min-h-8" onClick={() => setConfirm(false)}>Cancel</button>
              </span>
            )}
            {busy && <span className="text-[12.5px] text-muted">Sending, one every quarter second…</span>}
          </div>
          {msg && <p className={`text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role="status">{msg.text}</p>}
        </div>
        <div className="space-y-3">
          {preview ? (
            <>
              <dl className="divide-y divide-line rounded-md border border-line text-[13px]">
                {[["Borrowers in campaign", preview.members], ["Can be messaged", preview.eligible], ["Will be sent now", preview.willSend],
                  ...Object.entries(preview.skipped).map(([k, v]) => [`Skipped: ${k.toLowerCase()}`, v])].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted">{k}</dt><dd className="font-medium num">{v}</dd></div>
                ))}
              </dl>
              {preview.liveBlocked && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{preview.liveBlocked}</p>}
              {preview.sample && <div><div className="label mb-1">First message, for {preview.sample.name} ({preview.sample.loanId})</div><div className="whitespace-pre-wrap rounded-lg bg-[#e7f4ee] p-3 text-[13px] leading-relaxed">{preview.sample.text}</div></div>}
            </>
          ) : <Preview t={t} body={t ? mapping.map((m) => (m.source === "text" ? m.value : `[${data.fields.find((f) => f.key === m.key)?.label}]`)) : []} header={t ? headerMapping.map((m) => (m.source === "text" ? m.value : `[${data.fields.find((f) => f.key === m.key)?.label}]`)) : []} />}
          {!t && <p className="text-[13px] text-muted">Choose a campaign and an approved template, map the variables, then preview before sending.</p>}
        </div>
      </div>
    </Card>
  );
}

const LANGUAGE_NAMES: Record<string, string> = {
  en_US: "English (US)", en: "English", en_GB: "English (UK)", hi: "Hindi", mr: "Marathi", gu: "Gujarati", ta: "Tamil",
  te: "Telugu", kn: "Kannada", bn: "Bengali", ml: "Malayalam", pa: "Punjabi",
};

function NewTemplate({ data, onDone }: { data: View; onDone: (v: View) => void }) {
  const blank = { name: "", language: "en", category: "UTILITY" as "UTILITY" | "MARKETING", header: "", headerExample: "", body: "", footer: "", urlText: "", url: "" };
  const [f, setF] = useState(blank);
  const [examples, setExamples] = useState<string[]>([]);
  const [replies, setReplies] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const bodyVars = useMemo(() => [...new Set([...f.body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))], [f.body]);
  const headerHasVar = /\{\{\s*1\s*\}\}/.test(f.header);
  const nextVar = bodyVars.filter((v) => /^\d+$/.test(v)).length + 1;

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await post("/api/whatsapp", { action: "createTemplate", ...f, bodyExamples: bodyVars.map((_, i) => examples[i] ?? ""), quickReplies: replies });
    if (r.ok) {
      onDone(r.json);
      setMsg({ ok: true, text: `Submitted "${r.json.created.name}" to Meta: ${String(r.json.created.status).toLowerCase()}. Utility templates are usually reviewed within minutes; use Sync templates to refresh.` });
      setF(blank); setExamples([]); setReplies([]);
    } else setMsg({ ok: false, text: r.json.error ?? "Meta didn't accept the template." });
    setBusy(false);
  }
  const ready = !!f.name && !!f.body.trim() && bodyVars.every((_, i) => examples[i]?.trim()) && (!headerHasVar || !!f.headerExample.trim());
  const fill = (text: string, vals: string[]) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vals[Number(k) - 1] || `{{${k}}}`);

  return (
    <Card title="New template" sub="Submitted to Meta for review. Once approved it shows up in the template pickers above.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_150px_130px]">
            <label className="block text-[12px] text-muted">Name
              <input className="input mt-1 block w-full font-mono" placeholder="emi_reminder_v1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") })} />
            </label>
            <label className="block text-[12px] text-muted">Language
              <select className="input mt-1 block w-full" value={f.language} onChange={set("language")}>
                {data.languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l] ?? l}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-muted">Category
              <select className="input mt-1 block w-full" value={f.category} onChange={set("category")}>
                <option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option>
              </select>
            </label>
          </div>
          <label className="block text-[12px] text-muted">Header (optional, up to 60 characters, one {"{{1}}"} allowed)
            <input className="input mt-1 block w-full" maxLength={60} placeholder="Payment due for {{1}}" value={f.header} onChange={set("header")} />
          </label>
          {headerHasVar && (
            <label className="block text-[12px] text-muted">Sample for header {"{{1}}"}
              <input className="input mt-1 block w-full" value={f.headerExample} onChange={set("headerExample")} />
            </label>
          )}
          <label className="block text-[12px] text-muted">
            <span className="flex items-center justify-between">Body <button type="button" className="text-brand hover:underline" onClick={() => setF({ ...f, body: `${f.body}{{${nextVar}}}` })}>Add variable {`{{${nextVar}}}`}</button></span>
            <textarea className="input mt-1 block w-full" rows={5} maxLength={1024} placeholder={"Hi {{1}}, your EMI of ₹{{2}} for loan {{3}} is due on {{4}}. Pay here to avoid late fees."} value={f.body} onChange={set("body")} />
            <span className="mt-0.5 block text-right text-[11px]">{f.body.length}/1024</span>
          </label>
          {bodyVars.map((v, i) => (
            <label key={v} className="block text-[12px] text-muted">Sample for {`{{${v}}}`}
              <input className="input mt-1 block w-full" value={examples[i] ?? ""} onChange={(e) => { const n = [...examples]; n[i] = e.target.value; setExamples(n); }} />
            </label>
          ))}
          <label className="block text-[12px] text-muted">Footer (optional, no variables)
            <input className="input mt-1 block w-full" maxLength={60} placeholder="Reply STOP to opt out" value={f.footer} onChange={set("footer")} />
          </label>
          <div>
            <div className="flex items-center justify-between text-[12px] text-muted">Quick reply buttons (up to 3)
              {replies.length < 3 && <button type="button" className="text-brand hover:underline" onClick={() => setReplies([...replies, ""])}>Add button</button>}
            </div>
            {replies.map((q, i) => (
              <div key={i} className="mt-1 flex gap-2">
                <input className="input block w-full" maxLength={25} placeholder={["Pay now", "Call me back", "Already paid"][i]} value={q} onChange={(e) => setReplies(replies.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className="btn btn-ghost px-2" aria-label="Remove button" onClick={() => setReplies(replies.filter((_, j) => j !== i))}><X size={13} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
            <label className="block text-[12px] text-muted">Link button label
              <input className="input mt-1 block w-full" maxLength={25} placeholder="Pay EMI" value={f.urlText} onChange={set("urlText")} />
            </label>
            <label className="block text-[12px] text-muted">Link (https://)
              <input className="input mt-1 block w-full" placeholder="https://pay.example.com" value={f.url} onChange={set("url")} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={!ready || busy || !data.configured} onClick={submit}><FilePlus2 size={14} aria-hidden="true" />{busy ? "Submitting…" : "Submit to Meta"}</button>
            {msg && <span className={`text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role="status">{msg.text}</span>}
          </div>
        </div>
        <div>
          <div className="label mb-1">Preview with samples</div>
          <div className="rounded-lg bg-[#e7f4ee] p-3 text-[13px] leading-relaxed text-ink">
            {f.header && <div className="mb-1 font-semibold">{fill(f.header, [f.headerExample])}</div>}
            <div className="whitespace-pre-wrap">{f.body ? fill(f.body, examples) : <span className="text-muted">Your message appears here.</span>}</div>
            {f.footer && <div className="mt-1.5 text-[11.5px] text-muted">{f.footer}</div>}
          </div>
          {(replies.some(Boolean) || f.urlText) && (
            <div className="mt-1 grid gap-1">
              {replies.filter(Boolean).map((q, i) => <div key={i} className="rounded-md bg-[#e7f4ee] py-1.5 text-center text-[12.5px] text-info">{q}</div>)}
              {f.urlText && <div className="rounded-md bg-[#e7f4ee] py-1.5 text-center text-[12.5px] text-info">↗ {f.urlText}</div>}
            </div>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-muted">Meta's rules: name in lowercase with underscores; variables numbered {"{{1}}"}, {"{{2}}"}… in order; the body can't start or end with a variable; a realistic sample for each variable. Payment reminders belong in Utility.</p>
        </div>
      </div>
    </Card>
  );
}

function Templates({ templates }: { templates: WaTemplate[] }) {
  return (
    <Card pad={false} title="Templates on Meta" sub="Only approved templates can start a conversation with someone who hasn't messaged first.">
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead><tr><th>Name</th><th>Language</th><th>Category</th><th>Status</th><th>Text</th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={tplKey(t)}>
                <td className="whitespace-nowrap font-mono text-[12.5px]">{t.name}</td><td>{t.language}</td><td className="text-[12.5px]">{t.category.toLowerCase()}</td>
                <td><span className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${t.status === "APPROVED" ? "bg-good-soft text-good" : t.status === "PENDING" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>{t.status.toLowerCase()}</span>{t.rejectedReason && <div className="text-[11.5px] text-bad">{t.rejectedReason}</div>}</td>
                <td className="max-w-[520px] whitespace-pre-wrap text-[12.5px] text-ink-2">{t.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!templates.length && <Empty title="No templates synced">Use "Sync templates" to pull them from Meta.</Empty>}
      </div>
    </Card>
  );
}

function Log({ messages, openWindows, reload }: { messages: WaMessage[]; openWindows: View["openWindows"]; reload: () => void }) {
  const [filter, setFilter] = useState<"all" | "failed" | "in">("all");
  const rows = useMemo(() => messages.filter((m) => filter === "all" || (filter === "failed" ? m.status === "failed" : m.direction === "in")), [messages, filter]);
  return (
    <Card pad={false} title="Message log" sub={`Sends and replies, with Meta's own status. Updates every few seconds.${openWindows.length ? ` ${openWindows.length} open 24-hour window${openWindows.length === 1 ? "" : "s"}.` : ""}`}
      right={<div className="flex gap-2"><div className="seg" role="group" aria-label="Filter">
        {(["all", "failed", "in"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "failed" ? "Failed" : "Replies"}</button>)}
      </div><button className="btn" onClick={reload} aria-label="Refresh"><RefreshCw size={14} aria-hidden="true" /></button></div>}>
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead><tr><th>Time</th><th /><th>Number</th><th>Borrower</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="align-top">
                <td className="whitespace-nowrap text-[12.5px] num">{when(m.ts)}</td>
                <td>{m.direction === "in" ? <MessageCircle size={14} className="text-brand" aria-label="Reply" /> : <Send size={13} className="text-muted" aria-label="Sent" />}</td>
                <td className="whitespace-nowrap text-[12.5px] num">{m.to}{m.redirectedFrom && <div className="text-[11.5px] text-muted">for {m.redirectedFrom}</div>}</td>
                <td className="whitespace-nowrap text-[12.5px]">{m.loanId ?? "—"}</td>
                <td className="max-w-[460px] text-[12.5px]">{m.template && <div className="font-mono text-[11.5px] text-muted">{m.template} · {m.language}</div>}<div className="line-clamp-3 whitespace-pre-wrap text-ink-2" title={m.text}>{m.text}</div></td>
                <td className="text-[12.5px]">
                  <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[m.status]}`}>{m.status}</span>
                  {m.error && <div className="mt-1 max-w-[280px] text-[11.5px] text-bad">{m.error.code} {m.error.title}{m.error.code && ERROR_HELP[m.error.code] ? <span className="block text-muted">{ERROR_HELP[m.error.code]}</span> : m.error.detail ? <span className="block text-muted">{m.error.detail}</span> : null}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty title="No messages yet">Sends from this page and replies from borrowers appear here.</Empty>}
      </div>
    </Card>
  );
}
