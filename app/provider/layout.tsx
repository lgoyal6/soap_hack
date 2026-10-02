// Owner: Laksh.
import { requireRole } from "@/lib/session";

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  await requireRole("provider");
  return <>{children}</>;
}
