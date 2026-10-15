// Owner: Laksh. Publish the consented categories to one provider. Refuses any category without consent,
// and refuses (409) when the case changed since the revisions the attorney previewed.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ShareCategory } from "@/lib/contracts";
import { body, fail, firmOnly } from "@/lib/portal/http";
import { requestIdFrom } from "@/lib/portal/publish.ts";
import { publish } from "@/lib/portal/share";

export async function POST(req: Request) {
  const requestId = requestIdFrom(req.headers.get("x-request-id"), randomUUID);
  const who = await firmOnly();
  if (who instanceof NextResponse) return who;
  const b = await body(req);
  const t0 = Date.now();
  const cats = Array.isArray(b.categories) ? (b.categories as ShareCategory[]) : undefined;
  const expected = b.expected && typeof b.expected === "object" && !Array.isArray(b.expected)
    ? (b.expected as Partial<Record<ShareCategory, string>>) : undefined;
  let res: NextResponse;
  let outcome: Record<string, unknown>;
  try {
    const r = await publish(Number(b.matterId), Number(b.providerNodeId), cats, who.userId, { requestId, expected });
    res = NextResponse.json(r);
    outcome = { status: 200, published: r.published.length, unchanged: r.unchanged.length };
  } catch (e) {
    res = fail(e);
    outcome = { status: res.status };
  }
  // One line per publish: ids and counts only, never payloads, names or emails.
  console.log(JSON.stringify({ evt: "share.publish", requestId, matterId: Number(b.matterId) || null, providerNodeId: Number(b.providerNodeId) || null, ms: Date.now() - t0, ...outcome }));
  res.headers.set("x-request-id", requestId);
  return res;
}
