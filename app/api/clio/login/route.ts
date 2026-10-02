// Owner: Tijil. Starts the Clio sign-in. The firm login IS the Clio connection.
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/clio";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("clio_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state));
}
