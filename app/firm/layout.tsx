// Owner: Tijil.
import { requireRole } from "@/lib/session";

export default async function FirmLayout({ children }: { children: React.ReactNode }) {
  await requireRole("firm");
  return <>{children}</>;
}
