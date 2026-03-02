import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      {session.isDemoUser && (
        <div className="bg-sky-500/10 border-b border-sky-500/20 px-4 py-2 text-center">
          <p className="text-xs text-sky-400">
            <span className="font-semibold">Demo Mode</span> — exploring mock GCP data for a fictional company.
            Natural language queries require your own AI key in{" "}
            <a href="/dashboard/settings" className="underline hover:text-sky-300">
              Settings
            </a>
            .
          </p>
        </div>
      )}
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
