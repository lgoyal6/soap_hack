// Owner: Tijil. Shows only the client's face, cropped out of the photo-ID picture.
// Until the face has been located, shows initials: the full ID is never displayed.
"use client";

import { useEffect, useState } from "react";

type Box = { x: number; y: number; w: number; h: number };
const SIZE = 112;

export default function ClientPhoto({ documentId, name }: { documentId: number | null; name: string }) {
  const [box, setBox] = useState<Box | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const src = documentId ? `/api/case/photo?documentId=${documentId}` : null;

  useEffect(() => {
    if (!src) return;
    fetch(`${src}&box=1`).then((r) => (r.ok ? r.json() : null)).then((b) => b && typeof b.w === "number" && setBox(b)).catch(() => {});
  }, [src]);

  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const frame = "relative shrink-0 overflow-hidden rounded-full border border-neutral-300 bg-neutral-200";

  // A square crop centred on the face box, in the picture's own pixels.
  let style: React.CSSProperties | null = null;
  if (box && dims) {
    const side = Math.max(box.w * dims.w, box.h * dims.h);
    const left = box.x * dims.w + (box.w * dims.w - side) / 2;
    const top = box.y * dims.h + (box.h * dims.h - side) / 2;
    const k = SIZE / side;
    style = { position: "absolute", width: dims.w * k, height: dims.h * k, left: -left * k, top: -top * k, maxWidth: "none" };
  }

  return (
    <div className={frame} style={{ width: SIZE, height: SIZE }} aria-label={`Photo of ${name}`}>
      {src && box && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} style={style ?? { opacity: 0, position: "absolute" }} />
      )}
      {!style && <span className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-neutral-600">{initials}</span>}
    </div>
  );
}
