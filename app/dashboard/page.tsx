import { auth } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cloud?: string }>;
}) {
  const session = await auth();
  const { cloud } = await searchParams;
  return <DashboardClient initialView={cloud === "aws" ? "aws" : "gcp"} demoMode={Boolean(session?.isDemoUser)} />;
}
