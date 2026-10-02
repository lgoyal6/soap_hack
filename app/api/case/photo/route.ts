// Owner: Tijil. The client's face, taken from the photo-ID document on the matter. Firm users only.
//   GET ?documentId=..        the picture inside the document, as a JPEG
//   GET ?documentId=..&box=1  where the face is in that picture, as fractions {x, y, w, h}
// The page crops to the face so the rest of the ID (number, address, date of birth) is never shown.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { clioDownload } from "@/lib/clio";
import { q } from "@/lib/db";
import { chat } from "@/lib/llm";
import { embeddedJpeg } from "@/lib/pipeline/scan";
import { firmOnly } from "@/lib/tools/guard";

const cache = new Map<number, Uint8Array | null>();

async function picture(documentId: number): Promise<Uint8Array | null> {
  if (!cache.has(documentId)) {
    const doc = await PDFDocument.load(await clioDownload(documentId), { ignoreEncryption: true });
    cache.set(documentId, embeddedJpeg(doc, 0));
  }
  return cache.get(documentId) ?? null;
}

type Box = { x: number; y: number; w: number; h: number };
const BOX_PROMPT = `This is a photo identity document. Find the main portrait photo of the person's face on it.
Return only JSON {"x": 0, "y": 0, "w": 0, "h": 0}: the left edge, top edge, width and height of a box around the head and shoulders, each as a fraction of the image between 0 and 1.`;

export async function GET(req: Request) {
  const { deny } = await firmOnly();
  if (deny) return deny;
  const p = new URL(req.url).searchParams;
  const id = Number(p.get("documentId"));
  if (!id) return NextResponse.json({ error: "documentId required" }, { status: 400 });
  try {
    const jpeg = await picture(id);
    if (!jpeg) return NextResponse.json({ error: "no picture found in the document" }, { status: 404 });
    if (!p.get("box")) return new NextResponse(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });

    // The face box is found once per picture and stored.
    const name = `photo_box:${id}`, hash = createHash("sha256").update(jpeg).digest("hex");
    const [row] = await q<{ data: Box }>("SELECT data FROM sections WHERE matter_id = 0 AND name = $1 AND input_hash = $2", [name, hash]);
    if (row) return NextResponse.json(row.data, { headers: { "Cache-Control": "no-store" } });
    const res = await chat("photo_box", {
      temperature: 0,
      messages: [{ role: "user", content: [{ type: "text", text: BOX_PROMPT }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` } }] }],
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const b = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Box;
    const ok = [b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && n >= 0 && n <= 1) && b.w > 0.02 && b.h > 0.02;
    if (!ok) return NextResponse.json({ error: "no face found" }, { status: 404 });
    await q(
      `INSERT INTO sections (matter_id, name, data, input_hash) VALUES (0, $1, $2, $3)
       ON CONFLICT (matter_id, name) DO UPDATE SET data = $2, input_hash = $3, built_at = now()`,
      [name, JSON.stringify(b), hash],
    );
    return NextResponse.json(b, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
