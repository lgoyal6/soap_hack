// Owner: Tijil. Pin or dismiss an entry in the top ten; nudges the ranking weights.
import { NextResponse } from "next/server";
import { feedback } from "@/lib/pipeline/rank";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 401 });
  const b = (await req.json()) as { matterId: number; resource: string; clioId: number; action: string };
  if (b.action !== "pin" && b.action !== "dismiss") return NextResponse.json({ error: "action must be pin or dismiss" }, { status: 400 });
  await feedback(Number(b.matterId), s.userId, { resource: String(b.resource), clioId: Number(b.clioId) }, b.action);
  return NextResponse.json({ ok: true });
}
