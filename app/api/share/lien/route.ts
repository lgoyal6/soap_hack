// Owner: Laksh. Firm's lien steps: ask for a reduction, or accept the provider's counter.
import { NextResponse } from "next/server";
import { body, fail, firmOnly, num } from "@/lib/portal/http";
import { lienStep } from "@/lib/portal/lien";
import { providerOnMatter } from "@/lib/portal/share";
import type { LienAction } from "@/lib/portal/types";

export async function POST(req: Request) {
  const who = await firmOnly();
  if (who instanceof NextResponse) return who;
  const b = await body(req);
  try {
    const { nodeId } = await providerOnMatter(Number(b.matterId), Number(b.providerNodeId));
    return NextResponse.json(await lienStep(Number(b.matterId), nodeId, "firm", b.action as LienAction, num(b.amount), b.note ? String(b.note) : undefined));
  } catch (e) { return fail(e); }
}
