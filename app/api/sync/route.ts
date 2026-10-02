// Owner: Tijil. Pulls the latest from Clio into our database. Firm users only.
import { NextResponse } from "next/server";
import { firmOnly } from "@/lib/tools/guard";
import { runSync } from "@/lib/sync";

export const maxDuration = 300;

export async function POST() {
  const { deny } = await firmOnly();
  if (deny) return deny;
  try {
    return NextResponse.json(await runSync());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
