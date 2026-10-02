// Owner: Laksh. One voice turn, streamed as newline-delimited JSON events. Firm only.
// Closing the request (the browser aborts on space) aborts the model call.
import { NextResponse } from "next/server";
import { resetConversation, runTurn, type VoiceEvent } from "@/lib/voice/agent";
import { getSession } from "@/lib/session";

export const maxDuration = 120;

export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { matterId?: number; message?: string; reset?: boolean };
  const matterId = Number(b.matterId);
  if (!Number.isFinite(matterId)) return NextResponse.json({ error: "matterId required" }, { status: 400 });
  if (b.reset) resetConversation(s.userId, matterId);
  const message = String(b.message ?? "").trim().slice(0, 2000);
  if (!message) return NextResponse.json({ ok: true });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: VoiceEvent) => { try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* client went away */ } };
      await runTurn({ userId: s.userId, matterId, message, signal: req.signal, emit });
      try { controller.close(); } catch { /* already closed */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
