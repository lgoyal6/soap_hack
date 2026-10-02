// Owner: Tijil. Serves a document's bytes (used for the client photo). Firm users only.
import { NextResponse } from "next/server";
import { clioDownload } from "@/lib/clio";
import { getSession } from "@/lib/session";

export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("documentId"));
  if (!id) return NextResponse.json({ error: "documentId required" }, { status: 400 });
  try {
    const bytes = await clioDownload(id);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
