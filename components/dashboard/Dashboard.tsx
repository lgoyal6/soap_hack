// Owner: Laksh. Widget home: every section of the brief as a tile on one screen. Clicking a tile opens it as a tab.
// "Customise" shows, hides and reorders tiles (saved in this browser). The voice paralegal lives in its own tile
// and moves this page through the contract C events: a section opens its tab, a source opens the side panel.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Injury } from "@/components/firm/Glance";
import VoiceOrb from "@/components/firm/VoiceOrb";
import VoiceDock from "@/components/voice/VoiceDock";
import Home90 from "./Home90";
import { EVENTS, type Change, type OpenItem, type RecordDetail, type ShowDetail, type SourceRef, type ToolResult } from "@/lib/contracts";
import type { TopEntry } from "@/lib/pipeline/rank";
import type { SharePanelData } from "@/lib/portal/types";
import { SECTION_TO_WIDGET, WIDGETS, type Ctx, type DashData } from "./widgets";

const STORE = "casebrief.dashboard.v1";
type Layout = { order: string[]; hidden: string[] };
const DEFAULT: Layout = { order: WIDGETS.map((w) => w.id), hidden: [] };

function loadLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null") as Layout | null;
    if (!raw?.order) return DEFAULT;
    const known = new Set(WIDGETS.map((w) => w.id));
    const order = raw.order.filter((id) => known.has(id));
    // Widgets added after the layout was saved go at the end.
    for (const w of WIDGETS) if (!order.includes(w.id)) order.push(w.id);
    return { order, hidden: (raw.hidden ?? []).filter((id) => known.has(id)) };
  } catch { return DEFAULT; }
}
function saveLayout(l: Layout) {
  try { localStorage.setItem(STORE, JSON.stringify(l)); } catch { /* private window: layout lasts for this visit */ }
}

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark id="dash-quote" className="bg-yellow-200">{text.slice(at, at + quote!.length)}</mark>{text.slice(at + quote!.length)}</>;
}

export default function Dashboard(initial: DashData) {
  const router = useRouter();
  const { matter, matters } = initial;
  const [layout, setLayout] = useState<Layout>(DEFAULT);
  const [editing, setEditing] = useState(false);
  // Home is the ninety-second read; the customisable tile grid is one click away.
  const [grid, setGrid] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string>("home");
  const [source, setSource] = useState<{ ref: SourceRef; detail: RecordDetail | null | undefined } | null>(null);
  const [openItems, setOpenItems] = useState(initial.openItems);
  const [top, setTop] = useState(initial.top);
  const [changes, setChanges] = useState(initial.changes);
  const [since, setSinceState] = useState(initial.since);
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [share, setShare] = useState<SharePanelData | null>(null);
  const [busy, setBusy] = useState("");
  const drag = useRef<string | null>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  // The saved layout lives in this browser only; read it after the first render to keep server and client in step.
  useEffect(() => { const t = setTimeout(() => setLayout(loadLayout()), 0); return () => clearTimeout(t); }, []);
  const update = (l: Layout) => { setLayout(l); saveLayout(l); };

  const api = useCallback(async <T,>(tool: string, extra = ""): Promise<T> => (await fetch(`/api/case/${tool}?matterId=${matter.id}${extra}`)).json(), [matter.id]);

  const open = useCallback(async (ref: SourceRef) => {
    setSource({ ref, detail: undefined });
    const d = await api<RecordDetail | null>("getRecord", `&resource=${encodeURIComponent(ref.resource)}&clioId=${ref.clioId}${ref.pageNo ? `&pageNo=${ref.pageNo}` : ""}`).catch(() => null);
    setSource({ ref, detail: d });
  }, [api]);
  useEffect(() => { if (source?.detail) document.getElementById("dash-quote")?.scrollIntoView({ block: "center" }); }, [source]);

  const openTab = useCallback((id: string) => {
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setActive(id);
  }, []);
  const closeTab = (id: string) => {
    setTabs((t) => t.filter((x) => x !== id));
    setActive((a) => (a === id ? "home" : a));
  };

  // Live data: provider replies (contract E), injuries and the provider summary.
  useEffect(() => {
    const first = setTimeout(() => {
      api<Injury[]>("injuries").then((x) => Array.isArray(x) && setInjuries(x)).catch(() => {});
    }, 0);
    const loadShare = () => fetch(`/api/share?matterId=${matter.id}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setShare(d)).catch(() => {});
    const s0 = setTimeout(loadShare, 0);
    const t = setInterval(async () => {
      setOpenItems(await api<ToolResult<OpenItem[]>>("getOpenItems"));
      loadShare();
    }, 10_000);
    return () => { clearTimeout(first); clearTimeout(s0); clearInterval(t); };
  }, [api, matter.id]);

  // Contract C: the paralegal moves the page.
  useEffect(() => {
    const show = (e: Event) => {
      const d = (e as CustomEvent<ShowDetail>).detail ?? {};
      if (d.section && SECTION_TO_WIDGET[d.section]) openTab(SECTION_TO_WIDGET[d.section]);
      if (d.source) open(d.source);
    };
    const replay = (e: Event) => {
      const d = (e as CustomEvent<{ from?: string; to?: string; again?: boolean }>).detail ?? {};
      if (d.again || activeRef.current === "replay") return; // already mounted: it heard the event itself
      openTab("replay");
      // The replay only listens once its tab is mounted; say it again after it is.
      setTimeout(() => window.dispatchEvent(new CustomEvent(EVENTS.replay, { detail: { ...d, again: true } })), 400);
    };
    window.addEventListener(EVENTS.show, show);
    window.addEventListener(EVENTS.replay, replay);
    return () => { window.removeEventListener(EVENTS.show, show); window.removeEventListener(EVENTS.replay, replay); };
  }, [open, openTab]);

  const rate = useCallback(async (e: TopEntry, action: "pin" | "dismiss") => {
    await fetch("/api/case/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matterId: matter.id, resource: e.resource, clioId: e.clioId, action }) });
    setTop(await api<TopEntry[]>("topTen"));
  }, [api, matter.id]);
  const setSince = useCallback(async (v: string) => { setSinceState(v); setChanges(await api<ToolResult<Change[]>>("getChanges", `&since=${v}`)); }, [api]);

  async function sync() {
    setBusy("Reading from Clio ...");
    await fetch("/api/sync", { method: "POST" });
    setBusy("Building the brief ...");
    await fetch("/api/case/process", { method: "POST" });
    setBusy("");
    router.refresh();
  }

  const c: Ctx = { ...initial, openItems, top, changes, since, injuries, share, open, rate, setSince };
  const byId = useMemo(() => new Map(WIDGETS.map((w) => [w.id, w])), []);
  // The paralegal is no longer a tile: it lives behind the orb at the bottom right of every view.
  const shown = layout.order.filter((id) => !layout.hidden.includes(id) && id !== "voice").map((id) => byId.get(id)!).filter(Boolean);
  const hidden = layout.hidden.map((id) => byId.get(id)!).filter(Boolean);
  const activeWidget = active === "home" ? null : byId.get(active);

  function move(id: string, to: string) {
    if (id === to) return;
    const order = layout.order.filter((x) => x !== id);
    order.splice(order.indexOf(to), 0, id);
    update({ ...layout, order });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-100 text-black">
      {/* Top bar: case, tabs, actions */}
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-300 bg-white px-4 py-2">
        <span className="mr-2 text-lg font-bold">Casebrief</span>
        {matters.length > 1 ? (
          <select value={matter.id} onChange={(e) => router.push(`/dashboard?matter=${e.target.value}`)} className="rounded border border-neutral-300 px-2 py-1">
            {matters.map((m) => <option key={m.id} value={m.id}>{m.client || m.name}</option>)}
          </select>
        ) : <span className="text-neutral-700">{matter.client || matter.name}</span>}
        <nav className="ml-3 flex min-w-0 flex-1 items-end gap-1 overflow-x-auto" role="tablist">
          <button role="tab" aria-selected={active === "home"} onClick={() => setActive("home")} className={`rounded-t px-3 py-1.5 font-semibold ${active === "home" ? "bg-neutral-100" : "text-neutral-600 hover:bg-neutral-50"}`}>Home</button>
          {tabs.map((id) => (
            <span key={id} className={`flex items-center rounded-t ${active === id ? "bg-neutral-100" : "hover:bg-neutral-50"}`}>
              <button role="tab" aria-selected={active === id} onClick={() => setActive(id)} className={`whitespace-nowrap py-1.5 pl-3 pr-1 ${active === id ? "font-semibold" : "text-neutral-600"}`}>{byId.get(id)?.title}</button>
              <button aria-label={`Close ${byId.get(id)?.title}`} onClick={() => closeTab(id)} className="px-2 text-neutral-500 hover:text-black">×</button>
            </span>
          ))}
        </nav>
        {/* Shortcuts to the views that are not on the home screen */}
        {[["top_ten", "Entries that matter"], ["providers", "Providers"], ["replay", "Play the case replay"]].map(([id, label]) => (
          <button key={id} onClick={() => openTab(id)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 font-semibold ${active === id ? "border-black bg-black text-white" : "border-black hover:bg-neutral-100"}`}>{label}</button>
        ))}
        {!(active === "home" && grid) && <button onClick={() => { setActive("home"); setGrid(true); }} className="whitespace-nowrap rounded-full border border-neutral-400 px-3 py-1.5 text-neutral-700 hover:bg-neutral-100">All tiles</button>}
        {active === "home" && grid && <button onClick={() => { setGrid(false); setEditing(false); }} className="rounded border border-black px-3 py-1.5 font-semibold">Back to the brief</button>}
        {active === "home" && grid && <button onClick={() => setEditing(!editing)} className={`rounded px-3 py-1.5 font-semibold ${editing ? "bg-black text-white" : "border border-black"}`}>{editing ? "Done" : "Customise"}</button>}
        <button onClick={sync} disabled={!!busy} className="rounded border border-black px-3 py-1.5 font-semibold disabled:opacity-50">{busy || "Refresh from Clio"}</button>
        <a href="/firm" className="px-2 text-sm text-neutral-600 underline">Classic page</a>
      </header>

      {editing && active === "home" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-300 bg-yellow-50 px-4 py-2 text-sm">
          <span>Drag tiles to reorder. × hides a tile.</span>
          {hidden.length > 0 && <span className="ml-3">Hidden:</span>}
          {hidden.map((w) => <button key={w.id} onClick={() => update({ ...layout, hidden: layout.hidden.filter((x) => x !== w.id) })} className="rounded border border-black bg-white px-2 py-0.5">+ {w.title}</button>)}
          <button onClick={() => update(DEFAULT)} className="ml-auto underline">Reset layout</button>
        </div>
      )}

      <main className="relative min-h-0 flex-1">
        {/* Home: the ninety-second brief. */}
        {active === "home" && !grid && <div className="h-full overflow-y-auto"><Home90 c={c} openTab={openTab} /></div>}

        {/* All tiles: the customisable grid. */}
        <div className={`${active === "home" && grid ? "" : "hidden"} grid h-full auto-rows-[minmax(0,1fr)] grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-2 xl:grid-cols-4`}>
          {shown.map((w) => {
            const isVoice = w.id === "voice";
            const attention = w.alert?.(c);
            return (
              <section
                key={w.id}
                draggable={editing}
                onDragStart={() => { drag.current = w.id; }}
                onDragOver={(e) => editing && e.preventDefault()}
                onDrop={() => { if (drag.current) move(drag.current, w.id); drag.current = null; }}
                onClick={() => !editing && w.Full && openTab(w.id)}
                className={`relative flex min-h-40 flex-col overflow-hidden rounded-xl border bg-white p-3 shadow-sm transition
                  ${w.cols === 2 ? "md:col-span-2" : ""} ${w.rows === 2 ? "xl:row-span-2" : ""}
                  ${attention ? "border-l-4 border-l-red-600 border-neutral-300" : "border-neutral-300"}
                  ${editing ? "cursor-move ring-2 ring-dashed ring-yellow-400" : w.Full ? "cursor-pointer hover:border-black hover:shadow" : ""}`}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">{w.title}</h2>
                  {editing && <button aria-label={`Hide ${w.title}`} onClick={(e) => { e.stopPropagation(); update({ ...layout, hidden: [...layout.hidden, w.id] }); }} className="ml-auto rounded px-1.5 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-black">×</button>}
                  {!editing && w.Full && <span className="ml-auto text-xs text-neutral-400">open ›</span>}
                </div>
                <div className={`min-h-0 flex-1 ${isVoice ? "overflow-y-auto" : "overflow-hidden"}`} onClick={isVoice ? (e) => e.stopPropagation() : undefined}>
                  <w.Tile c={c} />
                </div>
                {!isVoice && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white" />}
              </section>
            );
          })}
        </div>

        {/* Active tab */}
        {activeWidget?.Full && (
          <div className="absolute inset-0 overflow-y-auto p-5">
            <div className="mx-auto max-w-6xl rounded-xl border border-neutral-300 bg-white p-6">
              {!activeWidget.ownTitle && <h1 className="mb-4 text-3xl font-bold">{activeWidget.title}</h1>}
              <activeWidget.Full c={c} />
            </div>
          </div>
        )}

        {/* The voice paralegal, behind the orb, mounted once for every view so hold-space always works. */}
        <VoiceOrb><VoiceDock matterId={matter.id} /></VoiceOrb>

        {/* Source side panel: the record with the quoted words highlighted */}
        {source && (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-xl flex-col border-l border-neutral-300 bg-white shadow-2xl">
            <div className="flex items-center gap-2 border-b border-neutral-200 p-3">
              <h2 className="flex-1 truncate text-lg font-bold">{source.detail?.title ?? (source.detail === null ? "Record not found" : "Loading ...")}</h2>
              <button onClick={() => setSource(null)} className="rounded border border-black px-2 py-0.5 font-semibold">Close</button>
            </div>
            {source.detail && (
              <div className="overflow-y-auto p-4 text-lg leading-relaxed">
                <p className="mb-2 text-sm text-neutral-600">{source.detail.resource.replace(/_/g, " ")}{source.detail.date ? ` · ${source.detail.date}` : ""}{source.detail.pageNo ? ` · page ${source.detail.pageNo}` : ""}</p>
                <p className="whitespace-pre-wrap"><Highlighted text={source.detail.text} quote={source.ref.quote} /></p>
              </div>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
