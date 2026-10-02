// Owner: Laksh. Everything the firm's share panel shows for one case. Firm only.
import { NextResponse } from "next/server";
import { fail, firmOnly } from "@/lib/portal/http";
import { panelData } from "@/lib/portal/share";

export async function GET(req: Request) {
  const who = await firmOnly();
  if (who instanceof NextResponse) return who;
  const matterId = Number(new URL(req.url).searchParams.get("matterId"));
  try { return NextResponse.json(await panelData(matterId)); } catch (e) { return fail(e); }
}
