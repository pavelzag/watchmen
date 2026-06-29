import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CloudShellProvider from "@/components/CloudShellProvider";
import PostLoginSplash from "@/components/PostLoginSplash";
import { TaskCenterProvider } from "@/components/TaskCenterProvider";
import { getDeploymentInfo } from "@/lib/deployment-info";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const deploymentInfo = getDeploymentInfo();
  if (!session) redirect("/login");
  if (session.error === "RefreshAccessTokenError") redirect("/login?expired=1");

  return (
    <CloudShellProvider>
      <TaskCenterProvider>
        <PostLoginSplash showShortcutModal={!!session.isDemoUser} />
        <div className="min-h-screen" style={{ background: "#090909" }}>
          {session.isDemoUser && (
            <div style={{ background: "#050d05", borderBottom: "1px solid #005c16" }}>
              <div className="px-4 py-2 text-center text-xs">
                <span style={{ color: "#00aa2b" }}>// DEMO MODE</span>
              </div>
              <details className="px-4 pb-2 text-[10px] font-mono text-center">
                <summary
                  className="cursor-pointer select-none"
                  style={{ color: "#005c16", listStyle: "none" }}
                >
                  build info
                </summary>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1" style={{ color: "#00aa2b" }}>
                  <span>branch: {deploymentInfo.branch}</span>
                  <span>sha: {deploymentInfo.commitSha}</span>
                  <span>url: {deploymentInfo.deploymentUrl}</span>
                </div>
              </details>
            </div>
          )}
          <Navbar />
          <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
          <Footer />
        </div>
      </TaskCenterProvider>
    </CloudShellProvider>
  );
}
