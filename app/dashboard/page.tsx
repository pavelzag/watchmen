import { auth } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cloud?: string }>;
}) {
  const session = await auth();
  const { cloud } = await searchParams;
  const initialView = cloud === "aws" ? "aws" : cloud === "self-managed" || cloud === "self" ? "self-managed" : "gcp";
  return <DashboardClient initialView={initialView as "gcp" | "aws" | "self-managed"} demoMode={Boolean(session?.isDemoUser)} />;
}
