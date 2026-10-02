// Owner: Tijil. The dashboard's home screen, built for a ninety-second read by a senior attorney.
// Reading order, top to bottom: who and what happened, the bottom line, four numbers, then the three
// lists that need attention (three lines each). Everything else is one click away, not on screen.
"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import ClientPhoto from "@/components/firm/ClientPhoto";
import { BodyMap, ago, byRegion, isPrior } from "@/components/firm/Glance";
import type { SourceRef } from "@/lib/contracts";
import IncidentScene from "@/components/firm/IncidentScene";
import { usd, when, type Ctx } from "./widgets";

type Sourced = { text: string; source: SourceRef } | null;
type GlanceData = {
  news?: { since: string | null; records: number; sentences: { text: string; sources: SourceRef[] }[] };
  glance: { incidentKind?: string; client: { age: number | null }; accident: { date: string | null; daysSince: number | null; location: Sourced; summary: Sourced } } | null;
  witness: { kind: "concern" | "strength" }[];
};

const card = "rounded-2xl border border-neutral-300 bg-white p-4 shadow-sm";
const kicker = "text-sm font-semibold uppercase tracking-widest text-neutral-500";
const rise = (i: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay: i * 0.08 } });
const longDate = (iso: string | null) => (iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "date not found");

function Attention({ title, count, rows, onOpen, i }: { title: string; count: number; rows: { main: string; side?: string }[]; onOpen: () => void; i: number }) {
  return (
    <motion.button {...rise(i)} onClick={onOpen} className={`${card} border-l-8 border-l-red-600 text-left hover:border-black`}>
      <div className="mb-2 flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums">{count}</span>
        <span className="text-xl font-semibold">{title}</span>
        <span className="ml-auto text-base text-neutral-500">see all</span>
      </div>
      {rows.length === 0 && <p className="text-neutral-600">None found.</p>}
      {rows.map((r, k) => (
        <p key={k} className="flex gap-3 border-t border-neutral-200 py-1 text-lg">
          <span className="min-w-0 flex-1 truncate">{r.main}</span>
          {r.side && <span className="shrink-0 font-semibold tabular-nums text-red-700">{r.side}</span>}
        </p>
      ))}
    </motion.button>
  );
}

export default function Home90({ c, openTab, allTiles }: { c: Ctx; openTab: (id: string) => void; allTiles: () => void }) {
  const { matter, summary, money, conflicts, notDone, openItems, today } = c;
  const h = summary.data.header;
  const [g, setG] = useState<GlanceData>({ glance: null, witness: [] });
  useEffect(() => {
    fetch(`/api/case/glance?matterId=${matter.id}`).then((r) => r.json()).then((d) => d && Array.isArray(d.witness) && setG(d)).catch(() => {});
  }, [matter.id]);

  const acc = g.glance?.accident;
  const claimed = c.injuries.filter((x) => !isPrior(x));
  const regions = byRegion(claimed);
  const line = (label: string) => money.data.lines.find((l) => l.label.toLowerCase().includes(label));
  const recovery = money.data.netToClient.inputs.find((x) => x.label === "recovery")?.amount ?? null;
  const value = line("value")?.amount ?? null;
  const concerns = g.witness.filter((w) => w.kind === "concern").length;
  // The requests chased hardest come first: most asks, then longest open.
  const chased = [...openItems.data].sort((a, b) => b.asks - a.asks || b.daysOpen - a.daysOpen);

  const kpis: { label: string; value: string; note: string; tab: string }[] = [
    { label: "Case value", value: usd(value), note: "the firm's own estimate", tab: "money" },
    { label: "Coverage behind it", value: usd(recovery), note: conflicts.data.length ? "the file disagrees: see conflicts" : "liability coverage in the file", tab: "money" },
    { label: "Rough net to client", value: usd(money.data.netToClient.amount), note: "illustrative, assumed fee", tab: "money" },
    { label: "Last spoke to client", value: h.lastClientContact ? when(h.lastClientContact.date, today).replace(/^.*\(|\)$/g, "") : "not found", note: h.lastClientContact?.date ?? "", tab: "client" },
  ];

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 p-3 text-lg">
      {/* 0. What is new, said plainly: the first thing an attorney reopening the case wants */}
      {(g.news?.sentences.length ?? 0) > 0 && (
        <motion.div {...rise(0)} className={`${card} border-l-8 border-l-blue-700`}>
          <div className="flex items-baseline gap-3">
            <p className={kicker}>What is new</p>
            <button onClick={() => openTab("changes")} className="ml-auto text-base text-neutral-500 underline">all {g.news!.records} recent records</button>
          </div>
          <ul className="mt-1 space-y-1">
            {g.news!.sentences.slice(0, 3).map((n, i) => (
              <li key={i} className="text-lg leading-snug">
                {n.text}
                {n.sources.slice(0, 2).map((r, k) => <button key={k} onClick={() => c.open(r)} className="ml-2 rounded border border-blue-700 px-1.5 align-middle text-sm font-medium text-blue-800 hover:bg-blue-50">source</button>)}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* 1. Who, what happened, what was hurt */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr_1fr]">
        <motion.button {...rise(0)} onClick={() => openTab("client")} className={`${card} flex items-center gap-4 text-left hover:border-black`}>
          <ClientPhoto documentId={h.photoDocumentId} name={h.clientName || matter.client} />
          <div>
            <p className={kicker}>The client</p>
            <h1 className="text-3xl font-bold leading-tight">{h.clientName || matter.client}</h1>
            <p className="text-xl text-neutral-700">{[g.glance?.client.age ? `${g.glance.client.age} years old` : "", h.stage ?? ""].filter(Boolean).join(" · ")}</p>
            {concerns > 0 && <p className="mt-1 font-semibold text-red-700">As a witness: {concerns} concerns to prepare for</p>}
          </div>
        </motion.button>

        <motion.div {...rise(1)} className={card}>
          <p className={kicker}>The accident</p>
          <p className="text-xl font-bold leading-snug">{acc?.summary?.text ?? matter.name}</p>
          <p className="mt-1 text-lg text-neutral-700">{longDate(acc?.date ?? null)}{acc?.daysSince != null ? ` · ${ago(acc.daysSince)}` : ""}</p>
          {acc?.location && <p className="text-neutral-700">{acc.location.text}</p>}
          <div className="max-w-[280px]"><IncidentScene kind={g.glance?.incidentKind} /></div>
        </motion.div>

        <motion.button {...rise(2)} onClick={() => openTab("injuries")} className={`${card} flex items-center gap-4 text-left hover:border-black`}>
          <div className="[&>svg]:h-32"><BodyMap injuries={claimed} /></div>
          <div className="min-w-0">
            <p className={kicker}>The injuries</p>
            {regions.length === 0 && <p className="text-neutral-600">Not read yet.</p>}
            <div className="mt-1 flex flex-wrap gap-2">
              {regions.slice(0, 6).map((r) => <span key={r.label} className="rounded-full bg-red-50 px-3 py-1 text-lg font-semibold text-red-800">{r.label}</span>)}
            </div>
          </div>
        </motion.button>
      </div>

      {/* 2. The bottom line, with the four numbers beside it */}
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <motion.button {...rise(3)} onClick={() => openTab("summary")} className={`${card} text-left hover:border-black`}>
          <p className={kicker}>The bottom line</p>
          {summary.data.sentences.length === 0 && <p className="text-neutral-600">Not written yet. Refresh from Clio.</p>}
          <ol className="mt-1 space-y-2">
            {summary.data.sentences.map((s, i) => (
              <li key={i} className="flex gap-3 text-lg leading-snug"><span className="font-bold text-neutral-400">{i + 1}</span><span>{s.text}</span></li>
            ))}
          </ol>
        </motion.button>
        <div className="grid grid-cols-2 gap-4">
          {kpis.map((k, i) => (
            <motion.button key={k.label} {...rise(4 + i)} onClick={() => openTab(k.tab)} className={`${card} text-left hover:border-black`}>
              <p className={kicker}>{k.label}</p>
              <p className="text-3xl font-bold tabular-nums">{k.value}</p>
              <p className="text-base text-neutral-600">{k.note}</p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 4. What needs attention: three lines each */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Attention i={8} title="places the file disagrees" count={conflicts.data.length} onOpen={() => openTab("conflicts")}
          rows={conflicts.data.slice(0, 3).map((x) => ({ main: x.topic }))} />
        <Attention i={9} title="things not yet done" count={notDone.data.length} onOpen={() => openTab("not_done")}
          rows={notDone.data.slice(0, 3).map((x) => ({ main: x.what, side: `${x.daysOpen} days` }))} />
        <Attention i={10} title="requests still open" count={openItems.data.length} onOpen={() => openTab("open_items")}
          rows={chased.slice(0, 3).map((x) => ({ main: `${x.waitingOn.split(/[ ,]+/).slice(0, 2).join(" ")}: ${x.what}`, side: x.asks > 1 ? `asked ${x.asks} times` : `${x.daysOpen} days` }))} />
      </div>

      {/* 5. Everything else is one click away */}
      <div className="flex flex-wrap items-center gap-2 pb-20">
        <span className="mr-1 text-neutral-600">More:</span>
        {[["top_ten", "Entries that matter"], ["providers", "Providers"], ["replay", "Play the case replay"]].map(([id, label]) => (
          <button key={id} onClick={() => openTab(id)} className="rounded-full border border-black bg-white px-4 py-1.5 font-semibold hover:bg-neutral-100">{label}</button>
        ))}
        <button onClick={allTiles} className="rounded-full border border-neutral-400 bg-white px-4 py-1.5 text-neutral-700 hover:bg-neutral-100">All tiles</button>
      </div>
    </div>
  );
}
