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
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 text-center">
          <p className="text-xs text-zinc-500 font-mono">
            <span className="text-zinc-300 font-semibold">DEMO</span>
            {" · "}exploring mock GCP data · AI queries require your own key in{" "}
            <a href="/dashboard/settings" className="text-zinc-300 underline hover:text-white">
              Settings
            </a>
          </p>
        </div>
      )}
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
