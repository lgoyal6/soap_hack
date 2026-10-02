// Owner: Laksh. Publish the consented categories to one provider. Refuses any category without consent.
import { NextResponse } from "next/server";
import type { ShareCategory } from "@/lib/contracts";
import { body, fail, firmOnly } from "@/lib/portal/http";
import { publish } from "@/lib/portal/share";

export async function POST(req: Request) {
  const who = await firmOnly();
  if (who instanceof NextResponse) return who;
  const b = await body(req);
  try {
    const cats = Array.isArray(b.categories) ? (b.categories as ShareCategory[]) : undefined;
    return NextResponse.json(await publish(Number(b.matterId), Number(b.providerNodeId), cats, who.userId));
  } catch (e) { return fail(e); }
}
