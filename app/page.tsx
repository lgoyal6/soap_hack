// Owner: Tijil. Sends each role to its own portal.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const s = await getSession();
  redirect(s?.role === "firm" ? "/firm" : s?.role === "provider" ? "/provider" : "/login");
}
