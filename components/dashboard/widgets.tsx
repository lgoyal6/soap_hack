// Owner: Laksh. Every widget on the dashboard: a compact tile for the home screen and a full view for its tab.
"use client";

import { useState } from "react";
import ClientPhoto from "@/components/firm/ClientPhoto";
import Glance, { type Injury } from "@/components/firm/Glance";
import Replay from "@/components/firm/Replay";
import SharePanel from "@/components/share/SharePanel";
import type {
  Change, Conflict, Matter, Money, NotDone, OpenItem, SourceRef, Summary, TimelineEvent, ToolResult,
} from "@/lib/contracts";
import type { TopEntry } from "@/lib/pipeline/rank";
import type { SharePanelData } from "@/lib/portal/types";

export type DashData = {
  matters: Matter[];
  matter: Matter;
  today: string;
  since: string;
  summary: ToolResult<Summary>;
  openItems: ToolResult<OpenItem[]>;
  conflicts: ToolResult<Conflict[]>;
  money: ToolResult<Money>;
  notDone: ToolResult<NotDone[]>;
  changes: ToolResult<Change[]>;
  timeline: ToolResult<TimelineEvent[]>;
  top: TopEntry[];
};

/** Live state the dashboard keeps fresh, plus what widgets need to act. */
export type Ctx = DashData & {
  injuries: Injury[];
  share: SharePanelData | null;
  open: (r: SourceRef) => void;
  rate: (e: TopEntry, action: "pin" | "dismiss") => void;
  setSince: (v: string) => void;
};

// ---- formatting -------------------------------------------------------------------------------

export const usd = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "not found";
const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / dayMs);
export function when(iso: string | null | undefined, today: string) {
  if (!iso) return "no date";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const n = daysBetween(iso, today);
  return n === 0 ? `${d} (today)` : n > 0 ? `${d} (${n} days ago)` : `${d} (in ${-n} days)`;
}
const REPLY: Record<string, string> = {
  sending_by: "sending by", waiting_on_patient: "waiting on the patient", balance_holding: "unpaid balance is holding it", not_proceeding: "not proceeding",
};

// ---- small parts ------------------------------------------------------------------------------

export function Src({ refs, open, max = 3 }: { refs: SourceRef[]; open: (r: SourceRef) => void; max?: number }) {
  if (!refs?.length) return null;
  return (
    <>
      {refs.slice(0, max).map((r, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); open(r); }}
          className="ml-1 rounded border border-blue-700 px-1 align-middle text-xs text-blue-800 hover:bg-blue-50"
        >{r.pageNo ? `p${r.pageNo}` : "source"}</button>
      ))}
    </>
  );
}

const Big = ({ n, label, tone = "" }: { n: React.ReactNode; label: string; tone?: string }) => (
  <div><div className={`text-3xl font-bold tabular-nums leading-none ${tone}`}>{n}</div><div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">{label}</div></div>
);
const More = ({ n }: { n: number }) => (n > 0 ? <p className="mt-1 text-sm text-neutral-500">+{n} more</p> : null);
const None = ({ searched }: { searched?: { records: number; pages: number } }) => (
  <p className="text-neutral-600">None found{searched ? ` in ${searched.records} records and ${searched.pages} pages read` : ""}.</p>
);

// ---- the widgets ------------------------------------------------------------------------------

export type Widget = {
  id: string;
  title: string;
  /** Grid size on the home screen. */
  cols?: 1 | 2;
  rows?: 1 | 2;
  /** Accent for tiles that need attention. */
  alert?: (c: Ctx) => boolean;
  Tile: (p: { c: Ctx }) => React.ReactNode;
  /** The full view brings its own heading. */
  ownTitle?: boolean;
  /** Full view in its own tab. Absent = the tile is the whole widget (voice). */
  Full?: (p: { c: Ctx }) => React.ReactNode;
};

export const WIDGETS: Widget[] = [
  {
    id: "client", title: "Client",
    Tile: ({ c }) => {
      const h = c.summary.data.header;
      return (
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden"><div className="origin-top-left scale-[0.57]"><ClientPhoto documentId={h.photoDocumentId} name={h.clientName || c.matter.client} /></div></div>
            <div className="min-w-0">
              <p className="truncate text-xl font-bold">{h.clientName || c.matter.client}</p>
              <p className="text-sm text-neutral-700">{h.stage ?? "No stage"} · {c.matter.status ?? "no status"}</p>
            </div>
          </div>
          <p className="text-sm"><b>Last contact:</b> {h.lastClientContact ? when(h.lastClientContact.date, c.today) : "none found"}<Src refs={h.lastClientContact?.sources ?? []} open={c.open} max={1} /></p>
          <p className="text-sm"><b>Filing deadline:</b> {h.limitations ? `${h.limitations.status}${h.limitations.date ? `, ${when(h.limitations.date, c.today)}` : ""}` : "no entry found"}<Src refs={h.limitations?.sources ?? []} open={c.open} max={1} /></p>
        </div>
      );
    },
    Full: ({ c }) => {
      const h = c.summary.data.header;
      return <Glance matter={c.matter} header={h} injuries={c.injuries} lastContact={h.lastClientContact ? when(h.lastClientContact.date, c.today) : "none found"} open={c.open} />;
    },
  },
  {
    id: "summary", title: "Where it stands", cols: 2,
    Tile: ({ c }) => (c.summary.data.sentences.length
      ? <div className="space-y-1.5 text-lg leading-snug">{c.summary.data.sentences.slice(0, 3).map((s, i) => <p key={i}>{s.text}<Src refs={s.sources} open={c.open} max={2} /></p>)}</div>
      : <p className="text-neutral-600">No summary yet. It is written once the records have been read.</p>),
    Full: ({ c }) => (
      <div className="space-y-3 text-xl leading-relaxed">
        {c.summary.data.sentences.length ? c.summary.data.sentences.map((s, i) => <p key={i}>{s.text}<Src refs={s.sources} open={c.open} max={6} /></p>) : <p className="text-neutral-600">No summary yet.</p>}
      </div>
    ),
  },
  { id: "voice", title: "Paralegal", rows: 2, Tile: () => null },
  {
    id: "open_items", title: "Waiting on",
    alert: (c) => c.openItems.data.length > 0,
    Tile: ({ c }) => {
      const items = c.openItems.data;
      if (!items.length) return <None searched={c.openItems.searched} />;
      return (
        <div>
          <div className="mb-2 flex gap-6"><Big n={items.length} label="open" /><Big n={Math.max(...items.map((i) => i.daysOpen))} label="days, oldest" tone="text-red-700" /></div>
          <ul className="space-y-1 text-sm">
            {items.slice(0, 3).map((o) => (
              <li key={o.id} className="truncate"><b>{o.waitingOn}</b>: {o.what}{o.providerReply && <span className="ml-1 rounded bg-green-100 px-1 text-green-900">replied</span>}</li>
            ))}
          </ul>
          <More n={items.length - 3} />
        </div>
      );
    },
    Full: ({ c }) => (
      c.openItems.data.length === 0 ? <None searched={c.openItems.searched} /> : (
        <table className="w-full text-lg">
          <thead><tr className="border-b-2 border-black text-left"><th className="py-2">Waiting on</th><th>What</th><th>Asks</th><th>Open for</th></tr></thead>
          <tbody>
            {c.openItems.data.map((o) => (
              <tr key={o.id} className="border-b border-neutral-200 align-top">
                <td className="py-2 pr-3"><b>{o.waitingOn}</b><div className="text-sm text-neutral-600">{o.party}</div></td>
                <td className="py-2 pr-3">
                  {o.what}<Src refs={o.sources} open={c.open} />
                  {o.otherCounts.length > 0 && <div className="text-sm text-orange-800">The file also says: {o.otherCounts.map((x, i) => <span key={i}>{x.value}<Src refs={x.sources} open={c.open} max={1} /> </span>)}</div>}
                  {o.providerReply && <div className="mt-1 rounded bg-green-50 px-2 py-1 font-semibold text-green-900">Provider replied: {REPLY[o.providerReply.reply] ?? o.providerReply.reply}{o.providerReply.replyDate ? ` ${o.providerReply.replyDate}` : ""}</div>}
                </td>
                <td className="py-2 pr-3 tabular-nums">{o.asks}</td>
                <td className="py-2 tabular-nums">{o.daysOpen} days<div className="text-sm text-neutral-600">since {o.firstAsked}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    ),
  },
  {
    id: "money", title: "Money",
    Tile: ({ c }) => {
      const m = c.money.data;
      return (
        <div>
          {m.netToClient.amount !== null && <div className="mb-2"><Big n={usd(m.netToClient.amount)} label="rough net to client" /></div>}
          <table className="w-full text-sm"><tbody>
            {m.lines.slice(0, 4).map((l, i) => <tr key={i}><td className="truncate pr-2">{l.label}</td><td className="text-right font-semibold tabular-nums">{usd(l.amount)}</td></tr>)}
          </tbody></table>
          <More n={m.lines.length - 4} />
        </div>
      );
    },
    Full: ({ c }) => {
      const m = c.money.data;
      return (
        <div className="space-y-4 text-lg">
          <table className="w-full"><tbody>
            {m.lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-2 pr-4">{l.label}</td>
                <td className="py-2 pr-4 text-right font-semibold tabular-nums">{usd(l.amount)}</td>
                <td className="py-2 text-base text-neutral-700">{l.foundation}<Src refs={l.sources} open={c.open} /></td>
              </tr>
            ))}
          </tbody></table>
          <div className="rounded-lg bg-neutral-100 p-4">
            <p className="text-2xl font-bold">Rough net to client: {usd(m.netToClient.amount)}</p>
            {m.netToClient.formula && <p className="mt-1 font-mono text-base">{m.netToClient.formula}</p>}
            {m.netToClient.inputs.length > 0 && <p className="text-base">{m.netToClient.inputs.map((x) => `${x.label} ${usd(x.amount)}`).join(" · ")}</p>}
            {m.netToClient.assumption && <p className="mt-1 text-base text-neutral-700">{m.netToClient.assumption}</p>}
          </div>
        </div>
      );
    },
  },
  {
    id: "conflicts", title: "Conflicts",
    alert: (c) => c.conflicts.data.length > 0,
    Tile: ({ c }) => (c.conflicts.data.length === 0 ? <None searched={c.conflicts.searched} /> : (
      <div>
        <Big n={c.conflicts.data.length} label="places the file disagrees" tone="text-red-700" />
        <ul className="mt-2 list-disc pl-5 text-sm">{c.conflicts.data.slice(0, 3).map((x) => <li key={x.id} className="truncate">{x.topic}</li>)}</ul>
        <More n={c.conflicts.data.length - 3} />
      </div>
    )),
    Full: ({ c }) => (c.conflicts.data.length === 0 ? <None searched={c.conflicts.searched} /> : (
      <div className="space-y-5">
        {c.conflicts.data.map((x) => (
          <div key={x.id}>
            <h3 className="text-xl font-semibold">{x.topic}</h3>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {x.versions.map((v, i) => (
                <blockquote key={i} className="rounded border-l-4 border-red-700 bg-red-50 p-3 text-lg">
                  &ldquo;{v.value}&rdquo;<div className="mt-1 text-base text-neutral-700">{when(v.date, c.today)}<Src refs={v.sources} open={c.open} /></div>
                </blockquote>
              ))}
            </div>
          </div>
        ))}
      </div>
    )),
  },
  {
    id: "not_done", title: "Not yet done",
    alert: (c) => c.notDone.data.length > 0,
    Tile: ({ c }) => (c.notDone.data.length === 0 ? <None searched={c.notDone.searched} /> : (
      <div>
        <Big n={c.notDone.data.length} label="promised, no record it happened" />
        <ul className="mt-2 space-y-0.5 text-sm">{c.notDone.data.slice(0, 3).map((n) => <li key={n.id} className="truncate">{n.what} <span className="text-neutral-500">· {n.daysOpen}d</span></li>)}</ul>
        <More n={c.notDone.data.length - 3} />
      </div>
    )),
    Full: ({ c }) => (c.notDone.data.length === 0 ? <None searched={c.notDone.searched} /> : (
      <ul className="space-y-3 text-lg">
        {c.notDone.data.map((n) => <li key={n.id} className="border-b border-neutral-200 pb-2">{n.what}<Src refs={n.sources} open={c.open} /><div className="text-base text-neutral-600">open {n.daysOpen} days, since {n.since}</div></li>)}
      </ul>
    )),
  },
  {
    id: "injuries", title: "Injuries",
    Tile: ({ c }) => (c.injuries.length === 0 ? <p className="text-neutral-600">None extracted yet.</p> : (
      <div>
        <Big n={c.injuries.length} label="body regions" />
        <p className="mt-2 text-sm capitalize">{c.injuries.slice(0, 6).map((i) => i.bodyPart).join(", ")}</p>
      </div>
    )),
    Full: ({ c }) => (c.injuries.length === 0 ? <p className="text-neutral-600">None extracted yet. Run &ldquo;Read the documents&rdquo; on the classic page.</p> : (
      <div className="grid gap-4 md:grid-cols-2">
        {c.injuries.map((i) => (
          <div key={i.bodyPart} className="rounded-lg border border-neutral-300 p-3">
            <h3 className="mb-1 text-xl font-semibold capitalize">{i.bodyPart}</h3>
            <ul className="space-y-1 text-base">{i.findings.map((f, k) => <li key={k}>&ldquo;{f.quote}&rdquo;<Src refs={[f.source]} open={c.open} max={1} /></li>)}</ul>
          </div>
        ))}
      </div>
    )),
  },
  {
    id: "top_ten", title: "Entries that matter",
    Tile: ({ c }) => (c.top.length === 0 ? <p className="text-neutral-600">Nothing ranked yet.</p> : (
      <ol className="list-decimal space-y-0.5 pl-5 text-sm">{c.top.slice(0, 5).map((e) => <li key={`${e.resource}:${e.clioId}`} className="truncate">{e.pinned && "📌 "}{e.title}</li>)}</ol>
    )),
    Full: ({ c }) => (
      <ol className="space-y-2 text-lg">
        {c.top.map((e) => (
          <li key={`${e.resource}:${e.clioId}`} className="flex items-start gap-3 border-b border-neutral-200 pb-2">
            <div className="flex-1">
              <button onClick={() => c.open({ resource: e.resource, clioId: e.clioId })} className="text-left font-semibold text-blue-800 underline">{e.pinned && "📌 "}{e.title}</button>
              <div className="text-base text-neutral-600">{e.date ?? "no date"} · {e.why.join(", ")}</div>
            </div>
            <button onClick={() => c.rate(e, "pin")} className="rounded border border-black px-2 py-0.5">Pin</button>
            <button onClick={() => c.rate(e, "dismiss")} className="rounded border border-black px-2 py-0.5">Not important</button>
          </li>
        ))}
      </ol>
    ),
  },
  {
    id: "changes", title: "What is new",
    Tile: ({ c }) => (
      <div>
        <Big n={c.changes.data.length} label={`since ${c.since}`} />
        <ul className="mt-2 space-y-0.5 text-sm">{c.changes.data.slice(0, 3).map((x, i) => <li key={i} className="truncate"><span className="text-neutral-500">{x.date}</span> {x.title}</li>)}</ul>
      </div>
    ),
    Full: ({ c }) => <ChangesFull c={c} />,
  },
  {
    id: "providers", title: "Providers", ownTitle: true,
    Tile: ({ c }) => {
      const ps = c.share?.providers ?? [];
      if (!c.share) return <p className="text-neutral-600">Loading ...</p>;
      if (!ps.length) return <p className="text-neutral-600">No treating providers found.</p>;
      return (
        <ul className="space-y-1 text-sm">
          {ps.slice(0, 4).map((p) => {
            const shared = Object.values(p.consent).filter((x) => x.granted).length;
            return (
              <li key={p.provider.nodeId} className="truncate">
                <b>{p.provider.name}</b>{" "}
                <span className="text-neutral-600">{shared}/5 shared · {p.code?.active ? `opened ${p.views.count}x` : "no login"}{p.replies.length ? ` · ${p.replies.length} repl${p.replies.length === 1 ? "y" : "ies"}` : ""}{p.lien ? ` · lien ${p.lien.status.replace(/_/g, " ")}` : ""}</span>
              </li>
            );
          })}
        </ul>
      );
    },
    Full: ({ c }) => <SharePanel matterId={c.matter.id} />,
  },
  {
    id: "replay", title: "Case replay", ownTitle: true,
    Tile: ({ c }) => {
      const ev = c.timeline.data;
      const lanes = ["medical", "legal", "money", "communications"] as const;
      const color = { medical: "bg-rose-500", legal: "bg-indigo-500", money: "bg-emerald-500", communications: "bg-amber-500" };
      const t = ev.map((e) => Date.parse(e.date)).filter(Number.isFinite);
      const [lo, hi] = [Math.min(...t), Math.max(...t)];
      return ev.length === 0 ? <p className="text-neutral-600">No dated records yet.</p> : (
        <div className="space-y-1.5">
          {lanes.map((l) => (
            <div key={l} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 capitalize text-neutral-600">{l}</span>
              <div className="relative h-3 flex-1 rounded bg-neutral-100">
                {ev.filter((e) => e.lane === l).map((e, i) => (
                  <span key={i} className={`absolute top-0.5 h-2 w-2 rounded-full ${color[l]}`} style={{ left: `${hi > lo ? ((Date.parse(e.date) - lo) / (hi - lo)) * 96 : 0}%` }} />
                ))}
              </div>
            </div>
          ))}
          <p className="pt-1 text-sm text-neutral-600">{ev.length} dated events. Open to play.</p>
        </div>
      );
    },
    Full: ({ c }) => <Replay events={c.timeline.data} coverage={c.money.data.netToClient.inputs.find((i) => i.label === "recovery")?.amount ?? Infinity} open={c.open} />,
  },
];

function ChangesFull({ c }: { c: Ctx }) {
  const [v, setV] = useState(c.since);
  return (
    <div className="space-y-3 text-lg">
      <label className="flex items-center gap-2">Records dated after
        <input type="date" value={v} onChange={(e) => { setV(e.target.value); if (e.target.value) c.setSince(e.target.value); }} className="rounded border border-neutral-400 px-2 py-1" />
      </label>
      {c.changes.data.length === 0 ? <None searched={c.changes.searched} /> : (
        <ul className="space-y-1">
          {c.changes.data.map((x, i) => <li key={i} className="border-b border-neutral-200 py-1"><span className="tabular-nums text-neutral-600">{x.date}</span> <span className="text-sm text-neutral-500">{x.kind.replace(/_/g, " ")}</span> {x.title}<Src refs={x.sources} open={c.open} max={1} /></li>)}
        </ul>
      )}
    </div>
  );
}

/** Contract C section names map straight onto widget ids. */
export const SECTION_TO_WIDGET: Record<string, string> = {
  summary: "summary", conflicts: "conflicts", money: "money", open_items: "open_items", not_done: "not_done", top_ten: "top_ten", changes: "changes",
};
