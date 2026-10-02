// Owner: Tijil. Starts reading the matter's PDFs page by page (POST) and reports progress (GET). Firm users only.
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { scanMatter } from "@/lib/pipeline/scan";
import { getSession } from "@/lib/session";

const running = new Set<number>();

async function progress() {
  const [p] = await q<{ done: string; failed: string; total: string }>(
    "SELECT count(*) FILTER (WHERE status = 'done') AS done, count(*) FILTER (WHERE status = 'failed') AS failed, count(*) AS total FROM scan_pages",
  );
  return { done: Number(p.done), failed: Number(p.failed), total: Number(p.total), running: running.size > 0 };
}

export async function GET() {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 401 });
  return NextResponse.json(await progress());
}

export async function POST() {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 401 });
  const matters = await q<{ clio_id: string }>("SELECT clio_id FROM raw_records WHERE resource = 'matters'");
  for (const m of matters) {
    const id = Number(m.clio_id);
    if (running.has(id)) continue;
    running.add(id);
    // Not awaited: the scan can take minutes. GET reports how far it has got.
    scanMatter(id).catch((e) => console.error("scan failed", e)).finally(() => running.delete(id));
  }
  return NextResponse.json(await progress());
}
