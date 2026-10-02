// Owner: Laksh. JSON of one shared case for the provider's own page refresh. Another provider's case is a 404.
import { NextResponse } from "next/server";
import { providerOnly } from "@/lib/portal/http";
import { providerCase } from "@/lib/portal/provider";

export async function GET(req: Request) {
  const ctx = await providerOnly();
  if (ctx instanceof NextResponse) return ctx;
  const c = await providerCase(ctx, Number(new URL(req.url).searchParams.get("matterId")));
  return c ? NextResponse.json(c) : NextResponse.json({ error: "That case was not shared with you" }, { status: 404 });
}
