// Owner: Laksh. Widget home for the firm. Firm users only.
import { requireRole } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireRole("firm");
  return <>{children}</>;
}
