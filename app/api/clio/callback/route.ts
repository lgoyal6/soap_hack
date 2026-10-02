// Owner: Tijil. Finishes the Clio sign-in, records the firm user and opens a firm session.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clioGet, exchangeCode } from "@/lib/clio";
import { q } from "@/lib/db";
import { createSession } from "@/lib/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  if (!code || !state || state !== jar.get("clio_state")?.value) {
    return NextResponse.json({ error: "Clio sign-in failed: missing code or state mismatch" }, { status: 400 });
  }
  jar.delete("clio_state");
  await exchangeCode(code);

  const me = await clioGet<{ id: number; name: string; email: string }>("users/who_am_i", { fields: "id,name,email" });
  const [user] = await q<{ id: string }>(
    `INSERT INTO users (role, email, name, clio_user_id, last_login) VALUES ('firm', $1, $2, $3, now())
     ON CONFLICT (role, email) DO UPDATE SET name = $2, clio_user_id = $3, last_login = now()
     RETURNING id`,
    [me.email, me.name, me.id],
  );
  await createSession({ id: Number(user.id), role: "firm" });
  return NextResponse.redirect(new URL("/firm", req.url));
}
