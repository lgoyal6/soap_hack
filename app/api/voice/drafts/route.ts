// Owner: Laksh. Drafts the voice agent saved for this case. Never sent anywhere.
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 403 });
  const matterId = Number(new URL(req.url).searchParams.get("matterId"));
  const rows = await q<{ id: string; kind: string; recipient: string | null; body: string; at: Date }>(
    "SELECT id, kind, recipient, body, at FROM drafts WHERE matter_id = $1 ORDER BY at DESC LIMIT 20", [matterId]);
  return NextResponse.json(rows.map((r) => ({ id: Number(r.id), kind: r.kind, recipient: r.recipient, body: r.body, at: r.at.toISOString() })));
}
