import { auth, signOut } from "@/lib/auth";
import {
  LayoutDashboard, ShieldAlert, Clock,
  ClipboardCheck, Settings, LogOut, Terminal,
} from "lucide-react";
import Link from "next/link";
import NavbarAskButton from "./NavbarAskButton";
import NavbarCloudTabs from "./NavbarCloudTabs";

export default async function Navbar() {
  const session = await auth();

  return (
    <header
      style={{
        borderBottom: "1px solid #005c16",
        background: "#090909",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Top bar */}
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4" style={{ color: "#00ff41" }} />
          <span
            className="text-sm font-bold tracking-widest uppercase"
            style={{ color: "#00ff41", textShadow: "0 0 8px #00ff41" }}
          >
            WATCHMEN
          </span>
          <span style={{ color: "#005c16" }}>&gt;</span>
          <span className="text-xs tracking-widest uppercase" style={{ color: "#00aa2b" }}>
            GCP IAM EXPLORER
          </span>
          <span className="blink text-xs" style={{ color: "#00ff41" }}>_</span>
        </div>

        {/* Right: ask button + user + logout */}
        <div className="flex items-center gap-3">
          {/* Global ask button — always visible */}
          <NavbarAskButton />

          {session?.user && (
            <>
              <span className="text-xs hidden md:block" style={{ color: "#005c16" }}>
                <span style={{ color: "#00aa2b" }}>// logged-in:</span>{" "}
                <span style={{ color: "#00ff41" }}>{session.user.email}</span>
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
        className="max-w-7xl mx-auto px-6 h-8 flex items-center gap-0"
        style={{ borderTop: "1px solid #0a1a0a" }}
      >
        <NavbarCloudTabs />
        <NavLink href="/dashboard" icon={<LayoutDashboard className="w-3 h-3" />} label="DASHBOARD" />
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
      style={{ borderRight: "1px solid #0a1a0a" }}
    >
      {icon}
      {label}
    </Link>
  );
}
