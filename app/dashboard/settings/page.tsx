import { auth } from "@/lib/auth";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await auth();
  return <SettingsClient isDemoUser={!!session?.isDemoUser} />;
}
