// Owner: Laksh. Speech for one checked sentence via GMI's text-to-speech model, when TTS_MODEL is set.
// 204 means "use the browser's voice". The browser only sends sentences that already passed the number check.
import { NextResponse } from "next/server";
import { llm } from "@/lib/llm";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 403 });
  const model = process.env.TTS_MODEL;
  if (!model) return new Response(null, { status: 204 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return new Response(null, { status: 204 });
  try {
    const audio = await llm.audio.speech.create({ model, voice: process.env.TTS_VOICE || "alloy", input: text.slice(0, 1000) }, { signal: req.signal });
    return new Response(await audio.arrayBuffer(), { headers: { "Content-Type": audio.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("tts failed", (e as Error).message);
    return new Response(null, { status: 204 });
  }
}
