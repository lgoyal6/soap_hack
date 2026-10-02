// Owner: Tijil. JSON access to the case tools for client-side refresh. Firm users only.
// GET /api/case/getOpenItems?matterId=1   (also: since, query, entity)
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { tools } from "@/lib/tools";
import { topTen } from "@/lib/pipeline/rank";

export async function GET(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 401 });
  const { tool } = await ctx.params;
  const p = new URL(req.url).searchParams;
  const id = Number(p.get("matterId"));
  switch (tool) {
    case "listMatters": return NextResponse.json(await tools.listMatters());
    case "listProviders": return NextResponse.json(await tools.listProviders(id));
    case "getSummary": return NextResponse.json(await tools.getSummary(id));
    case "getOpenItems": return NextResponse.json(await tools.getOpenItems(id));
    case "getConflicts": return NextResponse.json(await tools.getConflicts(id));
    case "getMoney": return NextResponse.json(await tools.getMoney(id));
    case "getNotDone": return NextResponse.json(await tools.getNotDone(id));
    case "getTimeline": return NextResponse.json(await tools.getTimeline(id));
    case "getChanges": return NextResponse.json(await tools.getChanges(id, p.get("since") ?? "1900-01-01"));
    case "searchRecords": return NextResponse.json(await tools.searchRecords(id, p.get("query") ?? ""));
    case "getRelated": return NextResponse.json(await tools.getRelated(id, p.get("entity") ?? ""));
    case "topTen": return NextResponse.json(await topTen(id));
    case "getRecord": return NextResponse.json(await tools.getRecord({ resource: p.get("resource") ?? "", clioId: Number(p.get("clioId")), pageNo: Number(p.get("pageNo")) || undefined }));
    default: return NextResponse.json({ error: "unknown tool" }, { status: 404 });
  }
}
