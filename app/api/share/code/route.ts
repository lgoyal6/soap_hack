// Owner: Laksh. Generate (POST) or revoke (DELETE) a provider's access code. Firm only.
import { NextResponse } from "next/server";
import { body, fail, firmOnly } from "@/lib/portal/http";
import { generateCode, revokeCode } from "@/lib/portal/share";

export async function POST(req: Request) {
  const who = await firmOnly();
  if (who instanceof NextResponse) return who;
  const b = await body(req);
  try { return NextResponse.json(await generateCode(Number(b.matterId), Number(b.providerNodeId))); } catch (e) { return fail(e); }
}

export async function DELETE(req: Request) {
  const who = await firmOnly();
  if (who instanceof NextResponse) return who;
  const b = await body(req);
  try { await revokeCode(Number(b.matterId), Number(b.providerNodeId)); return NextResponse.json({ ok: true }); } catch (e) { return fail(e); }
}
