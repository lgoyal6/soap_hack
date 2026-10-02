// Owner: Laksh. Mounted on the firm page (contract D). Hold space to talk, or type. Answers stream in as
// checked sentences, are spoken one by one, and move the page through the contract C events.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EVENTS, type SectionName, type SourceRef } from "@/lib/contracts";

type Sentence = { text: string; sources: SourceRef[]; section: SectionName | null };
type Line =
  | { kind: "user"; text: string }
  | { kind: "answer"; sentences: Sentence[]; withheld: number; error?: string };
type Draft = { id: number; kind: string; recipient: string | null; body: string; at: string };
type Status = "idle" | "listening" | "thinking" | "speaking";

type Rec = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

const TOOL_LABEL: Record<string, string> = {
  get_summary: "Reading the summary", get_open_items: "Checking open items", get_conflicts: "Checking conflicts",
  get_money: "Checking the money", get_not_done: "Checking what is not done", get_changes: "Checking what changed",
  search_records: "Searching the records", get_related: "Looking up who is involved", get_record: "Opening a record",
  list_providers: "Listing providers", get_timeline: "Reading the timeline", show: "Showing it on the page",
  play_replay: "Starting the replay", create_draft: "Saving a draft",
};

const fire = (name: string, detail: object) => window.dispatchEvent(new CustomEvent(name, { detail }));

export default function VoiceDock({ matterId }: { matterId: number }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [doing, setDoing] = useState("");
  const [caption, setCaption] = useState("");
  const [speak, setSpeak] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [now, setNow] = useState<string | null>(null);
  const [micNote, setMicNote] = useState("");

  const ctrl = useRef<AbortController | null>(null);
  const queue = useRef<Sentence[]>([]);
  const playing = useRef(false);
  const streaming = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const ttsOk = useRef<boolean | null>(null);
  const turn = useRef<{ start: number; id: number | null; firstAudio: number | null }>({ start: 0, id: null, firstAudio: null });
  const rec = useRef<Rec | null>(null);
  const heard = useRef("");
  const held = useRef(false);
  const speakRef = useRef(speak);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => { speakRef.current = speak; }, [speak]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [lines, caption]);
  useEffect(() => {
    fetch(`/api/voice/drafts?matterId=${matterId}`).then((r) => (r.ok ? r.json() : [])).then(setDrafts).catch(() => {});
  }, [matterId]);

  const reportFirstAudio = useCallback(() => {
    const t = turn.current;
    if (t.firstAudio === null) t.firstAudio = Math.round(performance.now() - t.start);
    if (t.id !== null && t.firstAudio !== null) {
      fetch("/api/voice/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turnId: t.id, firstAudioMs: t.firstAudio }) }).catch(() => {});
    }
  }, []);

  /** The page follows the sentence being spoken: chips for its sources, scroll to its section. */
  const present = useCallback((s: Sentence) => {
    setNow(s.text);
    fire(EVENTS.chips, { sources: s.sources });
    if (s.section) fire(EVENTS.show, { section: s.section });
  }, []);

  const settle = useCallback(() => {
    if (!playing.current && !queue.current.length && !streaming.current) { setStatus("idle"); setNow(null); setDoing(""); }
  }, []);

  const playNext = useCallback(async () => {
    if (playing.current) return;
    const s = queue.current.shift();
    if (!s) { settle(); return; }
    playing.current = true;
    setStatus("speaking");
    present(s);
    const next = () => { playing.current = false; playNext(); };
    if (ttsOk.current !== false) {
      try {
        const res = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: s.text }), signal: ctrl.current?.signal });
        if (res.status === 200) {
          ttsOk.current = true;
          const a = new Audio(URL.createObjectURL(await res.blob()));
          audio.current = a;
          a.onplay = reportFirstAudio;
          a.onended = next;
          a.onerror = next;
          await a.play();
          return;
        }
        ttsOk.current = false;
      } catch {
        if (!playing.current) return; // interrupted
        ttsOk.current = false;
      }
    }
    if (!playing.current) return;
    if (!("speechSynthesis" in window)) { next(); return; }
    const u = new SpeechSynthesisUtterance(s.text);
    // Use the most natural English voice this browser has, instead of its default (often the most robotic one).
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    const prefer = [/premium|enhanced|natural/i, /Google US English/i, /Samantha|Ava|Allison|Zoe|Karen|Moira|Serena/i];
    const voice = prefer.map((re) => voices.find((v) => re.test(v.name))).find(Boolean) ?? voices.find((v) => v.lang === "en-US");
    if (voice) u.voice = voice;
    u.rate = 0.98;
    u.pitch = 1.05;
    u.onstart = reportFirstAudio;
    u.onend = next;
    u.onerror = next;
    window.speechSynthesis.speak(u);
  }, [present, reportFirstAudio, settle]);

  /** Space while it talks or thinks: stop speaking and abort the request. */
  const stop = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    streaming.current = false;
    queue.current = [];
    playing.current = false;
    if (audio.current) { audio.current.onended = null; audio.current.pause(); audio.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStatus("idle");
    setNow(null);
    setDoing("");
  }, []);

  const ask = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message) return;
    stop();
    const c = new AbortController();
    ctrl.current = c;
    streaming.current = true;
    turn.current = { start: performance.now(), id: null, firstAudio: null };
    setLines((l) => [...l, { kind: "user", text: message }, { kind: "answer", sentences: [], withheld: 0 }]);
    setStatus("thinking");
    const patch = (fn: (a: Extract<Line, { kind: "answer" }>) => Extract<Line, { kind: "answer" }>) =>
      setLines((l) => { const last = l.at(-1); return last?.kind === "answer" ? [...l.slice(0, -1), fn(last)] : l; });

    try {
      const res = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matterId, message }), signal: c.signal });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!raw.trim()) continue;
          const e = JSON.parse(raw);
          if (e.type === "sentence") {
            const s: Sentence = { text: e.text, sources: e.sources ?? [], section: e.section ?? null };
            patch((a) => ({ ...a, sentences: [...a.sentences, s] }));
            if (speakRef.current) { queue.current.push(s); playNext(); } else present(s);
          } else if (e.type === "dropped") patch((a) => ({ ...a, withheld: a.withheld + 1 }));
          else if (e.type === "tool") setDoing(TOOL_LABEL[e.name] ?? "Working");
          else if (e.type === "show") fire(EVENTS.show, { section: e.section, source: e.source });
          else if (e.type === "replay") fire(EVENTS.replay, { from: e.from, to: e.to });
          else if (e.type === "draft") { setDrafts((d) => [e.draft, ...d]); setShowDrafts(true); }
          else if (e.type === "error") patch((a) => ({ ...a, error: e.message }));
          else if (e.type === "done") { turn.current.id = e.turnId; if (turn.current.firstAudio !== null) reportFirstAudio(); }
        }
      }
    } catch (err) {
      if (!c.signal.aborted) patch((a) => ({ ...a, error: (err as Error).message }));
    } finally {
      if (ctrl.current === c) { streaming.current = false; setDoing(""); settle(); }
    }
  }, [matterId, playNext, present, reportFirstAudio, settle, stop]);

  // Hold space to talk (Chrome speech recognition). Ignored while typing in a field.
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault(); // also stops a focused button from being pressed
      if (e.repeat) return;
      held.current = true;
      stop();
      const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
      const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
      if (!SR) { setMicNote("Speech input needs Chrome. Type your question instead."); return; }
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      heard.current = "";
      r.onresult = (ev) => {
        heard.current = Array.from(ev.results).map((x) => x[0].transcript).join(" ");
        setCaption(heard.current);
      };
      r.onerror = (ev) => { if (ev.error !== "aborted" && ev.error !== "no-speech") setMicNote(`Microphone: ${ev.error}. Type instead.`); };
      r.onend = () => {
        rec.current = null;
        setCaption("");
        const said = heard.current.trim();
        heard.current = "";
        if (said) ask(said); else setStatus("idle");
      };
      rec.current = r;
      setMicNote("");
      setStatus("listening");
      try { r.start(); } catch { setStatus("idle"); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held.current) return;
      e.preventDefault();
      held.current = false;
      rec.current?.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [ask, stop]);

  useEffect(() => () => stop(), [stop]);

  async function newThread() {
    stop();
    setLines([]);
    await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matterId, reset: true }) });
  }

  const statusText = { idle: "Hold space to talk, or type", listening: "Listening ... release space to ask", thinking: doing || "Thinking ...", speaking: "Speaking ... press space to stop" }[status];

  return (
    <div className="w-full text-base text-black">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`inline-block h-3 w-3 rounded-full ${status === "listening" ? "animate-pulse bg-red-600" : status === "idle" ? "bg-neutral-400" : "animate-pulse bg-green-600"}`} />
        <b>Paralegal</b>
        <span className="text-neutral-700">{statusText}</span>
        <span className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1"><input type="checkbox" checked={speak} onChange={(e) => { setSpeak(e.target.checked); if (!e.target.checked) { queue.current = []; if ("speechSynthesis" in window) window.speechSynthesis.cancel(); audio.current?.pause(); playing.current = false; } }} /> Speak</label>
          <button onClick={() => setShowDrafts(!showDrafts)} className="underline">Drafts ({drafts.length})</button>
          {lines.length > 0 && <button onClick={newThread} className="underline">New conversation</button>}
          {status !== "idle" && <button onClick={stop} className="rounded border border-black px-2 py-0.5 font-semibold">Stop</button>}
        </span>
      </div>

      {(lines.length > 0 || caption) && (
        <div ref={scroller} className="mb-2 max-h-56 space-y-2 overflow-y-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-lg" aria-live="polite">
          {lines.map((l, i) => l.kind === "user"
            ? <p key={i} className="font-semibold">You: {l.text}</p>
            : (
              <div key={i}>
                {l.sentences.map((s, j) => (
                  <span key={j} className={now === s.text ? "bg-yellow-100" : ""}>
                    {s.text}
                    {s.sources.slice(0, 3).map((r, k) => (
                      <button key={k} onClick={() => fire(EVENTS.show, { source: r })} className="mx-0.5 rounded border border-neutral-400 px-1 align-middle text-xs text-neutral-700 hover:border-black">
                        {r.resource.replace(/_/g, " ").replace(/s$/, "")}{r.pageNo ? ` p${r.pageNo}` : ""}
                      </button>
                    ))}{" "}
                  </span>
                ))}
                {l.withheld > 0 && <p className="text-sm text-neutral-600">{l.withheld === 1 ? "One sentence was" : "Some sentences were"} withheld: it stated a number no record supports.</p>}
                {l.error && <p className="text-sm text-red-700">{l.error}</p>}
              </div>
            ))}
          {caption && <p className="italic text-neutral-600">{caption}</p>}
        </div>
      )}

      {lines.length === 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span>Want the one-minute brief?</span>
          <button onClick={() => ask("Brief me on this case in about a minute, then tell me what changed since I last looked.")} className="rounded bg-black px-3 py-1 font-semibold text-white">Brief me</button>
          <button onClick={() => ask("What changed since I last looked?")} className="rounded border border-black px-3 py-1 font-semibold">What changed</button>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); const t = input; setInput(""); ask(t); }} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about the case, or ask for a draft" aria-label="Ask the paralegal" className="flex-1 rounded border border-neutral-400 px-3 py-1.5 text-lg" />
        <button className="rounded bg-black px-4 py-1.5 font-semibold text-white">Ask</button>
      </form>
      {micNote && <p className="mt-1 text-sm text-neutral-700">{micNote}</p>}

      {showDrafts && (
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto border-t border-neutral-200 pt-2">
          {drafts.length === 0 && <p className="text-neutral-600">No drafts yet. Ask for one, for example &ldquo;draft a follow-up to the therapist&rdquo;.</p>}
          {drafts.map((d) => (
            <div key={d.id} className="rounded border border-neutral-300 p-2">
              <div className="mb-1 flex items-center gap-2 text-sm text-neutral-700">
                <b>{d.kind.replace(/_/g, " ")}</b>{d.recipient ? ` to ${d.recipient}` : ""} · {new Date(d.at).toLocaleString()} · not sent
                <button onClick={() => navigator.clipboard?.writeText(d.body)} className="ml-auto rounded border border-black px-2 font-semibold text-black">Copy</button>
              </div>
              <p className="whitespace-pre-wrap">{d.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
