import DashboardClient from "./DashboardClient";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cloud?: string }>;
}) {
  const { cloud } = await searchParams;
  return <DashboardClient initialView={cloud === "aws" ? "aws" : "gcp"} />;
}
