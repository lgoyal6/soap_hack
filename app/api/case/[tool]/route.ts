// Owner: Tijil. JSON access to the case tools for client-side refresh. Firm users only.
// GET /api/case/getOpenItems?matterId=1   (also: since, query, entity)
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { firmOnly } from "@/lib/tools/guard";
import { tools } from "@/lib/tools";
import { readSection } from "@/lib/pipeline/process";
import { topTen } from "@/lib/pipeline/rank";

export async function GET(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { deny } = await firmOnly();
  if (deny) return deny;
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
    case "injuries": {
      // Injuries found in records and scan pages, grouped by body part, each with its page-linked quote.
      const rows = await q<{ subject: string; quote: string; resource: string; clio_id: string; page_no: number | null }>(
        "SELECT subject, quote, resource, clio_id, page_no FROM facts WHERE matter_id = $1 AND type = 'injury' ORDER BY subject, id", [id]);
      const by = new Map<string, { bodyPart: string; findings: { quote: string; source: object }[] }>();
      for (const r of rows) {
        const key = (r.subject || "unspecified").replace(/-/g, " ");
        const g = by.get(key) ?? by.set(key, { bodyPart: key, findings: [] }).get(key)!;
        if (g.findings.length < 4) g.findings.push({ quote: r.quote, source: { resource: r.resource, clioId: Number(r.clio_id), ...(r.page_no ? { pageNo: r.page_no } : {}), quote: r.quote } });
      }
      return NextResponse.json([...by.values()]);
    }
    case "glance": return NextResponse.json({ glance: await readSection(id, "glance"), witness: (await readSection(id, "witness")) ?? [] });
    case "topTen": return NextResponse.json(await topTen(id));
    case "getRecord": return NextResponse.json(await tools.getRecord({ resource: p.get("resource") ?? "", clioId: Number(p.get("clioId")), pageNo: Number(p.get("pageNo")) || undefined }));
    default: return NextResponse.json({ error: "unknown tool" }, { status: 404 });
  }
}
