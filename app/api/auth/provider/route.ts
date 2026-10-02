// Owner: Laksh. Provider sign-in: the email the firm has in Clio plus the access code the firm generated.
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { checkCode } from "@/lib/portal/codes";
import { body } from "@/lib/portal/http";
import { createSession } from "@/lib/session";

export async function POST(req: Request) {
  const b = await body(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  const code = String(b.code ?? "");
  const [u] = await q<{ id: string; provider_node_id: string | null; code_hash: string }>(
    `SELECT u.id, u.provider_node_id, a.code_hash FROM users u JOIN access_codes a ON a.user_id = u.id
     WHERE u.role = 'provider' AND u.email = $1 AND a.revoked_at IS NULL`,
    [email],
  );
  // Same answer for unknown email, revoked code and wrong code.
  if (!u || !checkCode(code, u.code_hash)) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "That email and code do not match an active login" }, { status: 401 });
  }
  await q("UPDATE users SET prev_login = last_login, last_login = now() WHERE id = $1", [u.id]);
  await createSession({ id: Number(u.id), role: "provider", providerNodeId: u.provider_node_id ? Number(u.provider_node_id) : undefined });
  return NextResponse.json({ ok: true, next: "/provider" });
}
