import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CloudShellProvider from "@/components/CloudShellProvider";
import PostLoginSplash from "@/components/PostLoginSplash";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <CloudShellProvider>
      <PostLoginSplash />
      <div className="min-h-screen" style={{ background: "#090909" }}>
        {session.isDemoUser && (
          <div
            className="px-4 py-2 text-center text-xs"
            style={{ background: "#050d05", borderBottom: "1px solid #005c16" }}
          >
            <span style={{ color: "#00aa2b" }}>// DEMO MODE</span>
          </div>
        )}
        <Navbar />
        <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
        <Footer />
      </div>
    </CloudShellProvider>
  );
}
