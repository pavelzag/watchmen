import { auth, signOut } from "@/lib/auth";
import { LayoutDashboard, ShieldAlert, Clock, ClipboardCheck, Settings, LogOut, Terminal, Shield } from "lucide-react";
import Link from "next/link";
import NavbarAskButton from "./NavbarAskButton";
import NavbarCloudTabs from "./NavbarCloudTabs";

export default async function Navbar() {
  const session = await auth();
  return (
    <header
      style={{
        borderBottom: "1px solid var(--border-dim)",
        background: "var(--bg)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Top bar */}
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
        {/* Logo and hint */}
        <div className="flex items-baseline gap-3 shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Shield className="w-5 h-5" style={{ color: "var(--green)" }} />
            <span className="font-bold tracking-tighter text-lg" style={{ color: "var(--green)" }}>
              WATCHMEN
            </span>
          </Link>
          <span className="hidden md:inline text-[10px] uppercase tracking-widest opacity-40" style={{ color: "var(--green)" }}>
            // press / for brain
          </span>
        </div>

        {/* Cloud tabs - scrollable on mobile */}
        <div className="flex-1 flex justify-center overflow-x-auto no-scrollbar px-4">
          <NavbarCloudTabs />
        </div>

        {/* Right: ask button + user + logout */}
        <div className="flex items-center gap-3 shrink-0">
          <NavbarAskButton />
          {session?.user && (
            <>
              <span className="text-xs hidden md:block" style={{ color: "var(--border-dim)" }}>
                <span style={{ color: "var(--text-muted)" }}>// logged-in:</span>{" "}
                <span style={{ color: "var(--text-primary)" }}>{session.user.email}</span>
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button
                  type="submit"
                  className="terminal-btn-danger flex items-center gap-1.5 px-3 py-1 text-xs uppercase tracking-widest"
                >
                  <LogOut className="w-3 h-3" />
                  [LOGOUT]
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Sub-nav */}
      <div
        className="max-w-7xl mx-auto px-4 md:px-6 h-8 flex items-center gap-0 overflow-x-auto no-scrollbar scroll-smooth"
        style={{ borderTop: "1px solid var(--bg-card2)" }}
      >
        <NavLink href="/dashboard/findings" icon={<ShieldAlert className="w-3 h-3" />} label="FINDINGS" danger />
        <NavLink href="/dashboard/history" icon={<Clock className="w-3 h-3" />} label="HISTORY" />
        <NavLink href="/dashboard/compliance" icon={<ClipboardCheck className="w-3 h-3" />} label="COMPLIANCE" />
        <NavLink href="/dashboard/settings" icon={<Settings className="w-3 h-3" />} label="SETTINGS" />
      </div>
    </header>
  );
}

function NavLink({
  href, icon, label, danger,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 px-3 h-full text-xs uppercase tracking-widest ${danger ? "terminal-nav-link-danger" : "terminal-nav-link"
        }`}
      style={{ borderRight: "1px solid var(--bg-card2)" }}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

