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
    <div className="min-h-screen" style={{ background: "#090909" }}>
      {session.isDemoUser && (
        <div
          className="px-4 py-2 text-center text-xs"
          style={{ background: "#050d05", borderBottom: "1px solid #005c16" }}
        >
          <span style={{ color: "#00aa2b" }}>// DEMO MODE</span>
          <span style={{ color: "#005c16" }}>
            {" "}— exploring mock GCP data.{" "}
            Natural language queries require an AI key in{" "}
          </span>
          <a
            href="/dashboard/settings"
            className="underline"
            style={{ color: "#00ff41" }}
          >
            [SETTINGS]
          </a>
        </div>
      )}
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
