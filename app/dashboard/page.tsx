import { auth } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  return <DashboardClient demoMode={Boolean(session?.isDemoUser)} />;
}
