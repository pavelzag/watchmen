import { auth } from "@/lib/auth";
import AwsDashboardClient from "./AwsDashboardClient";

export default async function AwsDashboardPage() {
  const session = await auth();
  return <AwsDashboardClient demoMode={Boolean(session?.isDemoUser)} />;
}
