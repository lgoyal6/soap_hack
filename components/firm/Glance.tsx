// Owner: Tijil. The first thing the attorney sees: who the client is, what happened, what was injured,
// and how the client is likely to hold up as a witness. Everything here is read from the case file.
"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Matter, SourceRef, Summary } from "@/lib/contracts";
import ClientPhoto from "./ClientPhoto";

type Sourced = { text: string; source: SourceRef } | null;
type GlanceData = {
  client: { name: string; dateOfBirth: string | null; age: number | null; employer: string | null; title: string | null };
  accident: { date: string | null; daysSince: number | null; dateSource: SourceRef | null; location: Sourced; summary: Sourced; liability: Sourced };
};
type Witness = { id: string; kind: "concern" | "strength"; label: string; quotes: { quote: string; date: string | null; source: SourceRef }[] };
export type Injury = { bodyPart: string; findings: { quote: string; source: SourceRef }[] };

// Where each body region sits on the figure (front view; the figure's left side is the viewer's right).
// A keyword-to-region table: nothing here is specific to any case.
const REGIONS: { key: string; words: RegExp; at: (side: "left" | "right" | "both") => [number, number][] }[] = [
  { key: "head", words: /head|brain|skull|concuss|tbi|cranial|parietal/i, at: () => [[60, 20]] },
  { key: "neck", words: /neck|cervical|c\d-/i, at: () => [[60, 44]] },
  { key: "shoulder", words: /shoulder|rotator|labr|glenoid|infraspinatus|biceps/i, at: (s) => (s === "left" ? [[84, 60]] : s === "right" ? [[36, 60]] : [[36, 60], [84, 60]]) },
  { key: "chest", words: /chest|rib|sternum|thorac/i, at: () => [[60, 82]] },
  { key: "back", words: /back|lumbar|spine|spinal|l\d-|sacr/i, at: () => [[60, 118]] },
  { key: "elbow", words: /elbow/i, at: (s) => (s === "left" ? [[92, 100]] : s === "right" ? [[28, 100]] : [[28, 100], [92, 100]]) },
  { key: "wrist", words: /wrist|hand|finger/i, at: (s) => (s === "left" ? [[98, 136]] : s === "right" ? [[22, 136]] : [[22, 136], [98, 136]]) },
  { key: "hip", words: /hip|pelvi/i, at: (s) => (s === "left" ? [[72, 140]] : s === "right" ? [[48, 140]] : [[48, 140], [72, 140]]) },
  { key: "knee", words: /knee|menisc|patell/i, at: (s) => (s === "left" ? [[72, 192]] : s === "right" ? [[48, 192]] : [[48, 192], [72, 192]]) },
  { key: "ankle", words: /ankle|foot|talus|heel/i, at: (s) => (s === "left" ? [[72, 240]] : s === "right" ? [[48, 240]] : [[48, 240], [72, 240]]) },
];

function spots(injuries: Injury[]): [number, number][] {
  const out: [number, number][] = [];
  for (const inj of injuries) {
    const text = `${inj.bodyPart} ${inj.findings.map((f) => f.quote).join(" ")}`;
    const side = /\b(both|bilateral)\b/i.test(text) || (/\bleft\b/i.test(inj.bodyPart) && /\bright\b/i.test(inj.bodyPart)) ? "both"
      : /\bleft\b/i.test(inj.bodyPart) ? "left" : /\bright\b/i.test(inj.bodyPart) ? "right" : "both";
    for (const r of REGIONS) if (r.words.test(inj.bodyPart)) out.push(...r.at(side));
  }
  return [...new Map(out.map((p) => [p.join(","), p])).values()];
}

const LABEL: Record<string, string> = { head: "Head and brain", neck: "Neck", shoulder: "Shoulders", chest: "Chest", back: "Back and spine", elbow: "Elbows", wrist: "Wrists and hands", hip: "Hips", knee: "Knees", ankle: "Ankles and feet" };
export const isPrior = (inj: Injury) => /\bprior\b|pre-?existing|variant|developmental/i.test(inj.bodyPart);

/** One line per body region, with which side and the quotes behind it. Prior or developmental findings are kept apart. */
export function byRegion(injuries: Injury[]) {
  const out = new Map<string, { label: string; sides: Set<string>; findings: Injury["findings"] }>();
  for (const inj of injuries) {
    // Findings that name no recognisable body region stay out of this short list (the full injuries section has them).
    for (const r of REGIONS.filter((r) => r.words.test(inj.bodyPart))) {
      const g = out.get(r.key) ?? out.set(r.key, { label: LABEL[r.key] ?? inj.bodyPart, sides: new Set(), findings: [] }).get(r.key)!;
      if (/\bleft\b/i.test(inj.bodyPart)) g.sides.add("left");
      if (/\bright\b/i.test(inj.bodyPart)) g.sides.add("right");
      g.findings.push(...inj.findings);
    }
  }
  // Most-documented regions first.
  return [...out.values()].sort((a, b) => b.findings.length - a.findings.length);
}

export function BodyMap({ injuries }: { injuries: Injury[] }) {
  const marks = spots(injuries);
  return (
    <svg viewBox="0 0 120 260" className="h-56 w-auto shrink-0" role="img" aria-label="Body figure with the injured areas marked">
      <g fill="#e5e5e5" stroke="#a3a3a3" strokeWidth="1.5">
        <circle cx="60" cy="20" r="14" />
        <rect x="52" y="34" width="16" height="12" rx="4" />
        <rect x="34" y="46" width="52" height="92" rx="16" />
        <rect x="20" y="52" width="14" height="88" rx="7" />
        <rect x="86" y="52" width="14" height="88" rx="7" />
        <rect x="40" y="132" width="17" height="116" rx="8" />
        <rect x="63" y="132" width="17" height="116" rx="8" />
      </g>
      {marks.map(([x, y], i) => (
        <g key={i}>
          <motion.circle cx={x} cy={y} r="9" fill="#dc2626" opacity="0.3" animate={{ r: [8, 14, 8], opacity: [0.35, 0.08, 0.35] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.15 }} />
          <motion.circle cx={x} cy={y} r="5" fill="#dc2626" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.12, type: "spring" }} />
        </g>
      ))}
    </svg>
  );
}

export function ago(days: number | null) {
  if (days === null) return "";
  const y = Math.floor(days / 365.25), m = Math.floor((days - y * 365.25) / 30.44);
  return [y ? `${y} year${y > 1 ? "s" : ""}` : "", m ? `${m} month${m > 1 ? "s" : ""}` : "", !y && !m ? `${days} days` : ""].filter(Boolean).join(" ") + " ago";
}
const longDate = (iso: string | null) => (iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "not found");

const Src = ({ r, open, label = "source" }: { r: SourceRef | null | undefined; open: (r: SourceRef) => void; label?: string }) =>
  r ? <button onClick={() => open(r)} className="ml-2 rounded border border-blue-700 px-1.5 align-middle text-sm font-medium text-blue-800 hover:bg-blue-50">{label}</button> : null;

const card = "rounded-2xl border border-neutral-300 bg-white p-6 shadow-sm";
const kicker = "mb-2 text-sm font-semibold uppercase tracking-widest text-neutral-500";
const rise = (i: number) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: i * 0.12 } });

export default function Glance({ matter, header, injuries, lastContact, open }: {
  matter: Matter; header: Summary["header"]; injuries: Injury[]; lastContact: string; open: (r: SourceRef) => void;
}) {
  const [data, setData] = useState<{ glance: GlanceData | null; witness: Witness[] }>({ glance: null, witness: [] });
  useEffect(() => {
    fetch(`/api/case/glance?matterId=${matter.id}`).then((r) => r.json()).then((d) => d && Array.isArray(d.witness) && setData(d)).catch(() => {});
  }, [matter.id]);
  const g = data.glance;
  const concerns = data.witness.filter((w) => w.kind === "concern");
  const strengths = data.witness.filter((w) => w.kind === "strength");
  const name = header.clientName || matter.client;
  const claimed = injuries.filter((i) => !isPrior(i));
  const prior = injuries.filter(isPrior);

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Client */}
        <motion.section {...rise(0)} className={card}>
          <p className={kicker}>The client</p>
          <div className="flex items-center gap-4">
            <ClientPhoto documentId={header.photoDocumentId} name={name} />
            <div>
              <h1 className="text-3xl font-bold leading-tight">{name}</h1>
              {g?.client.age !== null && g?.client.age !== undefined && <p className="text-xl">{g.client.age} years old</p>}
              {(g?.client.title || g?.client.employer) && <p className="text-neutral-700">{[g?.client.title, g?.client.employer].filter(Boolean).join(", ")}</p>}
            </div>
          </div>
          <p className="mt-4"><b>Stage:</b> {header.stage ?? "not set"} &nbsp;·&nbsp; <b>Status:</b> {matter.status ?? "not set"}</p>
          <p><b>Last spoke to the client:</b> {lastContact}<Src r={header.lastClientContact?.sources[0]} open={open} /></p>
          {data.witness.length > 0 && (
            <button onClick={() => document.getElementById("sec-witness")?.scrollIntoView({ behavior: "smooth" })} className="mt-3 rounded-full border border-black px-4 py-1.5 font-semibold hover:bg-neutral-100">
              As a witness: {concerns.length} concern{concerns.length === 1 ? "" : "s"}, {strengths.length} in the client&rsquo;s favour
            </button>
          )}
        </motion.section>

        {/* Accident */}
        <motion.section {...rise(1)} className={card}>
          <p className={kicker}>The accident</p>
          <p className="text-3xl font-bold leading-tight">{longDate(g?.accident.date ?? null)}<Src r={g?.accident.dateSource} open={open} /></p>
          <p className="text-xl text-neutral-700">{ago(g?.accident.daysSince ?? null)}</p>
          {g?.accident.location && <p className="mt-3"><b>Where:</b> {g.accident.location.text}<Src r={g.accident.location.source} open={open} /></p>}
          {g?.accident.summary && <p className="mt-2 text-xl">{g.accident.summary.text}<Src r={g.accident.summary.source} open={open} /></p>}
          {g?.accident.liability && <p className="mt-2"><b>Liability:</b> {g.accident.liability.text}<Src r={g.accident.liability.source} open={open} /></p>}
          {!g && <p className="text-neutral-600">Read from Clio to fill this in.</p>}
        </motion.section>

        {/* Injuries */}
        <motion.section {...rise(2)} className={card}>
          <p className={kicker}>The injuries</p>
          <div className="flex gap-4">
            <BodyMap injuries={claimed} />
            <ul className="min-w-0 flex-1 space-y-2">
              {claimed.length === 0 && <li className="text-neutral-600">None extracted yet.</li>}
              {byRegion(claimed).map((g) => (
                <li key={g.label} className="text-xl">
                  <b>{g.label}</b>{g.sides.size === 1 && <span className="text-neutral-700"> ({[...g.sides][0]})</span>}
                  {g.findings.slice(0, 2).map((f, i) => <Src key={i} r={f.source} open={open} label={`source ${i + 1}`} />)}
                </li>
              ))}
              {prior.length > 0 && (
                <li className="mt-2 rounded bg-amber-50 p-2 text-base">
                  <b>Earlier or developmental findings in the file:</b> {prior.map((p) => p.bodyPart).join(", ")}
                  {prior.slice(0, 3).map((p, i) => <Src key={i} r={p.findings[0]?.source} open={open} label={`source ${i + 1}`} />)}
                </li>
              )}
            </ul>
          </div>
        </motion.section>
      </div>

      {/* The client as a witness */}
      {data.witness.length > 0 && (
        <motion.section id="sec-witness" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.45 }} className={`${card} scroll-mt-4`}>
          <h2 className="mb-1 text-2xl font-semibold">The client as a witness</h2>
          <p className="mb-4 text-base text-neutral-600">Drawn only from this case file: what the records show, in their own words. Not a judgement of the person.</p>
          <div className="grid gap-5 md:grid-cols-2">
            {[{ title: "Concerns to prepare for", list: concerns, tone: "border-red-700 bg-red-50" }, { title: "In the client's favour", list: strengths, tone: "border-green-700 bg-green-50" }].map((col) => (
              <div key={col.title}>
                <h3 className="mb-2 text-xl font-semibold">{col.title} ({col.list.length})</h3>
                {col.list.length === 0 && <p className="text-neutral-600">None found in the records read.</p>}
                {col.list.map((w) => (
                  <div key={w.id} className={`mb-3 rounded border-l-4 p-3 ${col.tone}`}>
                    <b>{w.label}</b>
                    {w.quotes.slice(0, 3).map((qt, i) => <p key={i} className="mt-1 text-base">&ldquo;{qt.quote}&rdquo;<Src r={qt.source} open={open} /></p>)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </motion.section>
      )}
    </>
  );
}
