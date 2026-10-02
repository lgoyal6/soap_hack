// Owner: Tijil. The one-page brief. Every line carries its sources; clicking one opens the record
// with the quoted words highlighted. Large type, no tabs, words on every control.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SharePanel from "@/components/share/SharePanel";
import VoiceDock from "@/components/voice/VoiceDock";
import { EVENTS } from "@/lib/contracts";
import type {
  Change, ChipsDetail, Conflict, Matter, Money, NotDone, OpenItem, RecordDetail, ShowDetail, SourceRef, Summary, TimelineEvent, ToolResult,
} from "@/lib/contracts";
import type { TopEntry } from "@/lib/pipeline/rank";
import Replay from "./Replay";

export type BriefData = {
  matter: Matter; today: string; since: string;
  summary: ToolResult<Summary>; openItems: ToolResult<OpenItem[]>; conflicts: ToolResult<Conflict[]>;
  money: ToolResult<Money>; notDone: ToolResult<NotDone[]>; changes: ToolResult<Change[]>;
  timeline: ToolResult<TimelineEvent[]>; top: TopEntry[];
};

const usd = (n: number | null) => (n === null ? "not found" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const days = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
function when(iso: string | null, today: string) {
  if (!iso) return "no date";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const n = days(iso, today);
  return `${d} (${n === 0 ? "today" : n > 0 ? `${n} days ago` : `in ${-n} days`})`;
}
const REPLY: Record<string, string> = {
  sending_by: "Provider replied: sending by", waiting_on_patient: "Provider replied: waiting on the patient",
  balance_holding: "Provider replied: an unpaid balance is holding this up", not_proceeding: "Provider replied: not proceeding",
};
const PARTY: Record<string, string> = { us: "Us", client: "Client", provider: "Provider", defence: "Defence", court: "Court", other: "Other" };

function Section({ id, title, count, flash, children }: { id: string; title: string; count?: number; flash: string | null; children: React.ReactNode }) {
  return (
    <section id={`sec-${id}`} className={`scroll-mt-4 rounded-lg border border-neutral-300 p-5 transition-colors duration-700 ${flash === id ? "bg-yellow-100" : "bg-white"}`}>
      <h2 className="mb-3 text-2xl font-semibold">{title}{count !== undefined && <span className="ml-2 text-neutral-500">({count})</span>}</h2>
      {children}
    </section>
  );
}

function Sources({ refs, open }: { refs: SourceRef[]; open: (r: SourceRef) => void }) {
  if (!refs.length) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {refs.map((r, i) => (
        <button key={i} onClick={() => open(r)} title="Open the source record"
          className="rounded border border-blue-700 px-1.5 text-sm font-medium text-blue-800 hover:bg-blue-50">
          source {refs.length > 1 ? i + 1 : ""}
        </button>
      ))}
    </span>
  );
}

const Empty = ({ searched }: { searched: { records: number; pages: number } }) => (
  <p className="text-neutral-600">None found in the {searched.records} records and {searched.pages} scan pages read.</p>
);

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (!quote || at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="bg-yellow-200">{text.slice(at, at + quote.length)}</mark>{text.slice(at + quote.length)}</>;
}

export default function FirmBrief(initial: BriefData) {
  const router = useRouter();
  const { matter, today } = initial;
  const [openItems, setOpenItems] = useState(initial.openItems);
  const [top, setTop] = useState(initial.top);
  const [changes, setChanges] = useState(initial.changes);
  const [since, setSince] = useState(initial.since);
  const [source, setSource] = useState<{ ref: SourceRef; detail: RecordDetail | null } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [chips, setChips] = useState<SourceRef[]>([]);
  const [busy, setBusy] = useState("");
  const [injuries, setInjuries] = useState<{ bodyPart: string; findings: { quote: string; source: SourceRef }[] }[]>([]);
  const { summary, conflicts, money, notDone, timeline } = initial;
  const h = summary.data.header;

  const api = useCallback(async <T,>(tool: string, extra = ""): Promise<T> => (await fetch(`/api/case/${tool}?matterId=${matter.id}${extra}`)).json(), [matter.id]);

  const open = useCallback(async (ref: SourceRef) => {
    setSource({ ref, detail: null });
    const detail = await api<RecordDetail | null>("getRecord", `&resource=${encodeURIComponent(ref.resource)}&clioId=${ref.clioId}${ref.pageNo ? `&pageNo=${ref.pageNo}` : ""}`);
    setSource({ ref, detail });
  }, [api]);

  // Contract C: the voice agent moves this page through browser events.
  useEffect(() => {
    const show = (e: Event) => {
      const d = (e as CustomEvent<ShowDetail>).detail ?? {};
      if (d.section) {
        document.getElementById(`sec-${d.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlash(d.section);
        setTimeout(() => setFlash(null), 2500);
      }
      if (d.source) open(d.source);
    };
    const onChips = (e: Event) => setChips((e as CustomEvent<ChipsDetail>).detail?.sources ?? []);
    window.addEventListener(EVENTS.show, show);
    window.addEventListener(EVENTS.chips, onChips);
    return () => { window.removeEventListener(EVENTS.show, show); window.removeEventListener(EVENTS.chips, onChips); };
  }, [open]);

  useEffect(() => { api<typeof injuries>("injuries").then((x) => Array.isArray(x) && setInjuries(x)).catch(() => {}); }, [api]);

  // Contract E: provider replies land in the database; re-read the open items so they appear without a reload.
  useEffect(() => {
    const t = setInterval(async () => setOpenItems(await api<ToolResult<OpenItem[]>>("getOpenItems")), 8000);
    return () => clearInterval(t);
  }, [api]);

  async function sync() {
    setBusy("Reading from Clio ...");
    await fetch("/api/sync", { method: "POST" });
    setBusy("Building the brief ...");
    await fetch("/api/case/process", { method: "POST" });
    setBusy("");
    router.refresh();
  }
  async function rate(e: TopEntry, action: "pin" | "dismiss") {
    await fetch("/api/case/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matterId: matter.id, resource: e.resource, clioId: e.clioId, action }) });
    setTop(await api<TopEntry[]>("topTen"));
  }
  async function changeSince(v: string) {
    setSince(v);
    if (v) setChanges(await api<ToolResult<Change[]>>("getChanges", `&since=${v}`));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-5 text-lg text-black">
      {/* 1. Top bar */}
      <header className="flex flex-wrap items-center gap-5 rounded-lg border border-neutral-300 bg-white p-5">
        {h.photoDocumentId
          ? <object data={`/api/case/photo?documentId=${h.photoDocumentId}#toolbar=0&navpanes=0&view=Fit`} type="application/pdf" className="h-28 w-24 rounded border border-neutral-300" aria-label="Client photo" />
          : <div className="flex h-28 w-24 items-center justify-center rounded border border-neutral-300 text-sm text-neutral-500">no photo</div>}
        <div className="min-w-64 flex-1">
          <h1 className="text-3xl font-bold">{h.clientName || matter.client}</h1>
          <p className="text-neutral-700">{matter.name}</p>
          <p className="mt-1"><b>Stage:</b> {h.stage ?? "not set"} &nbsp;·&nbsp; <b>Status:</b> {matter.status ?? "not set"}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="font-semibold">Last client contact</dt>
          <dd>{h.lastClientContact ? <>{when(h.lastClientContact.date, today)}<Sources refs={h.lastClientContact.sources} open={open} /></> : "none found"}</dd>
          <dt className="font-semibold">Filing deadline</dt>
          <dd>{h.limitations ? <>{h.limitations.status}{h.limitations.date ? `, ${when(h.limitations.date, today)}` : ""}<Sources refs={h.limitations.sources} open={open} /></> : "no limitations entry found"}</dd>
          <dt className="font-semibold">Firm has spent</dt>
          <dd>{usd(h.firmSpend.amount)}<Sources refs={h.firmSpend.sources.slice(0, 1)} open={open} /></dd>
          <dt className="font-semibold">Scan pages read</dt>
          <dd>{h.pagesRead.done} of {h.pagesRead.total}</dd>
        </dl>
        <div className="flex flex-col gap-2">
          <button onClick={sync} disabled={!!busy} className="rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-60">{busy || "Refresh from Clio"}</button>
          <button onClick={() => fetch("/api/scan", { method: "POST" })} className="rounded border border-black px-4 py-2 font-semibold">Read the documents</button>
        </div>
      </header>

      {/* 2. Summary */}
      <Section id="summary" title="Where this case stands" flash={flash}>
        {summary.data.sentences.length
          ? summary.data.sentences.map((s, i) => <p key={i} className="mb-2 text-xl">{s.text}<Sources refs={s.sources.slice(0, 4)} open={open} /></p>)
          : <p className="text-neutral-600">No summary yet. It is written once the records have been read.</p>}
      </Section>

      {/* 3. Conflicts */}
      <Section id="conflicts" title="Conflicts in the file" count={conflicts.data.length} flash={flash}>
        {conflicts.data.length === 0 && <Empty searched={conflicts.searched} />}
        {conflicts.data.map((c) => (
          <div key={c.id} className="mb-4">
            <h3 className="font-semibold">{c.topic}</h3>
            <div className="mt-1 grid gap-2 md:grid-cols-2">
              {c.versions.map((v, i) => (
                <blockquote key={i} className="rounded border-l-4 border-red-700 bg-red-50 p-3">
                  &ldquo;{v.value}&rdquo;
                  <div className="mt-1 text-base text-neutral-700">{when(v.date, today)}<Sources refs={v.sources} open={open} /></div>
                </blockquote>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* 4. Money */}
      <Section id="money" title="Money" flash={flash}>
        <table className="w-full">
          <tbody>
            {money.data.lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-1.5 pr-4">{l.label}</td>
                <td className="py-1.5 pr-4 text-right font-semibold tabular-nums">{usd(l.amount)}</td>
                <td className="py-1.5 text-base text-neutral-700">{l.foundation}<Sources refs={l.sources.slice(0, 2)} open={open} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 rounded bg-neutral-100 p-3">
          <b>Rough net to client: {usd(money.data.netToClient.amount)}</b>
          {money.data.netToClient.inputs.length > 0 && (
            <span className="ml-2 text-base">= {money.data.netToClient.inputs.map((x, i) => `${i ? " − " : ""}${x.label} ${usd(x.amount)}`).join("")}</span>
          )}
          <p className="text-base text-neutral-700">{money.data.netToClient.assumption}</p>
        </div>
      </Section>

      <Section id="injuries" title="Injuries found in the file" count={injuries.length} flash={flash}>
        {injuries.length === 0 && <p className="text-neutral-600">None extracted yet. Injuries appear as records and scan pages are read ({h.pagesRead.done} of {h.pagesRead.total} pages so far).</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {injuries.map((g) => (
            <div key={g.bodyPart} className="rounded border border-neutral-300 p-3">
              <b className="capitalize">{g.bodyPart}</b>
              {g.findings.map((f, i) => <p key={i} className="mt-1 text-base">&ldquo;{f.quote}&rdquo;<Sources refs={[f.source]} open={open} /></p>)}
            </div>
          ))}
        </div>
      </Section>

      {/* 5. Open items */}
      <Section id="open_items" title="Open items: who we are waiting on" count={openItems.data.length} flash={flash}>
        {openItems.data.length === 0 && <Empty searched={openItems.searched} />}
        {openItems.data.length > 0 && (
          <table className="w-full">
            <thead><tr className="border-b-2 border-black text-left"><th className="py-1 pr-3">Waiting on</th><th className="pr-3">What</th><th className="pr-3">Asked</th><th>Open for</th></tr></thead>
            <tbody>
              {openItems.data.map((o) => (
                <tr key={o.id} className="border-b border-neutral-200 align-top">
                  <td className="py-2 pr-3"><b>{o.waitingOn}</b><div className="text-base text-neutral-600">{PARTY[o.party] ?? o.party}</div></td>
                  <td className="py-2 pr-3">
                    {o.what}<Sources refs={o.sources.slice(0, 6)} open={open} />
                    {o.providerReply && <div className="mt-1 rounded bg-green-100 px-2 py-1 text-base font-semibold text-green-900">{REPLY[o.providerReply.reply] ?? o.providerReply.reply}{o.providerReply.replyDate ? ` ${o.providerReply.replyDate}` : ""}</div>}
                  </td>
                  <td className="py-2 pr-3">
                    {o.asks > 0 ? `${o.asks} ${o.asks === 1 ? "time" : "times"}` : "task"}
                    {o.otherCounts.map((c, i) => <div key={i} className="text-base text-red-800">file also says {c.value}<Sources refs={c.sources} open={open} /></div>)}
                  </td>
                  <td className="py-2">{o.daysOpen} days<div className="text-base text-neutral-600">since {o.firstAsked}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 6. Not yet done */}
      <Section id="not_done" title="Not yet done" count={notDone.data.length} flash={flash}>
        {notDone.data.length === 0 && <Empty searched={notDone.searched} />}
        {notDone.data.map((n) => (
          <p key={n.id} className="mb-2"><b>{n.daysOpen} days</b> &nbsp;{n.what} <span className="text-base text-neutral-600">(since {n.since})</span><Sources refs={n.sources.slice(0, 4)} open={open} /></p>
        ))}
      </Section>

      {/* 7. Top ten */}
      <Section id="top_ten" title="The ten entries that matter most" flash={flash}>
        {top.length === 0 && <p className="text-neutral-600">No entries yet.</p>}
        {top.map((e) => (
          <div key={`${e.resource}:${e.clioId}`} className="mb-2 flex items-start gap-3 border-b border-neutral-200 pb-2">
            <div className="flex-1">
              <button onClick={() => open(e.sources[0])} className="text-left font-semibold text-blue-800 underline">{e.title || e.resource}</button>
              <div className="text-base text-neutral-600">{e.date ?? "no date"} · {e.why.join(", ") || "general"}{e.pinned ? " · pinned" : ""}</div>
            </div>
            <button onClick={() => rate(e, "pin")} className="rounded border border-black px-2 py-0.5 text-base">Pin</button>
            <button onClick={() => rate(e, "dismiss")} className="rounded border border-black px-2 py-0.5 text-base">Not important</button>
          </div>
        ))}
      </Section>

      {/* 8. Recent changes */}
      <Section id="changes" title="What is new" count={changes.data.length} flash={flash}>
        <label className="mb-3 block">Show changes since <input type="date" value={since} max={today} onChange={(e) => changeSince(e.target.value)} className="ml-2 rounded border border-black px-2 py-1" /></label>
        {changes.data.length === 0 && <p className="text-neutral-600">Nothing dated after {since}.</p>}
        {changes.data.slice(0, 15).map((c, i) => (
          <p key={i} className="mb-1"><span className="tabular-nums text-neutral-700">{c.date}</span> &nbsp;{c.title} <span className="text-base text-neutral-600">({c.kind.replace(/_/g, " ")})</span><Sources refs={c.sources} open={open} /></p>
        ))}
      </Section>

      <Replay events={timeline.data} coverage={Math.min(...money.data.lines.filter((l) => l.label === "Coverage limit" && l.amount !== null).map((l) => l.amount as number))} open={open} />

      <section className="rounded-lg border border-neutral-300 bg-white p-5"><SharePanel matterId={matter.id} /></section>

      {/* Voice dock, with the sources of what is being said shown next to it */}
      <div className="fixed bottom-4 right-4 z-20 max-w-md space-y-2">
        {chips.length > 0 && <div className="rounded-lg border border-blue-700 bg-white p-2 shadow"><span className="text-base">Sources for this answer:</span><Sources refs={chips.slice(0, 8)} open={open} /></div>}
        <div className="rounded-lg border border-black bg-white p-3 shadow-lg"><VoiceDock matterId={matter.id} /></div>
      </div>

      {/* Source panel */}
      {source && (
        <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-xl overflow-y-auto border-l-2 border-black bg-white p-6 shadow-2xl">
          <button onClick={() => setSource(null)} className="float-right rounded border border-black px-3 py-1">Close</button>
          {!source.detail ? <p>Opening the record ...</p> : (
            <>
              <p className="text-base uppercase tracking-wide text-neutral-600">{source.detail.resource.replace(/_/g, " ")}{source.detail.pageNo ? `, page ${source.detail.pageNo}` : ""} · {source.detail.date ?? "no date"}</p>
              <h3 className="mb-3 text-2xl font-semibold">{source.detail.title}</h3>
              <p className="whitespace-pre-wrap leading-relaxed"><Highlighted text={source.detail.text} quote={source.ref.quote} /></p>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
