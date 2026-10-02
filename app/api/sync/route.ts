// Owner: Tijil. Pulls the latest from Clio into our database. Firm users only.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { runSync } from "@/lib/sync";

export const maxDuration = 300;

export async function POST() {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 401 });
  try {
    return NextResponse.json(await runSync());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
