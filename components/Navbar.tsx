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
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <div className="relative w-5 h-5 transition-transform group-hover:scale-110">
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--green)" }}>
                <path d="M12 2c-.5 0-1 .5-1.5 1.5S9 6 9 8s.5 4 1.5 5.5S12 16 12 16s.5-1 1.5-2.5S15 10 15 8s-.5-4.5-1.5-6S12.5 2 12 2z" opacity="0.8" />
                <path d="M12 22c.5 0 1-.5 1.5-1.5S15 18 15 16s-.5-4 1.5-5.5S18 8 18 8s-.5 1-1.5 2.5S15 14 15 16s.5 4.5 1.5 6s.5 0 0 0z" opacity="0.6" />
                <path d="M12 22c-.5 0-1-.5-1.5-1.5S9 18 9 16s.5-4-1.5-5.5S6 8 6 8s.5 1 1.5 2.5S9 14 9 16s-.5 4.5-1.5 6s-.5 0 0 0z" opacity="0.6" />
                <circle cx="12" cy="12" r="1.5" />
              </svg>
            </div>
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


