// Owner: Laksh. Mounted on the firm page (contract D). Consent grid of provider x category, preview as the
// provider, what is held back, publish, access codes, replies, opens and the lien.
"use client";

import { useCallback, useEffect, useState } from "react";
import CaseView, { LienHistory } from "@/components/provider/CaseView";
import type { ShareCategory } from "@/lib/contracts";
import { agreedAmount, CATEGORIES, CATEGORY_LABEL, REPLIES, type ProviderShare, type SharePanelData } from "@/lib/portal/types";

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const usd = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "not confirmed");

async function post(url: string, body: object, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
  return j;
}

export default function SharePanel({ matterId }: { matterId: number }) {
  const [data, setData] = useState<SharePanelData | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState<{ nodeId: number; email: string; code: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/share?matterId=${matterId}`);
    if (res.ok) setData(await res.json());
  }, [matterId]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    // Provider replies, opens and lien steps arrive while the attorney has the page open.
    const t = setInterval(load, 10_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setMsg("");
    try { await fn(); if (ok) setMsg(ok); } catch (e) { setMsg((e as Error).message); }
    await load();
  }

  if (!data) return <div className="text-lg">Loading providers ...</div>;
  const current = data.providers.find((p) => p.provider.nodeId === sel) ?? null;

  return (
    <div className="text-lg text-black" id="sec-share">
      <h2 className="mb-1 text-2xl font-bold">Share with providers</h2>
      <p className="mb-3 rounded border-l-4 border-red-700 bg-red-50 p-3 font-semibold">Assume defense counsel will read this. Nothing is shared until you press Publish.</p>
      {data.providers.length === 0 && <p className="text-neutral-600">No treating providers found among this case&rsquo;s contacts.</p>}

      {data.providers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-2 pr-3">Provider</th>
                {CATEGORIES.map((c) => <th key={c} className="px-2 py-2 text-center">{CATEGORY_LABEL[c]}</th>)}
                <th className="px-2 py-2">Login</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.providers.map((p) => (
                <tr key={p.provider.nodeId} className={`border-b border-neutral-200 ${sel === p.provider.nodeId ? "bg-neutral-50" : ""}`}>
                  <td className="py-2 pr-3">
                    <button onClick={() => setSel(sel === p.provider.nodeId ? null : p.provider.nodeId)} className="text-left font-semibold underline">{p.provider.name}</button>
                    <div className="text-sm text-neutral-600">{p.provider.email ?? "no email in Clio"}</div>
                  </td>
                  {CATEGORIES.map((c) => (
                    <td key={c} className="px-2 py-2 text-center">
                      <label className="inline-flex flex-col items-center gap-0.5">
                        <input
                          type="checkbox" className="h-5 w-5" checked={p.consent[c].granted}
                          aria-label={`${CATEGORY_LABEL[c]} for ${p.provider.name}`}
                          onChange={(e) => act(() => post("/api/share/consent", { matterId, providerNodeId: p.provider.nodeId, category: c, granted: e.target.checked }))}
                        />
                        <PublishedMark p={p} c={c} />
                      </label>
                    </td>
                  ))}
                  <td className="px-2 py-2 whitespace-nowrap">
                    {p.code?.active ? <span className="text-green-800">active</span> : p.code ? <span className="text-neutral-600">revoked</span> : <span className="text-neutral-600">none</span>}
                    {p.views.count > 0 && <div className="text-sm text-neutral-600">opened {p.views.count}x, last {when(p.views.last)}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      disabled={!CATEGORIES.some((c) => p.consent[c].granted)}
                      onClick={() => act(() => post("/api/share/publish", { matterId, providerNodeId: p.provider.nodeId }), `Published to ${p.provider.name}.`)}
                      className="rounded bg-black px-3 py-1.5 font-semibold text-white disabled:opacity-40"
                    >Publish</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-sm text-neutral-600">Tick = consent recorded. Under each tick: when it was last published, or &ldquo;changed&rdquo; if the case has moved on since. Coverage is off by default.</p>
        </div>
      )}
      {msg && <p className="mt-2 rounded bg-neutral-100 p-2">{msg}</p>}

      {current && (
        <Detail
          key={current.provider.nodeId} p={current} matterId={matterId}
          code={code?.nodeId === current.provider.nodeId ? code : null}
          onCode={async () => act(async () => setCode({ nodeId: current.provider.nodeId, ...(await post("/api/share/code", { matterId, providerNodeId: current.provider.nodeId })) }))}
          onRevoke={() => act(() => post("/api/share/code", { matterId, providerNodeId: current.provider.nodeId }, "DELETE"), "Access revoked.").then(() => setCode(null))}
          onLien={(action, amount) => act(() => post("/api/share/lien", { matterId, providerNodeId: current.provider.nodeId, action, amount }))}
        />
      )}

      {data.outbox.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">Outbox: emails that would be sent ({data.outbox.length})</summary>
          <ul className="mt-2 text-base">
            {data.outbox.map((o, i) => <li key={i}>{when(o.at)} to {o.recipient}: {o.subject}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function PublishedMark({ p, c }: { p: ProviderShare; c: ShareCategory }) {
  const pub = p.published[c];
  if (!pub) return null;
  return <span className={`text-xs ${pub.stale ? "font-semibold text-orange-700" : "text-neutral-500"}`}>{pub.stale ? "changed" : when(pub.at)}</span>;
}

function Detail({ p, matterId, code, onCode, onRevoke, onLien }: {
  p: ProviderShare; matterId: number; code: { email: string; code: string } | null;
  onCode: () => void; onRevoke: () => void; onLien: (action: "request_reduction" | "accept_counter", amount: string | null) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [amount, setAmount] = useState("");
  return (
    <div className="mt-4 space-y-4 rounded-lg border border-neutral-300 p-4" data-matter={matterId}>
      <h3 className="text-xl font-bold">{p.provider.name}</h3>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onCode} disabled={!p.provider.email} className="rounded border border-black px-3 py-1.5 font-semibold disabled:opacity-40">
          {p.code?.active ? "Issue a new access code" : "Generate access code"}
        </button>
        {p.code?.active && <button onClick={onRevoke} className="rounded border border-red-700 px-3 py-1.5 font-semibold text-red-700">Revoke access</button>}
        {code && <span className="rounded bg-yellow-100 px-3 py-1.5">Give them: <b>{code.email}</b> and code <b className="font-mono">{code.code}</b> (shown once)</span>}
      </div>

      <div>
        <h4 className="font-semibold">Held back</h4>
        {p.heldBack.length === 0
          ? <p className="text-neutral-600">Nothing: every category has consent.</p>
          : <ul className="list-disc pl-6">{p.heldBack.map((h) => <li key={h.category}>{h.label} ({h.items} item{h.items === 1 ? "" : "s"}): {h.reason}</li>)}</ul>}
      </div>

      <div>
        <button onClick={() => setPreview(!preview)} className="rounded border border-black px-3 py-1.5 font-semibold">{preview ? "Hide preview" : "Preview as this provider"}</button>
        {preview && <div className="mt-3 rounded-lg bg-neutral-100 p-3"><CaseView data={p.preview} preview /></div>}
      </div>

      <div>
        <h4 className="font-semibold">Their answers</h4>
        {p.replies.length === 0 ? <p className="text-neutral-600">No replies yet.</p> : (
          <ul className="text-base">
            {p.replies.map((r, i) => <li key={i}>{when(r.at)}: <b>{REPLIES[r.reply]}{r.replyDate ? ` ${r.replyDate}` : ""}</b>{r.note ? ` (${r.note})` : ""}</li>)}
          </ul>
        )}
      </div>

      <div>
        <h4 className="font-semibold">Lien</h4>
        {!p.lien ? <p className="text-neutral-600">The provider has not confirmed a balance.</p> : (
          <>
            <p>Balance {usd(p.lien.balance)} · {p.lien.status.replace(/_/g, " ")}{agreedAmount(p.lien) !== null ? ` at ${usd(agreedAmount(p.lien))}` : ""}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {(p.lien.status === "balance_confirmed" || p.lien.status === "countered") && <>
                <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="w-40 rounded border border-neutral-400 px-2 py-1" />
                <button onClick={() => onLien("request_reduction", amount)} className="rounded bg-black px-3 py-1.5 font-semibold text-white">Ask for a reduction to this</button>
              </>}
              {p.lien.status === "countered" && <button onClick={() => onLien("accept_counter", null)} className="rounded border border-black px-3 py-1.5 font-semibold">Accept their counter</button>}
            </div>
            <LienHistory lien={p.lien} />
          </>
        )}
      </div>
    </div>
  );
}
