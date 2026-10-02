// Owner: Laksh. Grant or revoke one provider x category. Firm only.
import { NextResponse } from "next/server";
import type { ShareCategory } from "@/lib/contracts";
import { body, fail, firmOnly } from "@/lib/portal/http";
import { setConsent } from "@/lib/portal/share";

export async function POST(req: Request) {
  const who = await firmOnly();
  if (who instanceof NextResponse) return who;
  const b = await body(req);
  try {
    await setConsent(Number(b.matterId), Number(b.providerNodeId), b.category as ShareCategory, b.granted === true, who.userId);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
