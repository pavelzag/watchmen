import { auth, signOut } from "@/lib/auth";
import { LayoutDashboard, ShieldAlert, Clock, ClipboardCheck, Settings, LogOut, Terminal, Shield } from "lucide-react";
import Link from "next/link";
import NavbarAskButton from "./NavbarAskButton";
import NavbarCloudTabs from "./NavbarCloudTabs";
import NavbarSubNav from "./NavbarSubNav";
import NavbarLink from "./NavbarLink";

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

      <NavbarSubNav>
        <NavbarLink href="/dashboard/findings" icon={<ShieldAlert className="w-3 h-3" />} label="FINDINGS" danger />
        <NavbarLink href="/dashboard/history" icon={<Clock className="w-3 h-3" />} label="HISTORY" />
        <NavbarLink href="/dashboard/compliance" icon={<ClipboardCheck className="w-3 h-3" />} label="COMPLIANCE" />
        <NavbarLink href="/dashboard/settings" icon={<Settings className="w-3 h-3" />} label="SETTINGS" />
      </NavbarSubNav>
    </header>
  );
}


