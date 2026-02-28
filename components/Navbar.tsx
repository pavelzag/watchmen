import { auth, signOut } from "@/lib/auth";
import { ShieldCheck, LogOut, ShieldAlert, Search, Clock, LayoutDashboard } from "lucide-react";
import Link from "next/link";

export default async function Navbar() {
  const session = await auth();

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
      {/* Main bar */}
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20">
            <ShieldCheck className="w-5 h-5 text-sky-400" />
          </div>
          <span className="font-bold text-white tracking-tight">Watchmen</span>
          <span className="text-xs text-slate-500 font-mono hidden sm:block">
            GCP IAM Explorer
          </span>
        </div>

        {session?.user && (
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? ""}
                  className="w-7 h-7 rounded-full ring-1 ring-slate-700"
                />
              )}
              <span className="text-sm text-slate-400">{session.user.email}</span>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all duration-150"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Sub-nav */}
      <div className="max-w-5xl mx-auto px-6 h-9 flex items-center gap-1 border-t border-slate-800/60">
        <NavLink href="/dashboard" icon={<LayoutDashboard className="w-3.5 h-3.5" />} label="Dashboard" />
        <NavLink href="/dashboard/findings" icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Findings" highlight />
        <NavLink href="/dashboard/principal" icon={<Search className="w-3.5 h-3.5" />} label="Principal" />
        <NavLink href="/dashboard/history" icon={<Clock className="w-3.5 h-3.5" />} label="History" />
      </div>
    </header>
  );
}

function NavLink({
  href, icon, label, highlight,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
        highlight
          ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
          : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}
