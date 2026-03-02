import { auth, signOut } from "@/lib/auth";
import { ShieldCheck, LogOut } from "lucide-react";
import Link from "next/link";
import NavLinks from "./NavLinks";

export default async function Navbar() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-50">
      {/* 1px chrome accent line at the very top */}
      <div className="h-px bg-gradient-to-r from-transparent via-zinc-600/60 to-transparent" />

      {/* Main bar */}
      <div className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="p-1.5 rounded-lg bg-zinc-800 border border-zinc-700 group-hover:border-zinc-600 transition-colors">
              <ShieldCheck className="w-5 h-5 text-zinc-300" />
            </div>
            <span className="font-bold text-white tracking-tight">WATCHMEN</span>
            <span className="text-xs text-zinc-600 font-mono hidden sm:block">
              GCP IAM
            </span>
          </Link>

          {session?.user && (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                {session.user.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.image}
                    alt={session.user.name ?? ""}
                    className="w-7 h-7 rounded-full ring-1 ring-zinc-700"
                  />
                )}
                <span className="text-sm text-zinc-500 font-mono">{session.user.email}</span>
              </div>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all duration-150"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Sub-nav */}
      <div className="border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-9 flex items-center gap-1">
          <NavLinks />
        </div>
      </div>
    </header>
  );
}
