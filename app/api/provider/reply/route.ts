// Owner: Laksh. One-click reply to a request the firm published. Lands in provider_replies (contract E).
import { NextResponse } from "next/server";
import { body, fail, providerOnly } from "@/lib/portal/http";
import { reply } from "@/lib/portal/provider";
import type { ReplyKind } from "@/lib/portal/types";

export async function POST(req: Request) {
  const ctx = await providerOnly();
  if (ctx instanceof NextResponse) return ctx;
  const b = await body(req);
  try {
    await reply(ctx, Number(b.matterId), String(b.requestId ?? ""), b.reply as ReplyKind, b.replyDate ? String(b.replyDate) : null, b.note ? String(b.note) : null);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
