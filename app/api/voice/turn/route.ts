// Owner: Laksh. The browser reports when the first audio of a turn started playing.
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 403 });
  const { turnId, firstAudioMs } = (await req.json().catch(() => ({}))) as { turnId?: number; firstAudioMs?: number };
  if (!Number.isFinite(Number(turnId)) || !Number.isFinite(Number(firstAudioMs))) return NextResponse.json({ error: "bad input" }, { status: 400 });
  await q("UPDATE voice_turns SET first_audio_ms = $1 WHERE id = $2 AND user_id = $3 AND first_audio_ms IS NULL", [Math.round(Number(firstAudioMs)), turnId, s.userId]);
  return NextResponse.json({ ok: true });
}
