// Owner: Tijil. A glowing orb for the voice paralegal: calm when idle, red ripples while listening,
// spinning while thinking, pulsing while speaking. Click it to open or close the conversation panel.
// The panel (Laksh's VoiceDock) stays mounted when closed, so holding space still works.
"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

type Status = "idle" | "listening" | "thinking" | "speaking";
const LABEL: Record<Status, string> = { idle: "Hold space and ask", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

export default function VoiceOrb({ children, above }: { children: React.ReactNode; above?: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");

  // The dock shows its state as text; read it from there rather than reaching into its code.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const read = () => {
      const t = el.innerText;
      const next: Status = /Listening \.\.\./.test(t) ? "listening" : /Speaking \.\.\./.test(t) ? "speaking" : /Hold space to talk/.test(t) ? "idle" : "thinking";
      setStatus(next);
      if (next !== "idle") setOpen(true);
    };
    const obs = new MutationObserver(read);
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, []);

  const live = status !== "idle";
  const halo = status === "listening" ? "#ef4444" : status === "speaking" ? "#22c55e" : "#6366f1";

  return (
    <div className="fixed bottom-5 right-5 z-20 flex max-w-md flex-col items-end gap-3">
      {above}
      <div ref={panel} className={`${open ? "" : "hidden"} max-h-[55vh] w-full overflow-y-auto rounded-2xl border border-neutral-300 bg-white/95 p-4 shadow-2xl backdrop-blur`}>
        {children}
      </div>
      <button onClick={() => setOpen((o) => !o)} aria-label={open ? "Hide the paralegal" : "Open the paralegal"} className="flex items-center gap-3 rounded-full bg-neutral-900 py-2 pl-5 pr-2 text-white shadow-xl">
        <span className="text-lg font-semibold">{LABEL[status]}</span>
        <span className="relative h-14 w-14">
          <motion.span className="absolute -inset-2 rounded-full blur-lg" style={{ background: halo }}
            animate={{ scale: live ? [1, 1.35, 1] : [1, 1.12, 1], opacity: live ? [0.55, 0.9, 0.55] : [0.3, 0.5, 0.3] }}
            transition={{ duration: status === "listening" ? 0.7 : status === "speaking" ? 0.5 : 2.6, repeat: Infinity, ease: "easeInOut" }} />
          <motion.span className="absolute inset-0 rounded-full"
            style={{ background: "conic-gradient(from 0deg, #60a5fa, #a78bfa, #f472b6, #34d399, #60a5fa)" }}
            animate={{ rotate: 360 }} transition={{ duration: status === "thinking" ? 1.2 : 7, repeat: Infinity, ease: "linear" }} />
          <span className="absolute inset-[5px] rounded-full bg-neutral-900/70 backdrop-blur" />
          <motion.span className="absolute inset-[18px] rounded-full bg-white"
            animate={{ scale: status === "speaking" ? [0.7, 1.25, 0.85, 1.1, 0.7] : status === "listening" ? [0.9, 1.15, 0.9] : 1 }}
            transition={{ duration: status === "speaking" ? 0.9 : 0.8, repeat: live ? Infinity : 0 }} />
        </span>
      </button>
    </div>
  );
}
