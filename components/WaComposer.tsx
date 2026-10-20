"use client";
import { useEffect, useMemo, useState } from "react";
import { FileUp, Send, Users } from "lucide-react";
import { post } from "@/components/useApi";
import { Card } from "@/components/ui";
import type { WaTemplate } from "@/lib/types";
import { WA_FIELDS, guessMapping, type WaFieldKey } from "@/lib/waFields";
import { checkParam, contextFormat, doubledCurrency, formatValue, guessFormat, hasCurrencyBefore, parseTable, type ParsedTable, type ValueFormat } from "@/lib/waValues";

type Source = "numbers" | "list" | "campaign";
interface PreparedRow { key: string; kind: "phone" | "borrower"; phone: string; name?: string; loanId?: string; fields?: Record<string, string>; blocked?: string; invalid?: string }
interface Prepared { rows: PreparedRow[]; mode: string; testNumbers: string[]; usage: { used: number; limit: number | null; freesAt: string } }
type ColMode = "same" | "list" | "field" | "each";
interface Col { param: string; header: boolean; mode: ColMode; value: string; listCol: number; field: WaFieldKey; format: ValueFormat }

export interface ComposerData {
  configured: boolean; mode: string; templates: WaTemplate[]; recipients: { phone: string; name?: string }[];
  campaigns: { id: string; name: string; status: string; members: number }[]; openWindows: { to: string; until: string }[];
}

const tplKey = (t: WaTemplate) => `${t.name}|${t.language}`;
const FIELD_FORMAT: Partial<Record<WaFieldKey, ValueFormat>> = { emi: "amount", outstanding: "amount", dueDate: "date", today: "date" };
const PAGE = 25;
const memoKey = (t: WaTemplate) => `kollect.wa.cols.${t.name}.${t.language}`;

export default function WaComposer({ data, canCampaign, onDone }: { data: ComposerData; canCampaign: boolean; onDone: (view: unknown) => void }) {
  const [source, setSource] = useState<Source>("numbers");
  const [picked, setPicked] = useState<string[]>([]);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [pasted, setPasted] = useState("");
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [key, setKey] = useState("");
  const [cols, setCols] = useState<Col[]>([]);
  const [overrides, setOverrides] = useState<Record<number, Record<number, string>>>({});
  const [page, setPage] = useState(0);
  const [showProblemsOnly, setShowProblemsOnly] = useState(false);
  const [previewRow, setPreviewRow] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [busy, setBusy] = useState("");
  const t = data.templates.find((x) => tplKey(x) === key);

  // Who this goes to, as phone numbers (numbers / list) — campaigns are resolved on the server.
  const phones = useMemo(() => {
    if (source === "numbers") return [...new Set(picked)];
    if (source === "list" && table && table.phoneCol >= 0) return table.rows.map((r) => r[table.phoneCol]);
    return [];
  }, [source, picked, table]);

  // Typing a number and a name adds that person to this send and saves them for next time.
  async function addNumber() {
    const digits = newPhone.replace(/\D/g, "");
    if (digits.length < 10) return;
    const x = await post("/api/whatsapp", { action: "saveRecipient", phone: newPhone, name: newName });
    if (!x.ok) { setMsg({ ok: false, text: x.json.error ?? "That doesn't look like a phone number." }); return; }
    onDone(x.json);
    const saved = (x.json.recipients as { phone: string }[]).find((r) => r.phone.slice(-10) === digits.slice(-10));
    if (saved) setPicked((p) => [...new Set([...p, saved.phone])]);
    setNewPhone(""); setNewName(""); setMsg(null);
  }

  useEffect(() => { setPrep(null); setOverrides({}); setPage(0); setConfirm(false); }, [source, phones.join("|"), campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setBusy("load"); setMsg(null);
    const r = await post("/api/whatsapp", source === "campaign" ? { action: "prepare", source, campaignId } : { action: "prepare", source, phones });
    if (r.ok) setPrep(r.json); else setMsg({ ok: false, text: r.json.error ?? "Couldn't load the recipients." });
    setBusy("");
  }

  // Set up how each variable is filled when the template or the recipients change. Remembers the last setup per template.
  useEffect(() => {
    if (!t) { setCols([]); return; }
    const params = [...t.headerParams.map((p) => ({ p, header: true })), ...t.bodyParams.map((p) => ({ p, header: false }))];
    const guess = guessMapping(params.map((x) => x.p));
    let saved: Partial<Col>[] = [];
    try { saved = JSON.parse(localStorage.getItem(memoKey(t)) ?? "[]"); } catch { /* none saved */ }
    // Columns after the phone line up with {{1}}, {{2}}, {{3}}… in order, so a sheet laid out like the template maps itself.
    const listCols = table ? table.headers.map((_, i) => i).filter((i) => i !== table.phoneCol) : [];
    setCols(params.map(({ p, header }, i) => {
      const s = saved[i] ?? {};
      const field = (s.field as WaFieldKey) ?? (guess[i].source === "field" ? guess[i].key : "first");
      const byName = table ? table.headers.findIndex((h) => h.trim().toLowerCase().replace(/\W+/g, "_") === p.toLowerCase()) : -1;
      const listCol = byName >= 0 ? byName : listCols[i] ?? -1;
      const mode: ColMode = source === "campaign" ? (s.mode === "same" ? "same" : "field") : source === "list" && listCol >= 0 ? "list" : (s.mode === "each" ? "each" : "same");
      // List columns are re-read every time; only typed values and borrower-field choices are remembered per template.
      let fmt = mode === "list" && table ? guessFormat(table.headers[listCol] ?? "", table.rows.map((r) => r[listCol] ?? ""))
        : s.format ?? (mode === "field" ? FIELD_FORMAT[field] ?? "text" : guessFormat(p));
      // No column name to go on (plain pasted lines, or a typed value): use the template's wording around the variable.
      if (fmt === "text" && mode !== "field") fmt = contextFormat(header ? t.header : t.body, p) ?? "text";
      // The template already prints ₹ before this variable: send the number alone so the message never shows ₹₹.
      if (hasCurrencyBefore(header ? t.header : t.body, p) && fmt === "amount") fmt = "number";
      return { param: p, header, mode, value: s.value ?? "", listCol, field, format: fmt };
    }));
    setOverrides({});
  }, [key, source, table, prep]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (t && cols.length) try { localStorage.setItem(memoKey(t), JSON.stringify(cols.map(({ mode, value, field, format }) => ({ mode, value, field, format })))); } catch { /* storage blocked */ } }, [cols, t]);

  // Every person's values, formatted and checked. This is exactly what gets sent.
  const rows = useMemo(() => (prep?.rows ?? []).map((r, ri) => {
    const values = cols.map((c, ci) => {
      const o = overrides[ri]?.[ci];
      const base = o ?? (c.mode === "same" ? c.value : c.mode === "list" ? (table && c.listCol >= 0 ? table.rows[ri]?.[c.listCol] ?? "" : "") : c.mode === "field" ? r.fields?.[c.field] ?? "" : "");
      const f = formatValue(base, c.format);
      const err = f.error ?? checkParam(f.value);
      return { raw: base, value: f.value, error: c.mode === "field" && !r.fields && !o ? "No borrower details for this number" : err, overridden: o !== undefined };
    });
    const fill = (text: string | undefined, names: string[], vals: string[]) => (text ?? "").replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => vals[names.indexOf(k)] ?? "");
    const full = t ? `${fill(t.header, t.headerParams, values.filter((_, i) => cols[i].header).map((v) => v.value))}\n${fill(t.body, t.bodyParams, values.filter((_, i) => !cols[i].header).map((v) => v.value))}` : "";
    const problem = r.invalid ?? (values.find((v) => v.error) ? `{{${cols[values.findIndex((v) => v.error)].param}}}: ${values.find((v) => v.error)!.error}` : undefined)
      ?? (doubledCurrency(full) ? "The currency symbol would show twice; set that variable to Number" : undefined)
      ?? (full.length > 1024 ? "The message would be over 1,024 characters" : undefined);
    const name = r.name ?? (source === "list" && table && table.nameCol >= 0 ? table.rows[ri]?.[table.nameCol] : undefined) ?? data.recipients.find((x) => `+${x.phone}` === r.phone)?.name;
    return { ...r, name, values, problem, ready: !problem && !r.blocked };
  }), [prep, cols, overrides, table, source, data.recipients, t]);

  const ready = rows.filter((r) => r.ready), problems = rows.filter((r) => r.problem), blocked = rows.filter((r) => !r.problem && r.blocked);
  const shown = (showProblemsOnly ? rows.filter((r) => r.problem || r.blocked) : rows);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const remaining = prep?.usage.limit == null ? null : Math.max(0, prep.usage.limit - prep.usage.used);
  const rendered = (ri: number) => {
    const r = rows[ri];
    if (!t || !r) return "";
    const hv = r.values.filter((_, i) => cols[i].header).map((v) => v.value), bv = r.values.filter((_, i) => !cols[i].header).map((v) => v.value);
    const fill = (text: string | undefined, names: string[], vals: string[]) => (text ?? "").replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => vals[names.indexOf(k)] || `{{${k}}}`);
    return [t.header ? fill(t.header, t.headerParams, hv) : "", fill(t.body, t.bodyParams, bv)].filter(Boolean).join("\n\n");
  };

  async function start() {
    if (!t) return;
    setBusy("send"); setMsg(null); setConfirm(false);
    const out = ready.map((r) => ({
      key: r.key, kind: r.kind, label: r.name,
      header: r.values.filter((_, i) => cols[i].header).map((v) => v.value), body: r.values.filter((_, i) => !cols[i].header).map((v) => v.value),
    }));
    const res = await post("/api/whatsapp", { action: "startJob", template: t.name, language: t.language, source, campaignId: source === "campaign" ? campaignId : undefined, rows: out });
    if (res.ok) { onDone(res.json); setMsg({ ok: true, text: `Started: ${out.length} message${out.length === 1 ? "" : "s"} queued. Progress shows under Sends below.` }); setPrep(null); }
    else setMsg({ ok: false, text: res.json.error ?? "Couldn't start the send.", list: res.json.problems });
    setBusy("");
  }

  async function readFile(f: File) {
    if (/\.xlsx?$/i.test(f.name)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t", blankrows: false, rawNumbers: false });
      setPasted(csv); setTable(parseTable(csv));
    } else { const txt = await f.text(); setPasted(txt); setTable(parseTable(txt)); }
  }

  const loadable = source === "campaign" ? !!campaignId : source === "list" ? !!table && table.phoneCol >= 0 && table.rows.length > 0 : phones.length > 0;
  const setCol = (i: number, patch: Partial<Col>) => setCols(cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Card title="Send a template" sub="One person or a whole campaign: each person gets their own values from the list, their borrower record, or what you type.">
      <div className="space-y-4">
        {/* 1. Who */}
        <div>
          <div className="label mb-1.5">1 · Who gets it</div>
          <div className="seg" role="group" aria-label="Send to">
            <button type="button" aria-pressed={source === "numbers"} onClick={() => setSource("numbers")}>Numbers</button>
            <button type="button" aria-pressed={source === "list"} onClick={() => setSource("list")}>Paste a list</button>
            {canCampaign && <button type="button" aria-pressed={source === "campaign"} onClick={() => setSource("campaign")}>A campaign</button>}
          </div>
          <div className="mt-2">
            {source === "numbers" && (
              <div className="space-y-2">
                {data.recipients.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {data.recipients.map((r) => {
                      const on = picked.includes(r.phone);
                      return (
                        <span key={r.phone} className={`inline-flex items-center rounded-full border text-[12px] ${on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line text-ink-2"}`}>
                          <button type="button" aria-pressed={on} className="py-1 pl-2.5 pr-1" onClick={() => setPicked(on ? picked.filter((x) => x !== r.phone) : [...picked, r.phone])} title={`+${r.phone}`}>{r.name || `+${r.phone}`}</button>
                          <button type="button" className="px-1.5 py-1 text-muted hover:text-bad" aria-label={`Remove ${r.name ?? r.phone} from saved numbers`} onClick={async () => { const x = await post("/api/whatsapp", { action: "removeRecipient", phone: r.phone }); if (x.ok) { onDone(x.json); setPicked(picked.filter((p) => p !== r.phone)); } }}>×</button>
                        </span>
                      );
                    })}
                    {data.recipients.length > 1 && <button type="button" className="text-[12px] text-brand hover:underline" onClick={() => setPicked(picked.length === data.recipients.length ? [] : data.recipients.map((r) => r.phone))}>{picked.length === data.recipients.length ? "Clear" : "Select all"}</button>}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <input className="input" inputMode="tel" placeholder="Number, e.g. 98765 43210" value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNumber(); } }} aria-label="Number" />
                  <input className="input" placeholder="Name (press Enter to add)" value={newName} onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNumber(); } }} onBlur={() => { if (newPhone.replace(/\D/g, "").length >= 10) addNumber(); }} aria-label="Name" />
                </div>
                <p className="text-[12px] text-muted">{phones.length ? `${phones.length} selected. ` : ""}A number you add is saved and ticked for this send. Tap a saved name to add or remove it.</p>
              </div>
            )}
            {source === "list" && (
              <div className="space-y-2">
                <p className="text-[12px] text-muted">One person per line: the number, then the template&apos;s values in order ({"{{1}}"}, {"{{2}}"}…), separated by commas. Paste it from anywhere: a note, a chat, Excel.</p>
                <textarea className="input block w-full text-[13px]" rows={5} placeholder={"9876543210, Harshal, 21/10/2026, RBI, 20000\n9123456780, Priya, 25/10/2026, HDFC, 8500"}
                  value={pasted} onChange={(e) => { setPasted(e.target.value); setTable(e.target.value.trim() ? parseTable(e.target.value) : null); }} aria-label="Pasted list" />
                <div className="flex flex-wrap items-center gap-3 text-[12px]">
                  {table && <span className={table.errors.length ? "text-bad" : "text-muted"}>{table.errors.length ? table.errors.join(" ") : `${table.rows.length} ${table.rows.length === 1 ? "person" : "people"} · ${table.headers.length - 1} value${table.headers.length === 2 ? "" : "s"} each`}</span>}
                  <label className="cursor-pointer text-brand hover:underline"><FileUp size={12} className="mr-1 inline" aria-hidden="true" />or upload a CSV / Excel file
                    <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
                  </label>
                </div>
              </div>
            )}
            {source === "campaign" && (
              <select className="input block w-full" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
                <option value="">Choose a campaign…</option>
                {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.status} · {c.members} borrowers</option>)}
              </select>
            )}
          </div>
          <button className="btn mt-2" disabled={!loadable || busy === "load" || !data.configured} onClick={load}><Users size={14} aria-hidden="true" />{busy === "load" ? "Loading…" : prep ? "Reload recipients" : "Load recipients"}</button>
          {prep && <span className="ml-2 text-[12.5px] text-muted">{prep.rows.length} recipient{prep.rows.length === 1 ? "" : "s"} loaded.</span>}
        </div>

        {/* 2. Template */}
        <div>
          <div className="label mb-1.5">2 · Template</div>
          <select className="input block w-full" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Template">
            <option value="">Choose an approved template…</option>
            {data.templates.map((x) => <option key={tplKey(x)} value={tplKey(x)} disabled={x.status !== "APPROVED"}>{x.name} · {x.language}{x.status !== "APPROVED" ? ` (${x.status.toLowerCase()})` : ""}</option>)}
          </select>
          {t && <p className="mt-1 whitespace-pre-wrap rounded-md bg-sunk/60 px-3 py-2 text-[12.5px] text-ink-2">{t.header ? `${t.header}\n\n` : ""}{t.body}</p>}
        </div>

        {/* 3. Fill each variable */}
        {t && cols.length > 0 && (
          <div>
            <div className="label mb-1.5">3 · Fill each variable</div>
            <div className="space-y-2">
              {cols.map((c, i) => (
                <div key={`${c.header}-${c.param}`} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[90px_170px_1fr_120px] sm:items-center">
                  <span className="font-mono text-[12px] text-muted">{c.header ? "Header " : ""}{`{{${c.param}}}`}</span>
                  <select className="input" value={c.mode} onChange={(e) => setCol(i, { mode: e.target.value as ColMode })} aria-label={`How to fill {{${c.param}}}`}>
                    <option value="same">Same for everyone</option>
                    {source === "list" && table && <option value="list">From the list</option>}
                    <option value="field">From borrower details</option>
                    <option value="each">Type per person</option>
                  </select>
                  {c.mode === "same" ? <input className="input" placeholder="Value for everyone" value={c.value} onChange={(e) => setCol(i, { value: e.target.value })} aria-label={`Value for {{${c.param}}}`} />
                    : c.mode === "list" && table ? (
                      <select className="input" value={c.listCol} onChange={(e) => { const lc = Number(e.target.value); setCol(i, { listCol: lc, format: guessFormat(table.headers[lc] ?? "", table.rows.map((r) => r[lc])) }); }} aria-label={`List column for {{${c.param}}}`}>
                        <option value={-1}>Choose a column…</option>
                        {table.headers.map((h, hi) => hi !== table.phoneCol && <option key={hi} value={hi}>{h}</option>)}
                      </select>
                    ) : c.mode === "field" ? (
                      <select className="input" value={c.field} onChange={(e) => { const f = e.target.value as WaFieldKey; setCol(i, { field: f, format: FIELD_FORMAT[f] ?? "text" }); }} aria-label={`Borrower field for {{${c.param}}}`}>
                        {WA_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    ) : <span className="text-[12px] text-muted">Type it in each person&apos;s row below.</span>}
                  <select className="input" value={c.format} onChange={(e) => setCol(i, { format: e.target.value as ValueFormat })} aria-label={`Format of {{${c.param}}}`}>
                    <option value="text">Text</option><option value="date">Date</option><option value="amount">Amount (₹20,000)</option><option value="number">Number (20,000)</option>
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-muted">Dates like 21/10/2026, 2026-10-21 or 21 Oct become “21 Oct 2026”. Amounts like 20000 or Rs 20,000 become “₹20,000”. Any single cell can be changed in the table.</p>
          </div>
        )}

        {/* 4. Check everyone */}
        {t && prep && rows.length > 0 && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="label">4 · Check every message</div>
              <div className="flex items-center gap-3 text-[12px]">
                <span className="text-good">{ready.length} ready</span>
                {problems.length > 0 && <span className="text-bad">{problems.length} need fixing</span>}
                {blocked.length > 0 && <span className="text-muted">{blocked.length} can&apos;t be messaged</span>}
                {(problems.length > 0 || blocked.length > 0) && <label className="flex items-center gap-1"><input type="checkbox" checked={showProblemsOnly} onChange={(e) => { setShowProblemsOnly(e.target.checked); setPage(0); }} />Only show these</label>}
              </div>
            </div>
            <div className="mt-1.5 overflow-x-auto rounded-md border border-line">
              <table className="table w-full">
                <thead><tr><th>#</th><th>To</th>{cols.map((c) => <th key={`${c.header}${c.param}`} className="font-mono">{`{{${c.param}}}`}</th>)}<th>Check</th></tr></thead>
                <tbody>
                  {shown.slice(page * PAGE, page * PAGE + PAGE).map((r) => {
                    const ri = rows.indexOf(r);
                    return (
                      <tr key={`${r.key}-${ri}`} className={`align-top ${previewRow === ri ? "bg-brand-soft/40" : ""}`} onClick={() => setPreviewRow(ri)}>
                        <td className="text-[12px] text-muted num">{ri + 1}</td>
                        <td className="whitespace-nowrap text-[12.5px]">{r.name && <div className="font-medium">{r.name}</div>}<div className={r.name ? "text-[11.5px] text-muted num" : "num"}>{r.phone}{r.loanId ? ` · ${r.loanId}` : ""}</div></td>
                        {r.values.map((v, ci) => (
                          <td key={ci} className="min-w-[130px]">
                            <input className={`input h-8 w-full text-[12.5px] ${v.error ? "border-bad/60 bg-bad-soft/40" : v.overridden ? "border-info/50" : ""}`} value={overrides[ri]?.[ci] ?? v.raw}
                              placeholder={cols[ci].mode === "each" ? "Type value" : ""} aria-label={`{{${cols[ci].param}}} for row ${ri + 1}`}
                              onChange={(e) => setOverrides({ ...overrides, [ri]: { ...(overrides[ri] ?? {}), [ci]: e.target.value } })} />
                            {!v.error && v.value !== v.raw.trim() && <div className="mt-0.5 text-[11px] text-muted">→ {v.value}</div>}
                          </td>
                        ))}
                        <td className="text-[12px]">{r.problem ? <span className="text-bad">{r.problem}</span> : r.blocked ? <span className="text-muted">Skipped: {r.blocked}</span> : <span className="text-good">Ready</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="mt-1.5 flex items-center justify-end gap-2 text-[12.5px] text-muted">
                <button className="btn min-h-7" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="num">{page + 1} / {pages}</span>
                <button className="btn min-h-7" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
            <div className="mt-3">
              <div className="label mb-1">Message for row {previewRow + 1}{rows[previewRow]?.name ? ` · ${rows[previewRow].name}` : ""}</div>
              <div className="whitespace-pre-wrap rounded-lg bg-[#e7f4ee] p-3 text-[13px] leading-relaxed">{rendered(previewRow)}</div>
            </div>
          </div>
        )}

        {/* 5. Send */}
        {t && prep && rows.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-[12.5px] text-muted">
              {prep.mode === "test" ? `Test mode: borrower messages go to ${prep.testNumbers.join(", ") || "the test numbers"} (at most 5). ` : ""}
              {remaining !== null ? `Meta's daily limit: ${remaining} new conversation${remaining === 1 ? "" : "s"} left of ${prep.usage.limit}. ` : ""}
              {remaining !== null && ready.length > remaining ? `The first ${remaining} go today; the rest wait and send on their own as the limit frees up.` : ready.length > 1 ? `About ${Math.max(1, Math.ceil(ready.length / 5 / 60))} min to send ${ready.length}. You can leave this page; it carries on.` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {confirm ? (
                <span className="flex flex-wrap items-center gap-2 rounded-md bg-warn-soft px-3 py-1.5 text-[12.5px] text-warn">
                  Send {t.name} to {ready.length} {ready.length === 1 ? "person" : "people"}{problems.length ? ` (the ${problems.length} with problems are left out)` : ""}?
                  <button className="btn btn-primary min-h-8" onClick={start}>Yes, send</button>
                  <button className="btn btn-ghost min-h-8" onClick={() => setConfirm(false)}>Cancel</button>
                </span>
              ) : (
                <button className="btn btn-primary" disabled={!ready.length || busy === "send"} onClick={() => setConfirm(true)}>
                  <Send size={14} aria-hidden="true" />{busy === "send" ? "Starting…" : `Send to ${ready.length}`}
                </button>
              )}
            </div>
          </div>
        )}
        {msg && (
          <div className={`text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role="status">
            {msg.text}
            {msg.list && <ul className="mt-1 list-disc pl-5">{msg.list.map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
        )}
      </div>
    </Card>
  );
}
