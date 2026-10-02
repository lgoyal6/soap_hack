// Owner: Tijil. Rebuilds the cached sections for every synced matter. Firm users only.
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { processMatter } from "@/lib/pipeline/process";
import { getSession } from "@/lib/session";

export const maxDuration = 300;

export async function POST() {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 401 });
  const matters = await q<{ clio_id: string }>("SELECT clio_id FROM raw_records WHERE resource = 'matters'");
  const out: Record<string, unknown> = {};
  for (const m of matters) {
    try { out[m.clio_id] = await processMatter(Number(m.clio_id)); } catch (e) { out[m.clio_id] = { error: String(e) }; }
  }
  return NextResponse.json(out);
}
