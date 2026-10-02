// Owner: Tijil. Firm-only API routes: 401 when nobody is signed in, 403 when a provider is.
import { NextResponse } from "next/server";
import type { Session } from "../contracts";
import { getSession } from "../session";

export async function firmOnly(): Promise<{ session: Session; deny: null } | { session: null; deny: NextResponse }> {
  const s = await getSession();
  if (s?.role === "firm") return { session: s, deny: null };
  return { session: null, deny: NextResponse.json({ error: s ? "firm users only" : "sign-in required" }, { status: s ? 403 : 401 }) };
}
