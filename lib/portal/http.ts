// Owner: Laksh. Shared guards for the portal's API routes.
import { NextResponse } from "next/server";
import { getSession } from "../session";
import { LienError } from "./lien";
import { PortalError, providerCtx, type ProviderCtx } from "./provider";
import { ShareError } from "./share";

/** Firm routes answer 403 to anyone else, including signed-in providers. */
export async function firmOnly(): Promise<{ userId: number } | NextResponse> {
  const s = await getSession();
  if (s?.role !== "firm") return NextResponse.json({ error: "firm sign-in required" }, { status: 403 });
  return { userId: s.userId };
}

export async function providerOnly(): Promise<ProviderCtx | NextResponse> {
  const ctx = await providerCtx(await getSession());
  if (!ctx) return NextResponse.json({ error: "provider sign-in required" }, { status: 403 });
  return ctx;
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return {}; }
}

export function fail(e: unknown) {
  if (e instanceof ShareError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
  if (e instanceof PortalError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof LienError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
