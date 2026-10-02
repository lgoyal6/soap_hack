// Owner: Laksh. Provider's lien steps: confirm the balance, accept or counter the firm's reduction request.
import { NextResponse } from "next/server";
import { body, fail, num, providerOnly } from "@/lib/portal/http";
import { lienStep } from "@/lib/portal/lien";
import { nodeOnCase } from "@/lib/portal/provider";
import type { LienAction } from "@/lib/portal/types";

export async function POST(req: Request) {
  const ctx = await providerOnly();
  if (ctx instanceof NextResponse) return ctx;
  const b = await body(req);
  try {
    const nodeId = await nodeOnCase(ctx, Number(b.matterId));
    if (!nodeId) return NextResponse.json({ error: "That case was not shared with you" }, { status: 404 });
    return NextResponse.json(await lienStep(Number(b.matterId), nodeId, "provider", b.action as LienAction, num(b.amount), b.note ? String(b.note) : undefined));
  } catch (e) { return fail(e); }
}
