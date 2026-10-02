// Owner: Tijil. Case replay: an animation drawn only from the dated records of the case.
// Same events in, same animation out. The voice agent can start it with the "casebrief:replay" event.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EVENTS } from "@/lib/contracts";
import type { Lane, ReplayDetail, SourceRef, TimelineEvent } from "@/lib/contracts";

const LANES: { lane: Lane; label: string; color: string }[] = [
  { lane: "medical", label: "Medical", color: "#b91c1c" },
  { lane: "legal", label: "Legal", color: "#1d4ed8" },
  { lane: "money", label: "Money", color: "#15803d" },
  { lane: "communications", label: "Communications", color: "#7c3aed" },
];
const W = 1000, LEFT = 150, RIGHT = 20, ROW = 46, TOP = 30;
const SECONDS = 14;
const t = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function Replay({ events, coverage, open }: { events: TimelineEvent[]; coverage: number; open: (r: SourceRef) => void }) {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const shown = useMemo(
    () => events.filter((e) => (!range.from || e.date >= range.from) && (!range.to || e.date <= range.to)).sort((a, b) => a.date.localeCompare(b.date)),
    [events, range],
  );
  const start = shown.length ? t(shown[0].date) : 0;
  const end = shown.length ? Math.max(t(shown[shown.length - 1].date), start + 86_400_000) : 1;
  const [progress, setProgress] = useState(1); // 0..1 along the time axis; starts fully drawn
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!playing) return;
    const began = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - began) / (SECONDS * 1000));
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(tick); else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  useEffect(() => {
    const onReplay = (e: Event) => {
      const d = (e as CustomEvent<ReplayDetail>).detail ?? {};
      setRange({ from: d.from, to: d.to });
      box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setProgress(0);
      setPlaying(true);
    };
    window.addEventListener(EVENTS.replay, onReplay);
    return () => window.removeEventListener(EVENTS.replay, onReplay);
  }, []);

  const x = (iso: string) => LEFT + ((t(iso) - start) / (end - start)) * (W - LEFT - RIGHT);
  const nowMs = start + progress * (end - start);
  const visible = shown.filter((e) => t(e.date) <= nowMs);
  const sum = (kind: "firm_cost" | "charge") => visible.filter((e) => (e.amountKind ?? "firm_cost") === kind).reduce((s, e) => s + (e.amount ?? 0), 0);
  const spent = sum("firm_cost");
  const charged = sum("charge");
  const scale = Math.max(Number.isFinite(coverage) ? coverage : 0, shown.filter((e) => e.amountKind === "charge").reduce((s, e) => s + (e.amount ?? 0), 0), 1);
  const latest = visible[visible.length - 1];
  const H = TOP + LANES.length * ROW + 20;

  return (
    <section ref={box} id="sec-replay" className="rounded-lg border border-neutral-300 bg-white p-5">
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <h2 className="text-2xl font-semibold">Case replay</h2>
        <button onClick={() => { setProgress(0); setPlaying(true); }} className="rounded bg-black px-4 py-1.5 font-semibold text-white">{playing ? "Playing ..." : "Play"}</button>
        <span className="tabular-nums">{shown.length ? new Date(nowMs).toISOString().slice(0, 10) : "no dated records"}</span>
        <span className="text-base text-neutral-700">{visible.length} of {shown.length} events</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Timeline of the case in four lanes">
        {LANES.map((l, i) => (
          <g key={l.lane}>
            <text x={0} y={TOP + i * ROW + 6} fontSize={17} fill="#111">{l.label}</text>
            <line x1={LEFT} x2={W - RIGHT} y1={TOP + i * ROW} y2={TOP + i * ROW} stroke="#d4d4d4" />
            {visible.filter((e) => e.lane === l.lane).map((e, j) => (
              <circle key={j} cx={x(e.date)} cy={TOP + i * ROW} r={e === latest ? 9 : 6} fill={l.color} opacity={e === latest ? 1 : 0.65}
                className="cursor-pointer" onClick={() => e.sources[0] && open(e.sources[0])}>
                <title>{`${e.date} ${e.title}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {shown.length > 0 && <line x1={LEFT + progress * (W - LEFT - RIGHT)} x2={LEFT + progress * (W - LEFT - RIGHT)} y1={8} y2={H - 8} stroke="#000" strokeDasharray="4 4" />}
      </svg>
      <p className="min-h-7">{latest ? <><b>{latest.date}</b> &nbsp;{latest.title}</> : "Press Play to watch the case unfold."}</p>
      {/* Charges recorded on the file climbing against the lowest coverage figure found */}
      <div className="relative mt-2 h-7 w-full rounded bg-neutral-200">
        <div className={`h-7 rounded ${Number.isFinite(coverage) && charged > coverage ? "bg-red-700" : "bg-green-700"}`} style={{ width: `${Math.min(100, (charged / scale) * 100)}%` }} />
        {Number.isFinite(coverage) && <div className="absolute top-0 h-7 border-l-4 border-black" style={{ left: `${Math.min(100, (coverage / scale) * 100)}%` }} title="Lowest coverage figure in the file" />}
      </div>
      <p className="mt-1 text-base text-neutral-700">
        Charges recorded on the file so far: <b>{usd(charged)}</b>
        {Number.isFinite(coverage) && <> &nbsp;·&nbsp; black line: lowest coverage figure in the file, <b>{usd(coverage)}</b></>}
        &nbsp;·&nbsp; firm's own costs so far: <b>{usd(spent)}</b>
      </p>
    </section>
  );
}
