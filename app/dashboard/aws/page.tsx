import { redirect } from "next/navigation";

export default function AwsDashboardPage() {
  redirect("/dashboard?cloud=aws");
}
