// Owner: Tijil. A small looping illustration of the kind of incident (sideswipe, rear-end, and so on).
// The kind is classified from the firm's own description of the case; the drawing is generic and
// labelled as an illustration, never as a reconstruction.
"use client";

import { motion } from "motion/react";

export type IncidentKind = "sideswipe" | "rear_end" | "head_on" | "intersection" | "pedestrian" | "fall" | "other";

const LABEL: Record<IncidentKind, string> = {
  sideswipe: "Sideswipe", rear_end: "Rear-end collision", head_on: "Head-on collision", intersection: "Intersection collision",
  pedestrian: "Vehicle and pedestrian", fall: "Fall", other: "",
};
const LOOP = { duration: 3.2, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" as const };

function Car({ color, w = 46 }: { color: string; w?: number }) {
  return (
    <g>
      <rect x={0} y={0} width={w} height={22} rx={6} fill={color} />
      <rect x={w * 0.22} y={4} width={w * 0.5} height={14} rx={3} fill="#fff" opacity={0.55} />
    </g>
  );
}

function Burst({ x, y, at }: { x: number; y: number; at: number }) {
  // Appears at the moment of contact.
  return (
    <motion.g style={{ originX: `${x}px`, originY: `${y}px` }} animate={{ opacity: [0, 0, 1, 0], scale: [0.3, 0.3, 1.4, 1.8] }} transition={{ ...LOOP, times: [0, at - 0.02, at + 0.08, 1] }}>
      <polygon points={`${x},${y - 16} ${x + 5},${y - 5} ${x + 16},${y - 6} ${x + 7},${y + 3} ${x + 12},${y + 15} ${x},${y + 7} ${x - 12},${y + 15} ${x - 7},${y + 3} ${x - 16},${y - 6} ${x - 5},${y - 5}`} fill="#f59e0b" stroke="#b45309" strokeWidth={1.5} />
    </motion.g>
  );
}

export default function IncidentScene({ kind }: { kind: IncidentKind | string | null | undefined }) {
  const k = (kind && kind in LABEL ? kind : "other") as IncidentKind;
  if (k === "other") return null;
  const client = "#2563eb", other = "#dc2626";

  return (
    <figure className="mt-2">
      <svg viewBox="0 0 320 96" className="w-full max-w-md rounded-lg bg-neutral-200" role="img" aria-label={`Illustration: ${LABEL[k]}`}>
        {k !== "fall" && <><rect x={0} y={18} width={320} height={60} fill="#525252" /><line x1={0} x2={320} y1={48} y2={48} stroke="#fafafa" strokeWidth={2} strokeDasharray="14 12" /></>}
        {k === "intersection" && <rect x={176} y={0} width={56} height={96} fill="#525252" />}

        {k === "sideswipe" && <>
          <motion.g animate={{ x: [20, 150, 190], y: [52, 52, 56] }} transition={{ ...LOOP, times: [0, 0.6, 1] }}><Car color={client} /></motion.g>
          <motion.g animate={{ x: [50, 170, 200], y: [22, 22, 34], rotate: [0, 0, 8] }} transition={{ ...LOOP, times: [0, 0.5, 1] }}><Car color={other} w={58} /></motion.g>
          <Burst x={210} y={54} at={0.72} />
        </>}

        {k === "rear_end" && <>
          <g transform="translate(200,52)"><Car color={client} /></g>
          <motion.g animate={{ x: [10, 152, 148] }} transition={{ ...LOOP, times: [0, 0.7, 1] }}><g transform="translate(0,52)"><Car color={other} w={54} /></g></motion.g>
          <Burst x={204} y={62} at={0.7} />
        </>}

        {k === "head_on" && <>
          <motion.g animate={{ x: [10, 112, 108] }} transition={{ ...LOOP, times: [0, 0.7, 1] }}><g transform="translate(0,52)"><Car color={client} /></g></motion.g>
          <motion.g animate={{ x: [270, 160, 164] }} transition={{ ...LOOP, times: [0, 0.7, 1] }}><g transform="translate(0,52)"><Car color={other} /></g></motion.g>
          <Burst x={160} y={62} at={0.7} />
        </>}

        {k === "intersection" && <>
          <motion.g animate={{ x: [10, 168, 172] }} transition={{ ...LOOP, times: [0, 0.7, 1] }}><g transform="translate(0,52)"><Car color={client} /></g></motion.g>
          <motion.g animate={{ y: [-30, 26, 28] }} transition={{ ...LOOP, times: [0, 0.7, 1] }}><g transform="translate(214,0) rotate(90)"><Car color={other} /></g></motion.g>
          <Burst x={204} y={54} at={0.7} />
        </>}

        {k === "pedestrian" && <>
          <g transform="translate(214,34)"><circle cx={0} cy={0} r={6} fill="#111" /><line x1={0} y1={6} x2={0} y2={26} stroke="#111" strokeWidth={4} strokeLinecap="round" /></g>
          <motion.g animate={{ x: [10, 150, 146] }} transition={{ ...LOOP, times: [0, 0.7, 1] }}><g transform="translate(0,40)"><Car color={other} /></g></motion.g>
          <Burst x={206} y={50} at={0.7} />
        </>}

        {k === "fall" && <>
          <line x1={20} x2={300} y1={78} y2={78} stroke="#525252" strokeWidth={4} />
          <motion.g style={{ originX: "160px", originY: "78px" }} animate={{ rotate: [0, 0, 78] }} transition={{ ...LOOP, times: [0, 0.4, 1] }}>
            <circle cx={160} cy={28} r={9} fill="#2563eb" /><line x1={160} y1={38} x2={160} y2={76} stroke="#2563eb" strokeWidth={6} strokeLinecap="round" />
          </motion.g>
        </>}
      </svg>
      <figcaption className="mt-1 text-sm text-neutral-600">
        {LABEL[k]} (illustration only){k !== "fall" && <> · <span style={{ color: "#2563eb" }}>blue</span>: client · <span style={{ color: "#dc2626" }}>red</span>: other party</>}
      </figcaption>
    </figure>
  );
}
