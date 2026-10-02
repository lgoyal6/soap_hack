// Owner: Laksh (working version supplied in the foundation step). Contract B in BUILD_PLAN.md.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, Session } from "./contracts";

const COOKIE = "cb_session";

function sign(body: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export async function createSession(user: { id: number; role: Role; providerNodeId?: number }) {
  const body = Buffer.from(JSON.stringify({ userId: user.id, role: user.role, providerNodeId: user.providerNodeId })).toString("base64url");
  (await cookies()).set(COOKIE, `${body}.${sign(body)}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
  } catch {
    return null;
  }
}

/** Use at the top of a layout or route. Sends the user to /login unless signed in with this role. */
export async function requireRole(role: Role): Promise<Session> {
  const s = await getSession();
  if (!s || s.role !== role) redirect("/login");
  return s;
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}
