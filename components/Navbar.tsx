import { auth, signOut } from "@/lib/auth";
import { ShieldAlert, Clock, ClipboardCheck, Settings, LogOut, IterationCw, Network, Swords, Container } from "lucide-react";
import Link from "next/link";
import NavbarAskButton from "./NavbarAskButton";
import NavbarSubNav from "./NavbarSubNav";
import NavbarLink from "./NavbarLink";
import NavbarTasksButton from "./NavbarTasksButton";

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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--green)" }}>
                {/* Shield Outline */}
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" fill="none" />
                {/* Symmetrical Inkblot Patterns */}
                <path d="M12 6c-1.5 0-2.5 1-2.5 2.5S10 11 11 12s1 2 1 2 .5-1 1.5-2 1-1.5 1-3.5S13.5 6 12 6z" fill="currentColor" opacity="0.9" stroke="none" />
                <path d="M10 10c-.5 0-1 .5-1.5 1.5S8 14 9 15.5s1 2 1 2 .5-1 1.5-2.5 1-2 1-3.5-1-1.5-2.5-1.5z" fill="currentColor" opacity="0.6" stroke="none" />
                <path d="M14 10c.5 0 1 .5 1.5 1.5S16 14 15 15.5s-1 2-1 2-.5-1-1.5-2.5-1-2-1-3.5 1-1.5 2.5-1.5z" fill="currentColor" opacity="0.6" stroke="none" />
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

        {/* Right: ask button + user + logout */}
        <div className="flex items-center gap-3 shrink-0">
          <NavbarTasksButton />
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
                  await signOut({ redirectTo: "/login?signout=1" });
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
        <NavbarLink href="/dashboard/trace" icon={<IterationCw className="w-3 h-3" />} label="TRACE" />
        <NavbarLink href="/dashboard/findings" icon={<ShieldAlert className="w-3 h-3" />} label="FINDINGS" danger />
        <NavbarLink href="/dashboard/attack-paths" icon={<Swords className="w-3 h-3" />} label="ATTACK PATHS" />
        {/* IAC DRIFT hidden for now — feature retained at /dashboard/iac-drift */}
        <NavbarLink href="/dashboard/container-scan" icon={<Container className="w-3 h-3" />} label="CONTAINERS" />
        <NavbarLink href="/dashboard/tasks" icon={<IterationCw className="w-3 h-3" />} label="TASKS" />
        <NavbarLink href="/dashboard/history" icon={<Clock className="w-3 h-3" />} label="HISTORY" />
        <NavbarLink href="/dashboard/compliance" icon={<ClipboardCheck className="w-3 h-3" />} label="COMPLIANCE" />
        <NavbarLink href="/dashboard/settings" icon={<Settings className="w-3 h-3" />} label="SETTINGS" />
      </NavbarSubNav>
    </header>
  );
}
