// Owner: Laksh. One case as a provider sees it. Used by the provider's case page and by the firm's
// "preview as provider" (with `preview` set, nothing can be clicked).
"use client";

import { useState } from "react";
import { agreedAmount, REPLIES, type Lien, type ProviderCase, type ReplyKind, type ReplyRow, type SharedItem } from "@/lib/portal/types";

const usd = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "amount not stated");
const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

type Req = { id: string; what: string; asks?: number; firstAsked?: string; lastAsked?: string };

export default function CaseView({ data, preview = false, onChange }: { data: ProviderCase; preview?: boolean; onChange?: () => void }) {
  const byCat = Object.fromEntries(data.items.map((i) => [i.category, i])) as Partial<Record<SharedItem["category"], SharedItem>>;
  const order: SharedItem["category"][] = ["stage", "requests", "own_bills", "coverage", "other_treaters"];
  const shown = order.filter((c) => byCat[c]);
  return (
    <div className="space-y-4 text-lg text-black">
      {shown.length === 0 && <p className="text-neutral-600">Nothing has been shared yet.</p>}
      {shown.map((c) => {
        const item = byCat[c]!;
        return (
          <section key={c} className="rounded-lg border border-neutral-300 bg-white p-4">
            <h3 className="mb-2 flex items-center gap-3 text-xl font-bold">
              {item.label}
              {item.isNew && <span className="rounded bg-yellow-200 px-2 text-sm font-semibold">new since your last visit</span>}
              <span className="ml-auto text-sm font-normal text-neutral-500">{preview ? "would be shared now" : `shared ${day(item.publishedAt)}`}</span>
            </h3>
            {c === "stage" && <Stage payload={item.payload} />}
            {c === "requests" && <Requests item={item} matterId={data.matterId} replies={data.replies} preview={preview} onChange={onChange} />}
            {c === "own_bills" && <Bills payload={item.payload} />}
            {c === "coverage" && <Coverage payload={item.payload} />}
            {c === "other_treaters" && <Treaters payload={item.payload} />}
          </section>
        );
      })}
      {!preview && <LienBox matterId={data.matterId} lien={data.lien} onChange={onChange} />}
    </div>
  );
}

function Stage({ payload }: { payload: unknown }) {
  const p = (payload ?? {}) as { stage?: string | null; status?: string | null };
  return <p><b>{p.status ?? "Status not set"}</b> · stage: {p.stage ?? "not set"}</p>;
}

function Bills({ payload }: { payload: unknown }) {
  const rows = Array.isArray(payload) ? (payload as { description?: string | null; amount?: number }[]) : [];
  if (!rows.length) return <p className="text-neutral-600">The firm&rsquo;s file has no bills from you yet.</p>;
  return (
    <table className="w-full"><tbody>
      {rows.map((r, i) => <tr key={i} className="border-b border-neutral-200"><td className="py-1">{r.description ?? "Charge"}</td><td className="py-1 text-right tabular-nums">{usd(r.amount)}</td></tr>)}
    </tbody></table>
  );
}

function Coverage({ payload }: { payload: unknown }) {
  const rows = (Array.isArray(payload) ? payload : payload ? [payload] : []) as { amount?: number; limit?: number; basis?: string }[];
  if (!rows.length) return <p className="text-neutral-600">No coverage figure in the file.</p>;
  return <ul className="list-disc pl-6">{rows.map((r, i) => <li key={i}>{usd(r.amount ?? r.limit)}{r.basis ? `, per ${r.basis}` : ""}</li>)}</ul>;
}

function Treaters({ payload }: { payload: unknown }) {
  const rows = Array.isArray(payload) ? (payload as { role?: string | null }[]) : [];
  if (!rows.length) return <p className="text-neutral-600">No other treating providers on file.</p>;
  return <ul className="list-disc pl-6">{rows.map((r, i) => <li key={i}>{r.role ?? "Treating provider"}</li>)}</ul>;
}

function Requests({ item, matterId, replies, preview, onChange }: { item: SharedItem; matterId: number; replies: ReplyRow[]; preview: boolean; onChange?: () => void }) {
  const reqs = Array.isArray(item.payload) ? (item.payload as Req[]) : [];
  if (!reqs.length) return <p className="text-neutral-600">The firm has no open requests for you.</p>;
  return (
    <ul className="space-y-4">
      {reqs.map((r) => <RequestRow key={r.id} r={r} matterId={matterId} last={replies.find((x) => x.requestId === r.id) ?? null} preview={preview} onChange={onChange} />)}
    </ul>
  );
}

function RequestRow({ r, matterId, last, preview, onChange }: { r: Req; matterId: number; last: ReplyRow | null; preview: boolean; onChange?: () => void }) {
  const [date, setDate] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(reply: ReplyKind) {
    setErr("");
    if (reply === "sending_by" && !date) { setErr("Pick the date you will send by."); return; }
    setBusy(true);
    const res = await fetch("/api/provider/reply", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matterId, requestId: r.id, reply, replyDate: reply === "sending_by" ? date : null }),
    });
    setBusy(false);
    if (!res.ok) setErr((await res.json()).error ?? "Could not send"); else onChange?.();
  }
  return (
    <li className="border-b border-neutral-200 pb-3">
      <p className="font-semibold">{r.what}</p>
      <p className="text-base text-neutral-700">
        {r.asks ? `Asked ${r.asks === 1 ? "once" : `${r.asks} times`}` : "Requested"}
        {r.firstAsked ? `, first on ${day(r.firstAsked)}` : ""}{r.lastAsked && r.lastAsked !== r.firstAsked ? `, last on ${day(r.lastAsked)}` : ""}
      </p>
      {last && (
        <p className="mt-1 rounded bg-green-50 px-2 py-1 text-base">
          Your answer: <b>{REPLIES[last.reply]}{last.replyDate ? ` ${day(last.replyDate)}` : ""}</b> ({day(last.at)})
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1">
          <button disabled={preview || busy} onClick={() => send("sending_by")} className="rounded bg-black px-3 py-1.5 font-semibold text-white disabled:opacity-50">{REPLIES.sending_by}</button>
          <input type="date" aria-label="Send by date" disabled={preview} value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-neutral-400 px-2 py-1" />
        </span>
        {(["waiting_on_patient", "balance_holding", "not_proceeding"] as const).map((k) => (
          <button key={k} disabled={preview || busy} onClick={() => send(k)} className="rounded border border-black px-3 py-1.5 font-semibold disabled:opacity-50">{REPLIES[k]}</button>
        ))}
      </div>
      {err && <p className="mt-1 text-red-700">{err}</p>}
    </li>
  );
}

const STATUS: Record<Lien["status"], string> = {
  open: "Open", balance_confirmed: "Balance confirmed", reduction_requested: "The firm asked for a reduction",
  accepted: "Agreed", countered: "You countered; waiting on the firm",
};

/** Exported for the firm's share panel too: the same history, different buttons. */
export function LienHistory({ lien }: { lien: Lien }) {
  return (
    <ol className="mt-2 space-y-0.5 text-base text-neutral-700">
      {lien.history.map((h, i) => (
        <li key={i}>{day(h.at)}: {h.by === "firm" ? "Firm" : "Provider"} {h.action.replace(/_/g, " ")}{h.amount !== null ? ` ${usd(h.amount)}` : ""}{h.note ? ` (${h.note})` : ""}</li>
      ))}
    </ol>
  );
}

function LienBox({ matterId, lien, onChange }: { matterId: number; lien: Lien | null; onChange?: () => void }) {
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");
  async function step(action: "confirm" | "accept" | "counter") {
    setErr("");
    const res = await fetch("/api/provider/lien", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matterId, action, amount: action === "accept" ? null : amount }),
    });
    if (!res.ok) setErr((await res.json()).error ?? "Could not save"); else { setAmount(""); onChange?.(); }
  }
  return (
    <section className="rounded-lg border border-neutral-300 bg-white p-4">
      <h3 className="mb-2 text-xl font-bold">Your balance and lien</h3>
      {lien ? <p><b>{usd(lien.balance)}</b> · {STATUS[lien.status]}{agreedAmount(lien) !== null ? ` at ${usd(agreedAmount(lien))}` : ""}</p> : <p className="text-neutral-600">You have not confirmed a balance on this case.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="w-40 rounded border border-neutral-400 px-2 py-1" />
        <button onClick={() => step("confirm")} className="rounded bg-black px-3 py-1.5 font-semibold text-white">Confirm unpaid balance</button>
        {lien?.status === "reduction_requested" && <>
          <button onClick={() => step("accept")} className="rounded border border-black px-3 py-1.5 font-semibold">Accept the firm&rsquo;s request</button>
          <button onClick={() => step("counter")} className="rounded border border-black px-3 py-1.5 font-semibold">Counter with this amount</button>
        </>}
      </div>
      {err && <p className="mt-1 text-red-700">{err}</p>}
      {lien && <LienHistory lien={lien} />}
    </section>
  );
}
