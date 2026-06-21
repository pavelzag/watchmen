import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { ShieldAlert, Zap } from "lucide-react";
import Image from "next/image";
import Footer from "@/components/Footer";
import SplashScreen from "@/components/SplashScreen";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string; signout?: string }>;
}) {
  const { error, expired, signout } = await searchParams;
  if (expired !== "1" && !error) {
    const session = await auth();
    if (session && session.error !== "RefreshAccessTokenError") redirect("/dashboard");
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "#090909" }}
    >
      {signout === "1" && <SplashScreen mode="signout" />}
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#00ff4108 1px, transparent 1px), linear-gradient(90deg, #00ff4108 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative z-10 w-full max-w-sm px-6">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="flex justify-center mb-4">
            <Image
              src="/watchmen-logo.png"
              alt="Watchmen"
              width={160}
              height={160}
              priority
              style={{ filter: "drop-shadow(0 0 18px #00ff4166)" }}
            />
          </div>
          <p className="text-xs uppercase tracking-widest" style={{ color: "#005c16" }}>
            CLOUD SECURITY EXPLORER
          </p>
        </div>

        {/* Auth card */}
        <div
          className="p-8 space-y-6"
          style={{ border: "1px solid #005c16", background: "#0a0a0a" }}
        >
          <div className="text-center space-y-1">
            <h2
              className="text-sm font-bold uppercase tracking-widest"
              style={{ color: "#00ff41" }}
            >
              {DEMO_MODE ? "// ENTER DEMO MODE" : "// AUTHENTICATION REQUIRED"}
            </h2>
            <p className="text-xs" style={{ color: "#005c16" }}>
              {DEMO_MODE
                ? "interactive demo · no account required"
                : "query your GCP and AWS cloud security using natural language"}
            </p>
          </div>

          {expired === "1" && !DEMO_MODE && (
            <div
              className="p-3 text-xs"
              style={{ border: "1px solid #5c3b00", background: "#0d0905", color: "#ffb020" }}
            >
              // session expired; continue with Google to reconnect
            </div>
          )}

          {error && !DEMO_MODE && (
            <div
              className="p-3 text-xs"
              style={{ border: "1px solid #5c3b00", background: "#0d0905", color: "#ffb020" }}
            >
              // sign-in failed; check server network access to Google OAuth
            </div>
          )}

          {DEMO_MODE ? (
            <>
              {/* Demo info */}
              <div
                className="p-3 space-y-1 text-xs"
                style={{ border: "1px solid #003010", background: "#050d05" }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3 h-3" style={{ color: "#00ff41" }} />
                  <span className="uppercase tracking-widest" style={{ color: "#00aa2b" }}>
                    // demo contents
                  </span>
                </div>
                <ul className="space-y-1" style={{ color: "#005c16" }}>
                  <li>&gt; 7 GCP projects · 15 team members</li>
                  <li>&gt; Security findings across IAM/buckets/firewall/SQL</li>
                  <li>&gt; SOC 2 &amp; ISO 27001 compliance scores</li>
                  <li>&gt; Natural language queries (requires AI key)</li>
                </ul>
              </div>

              <form
                action={async () => {
                  "use server";
                  await signIn("credentials", { redirectTo: "/dashboard" });
                }}
              >
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold uppercase tracking-widest transition-all"
                  style={{
                    background: "#00ff41",
                    color: "#090909",
                  }}
                >
                  <Zap className="w-4 h-4" />
                  [ENTER DEMO]
                </button>
              </form>
            </>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/dashboard" });
              }}
            >
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-widest transition-all"
                style={{
                  border: "1px solid #005c16",
                  background: "transparent",
                  color: "#00ff41",
                }}
              >
                {/* Google G icon */}
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                [CONTINUE WITH GOOGLE]
              </button>
            </form>
          )}

          <p className="text-xs text-center" style={{ color: "#003010" }}>
            {DEMO_MODE
              ? "// demo data is shared — changes are visible to all demo users"
              : "// access restricted to authorized users only"}
          </p>
        </div>

        {/* Bottom decoration */}
        <div className="mt-4 flex items-center justify-center gap-2 text-xs" style={{ color: "#003010" }}>
          <ShieldAlert className="w-3 h-3" />
          <span>WATCHMEN v0.6.0 · CLOUD SECURITY EXPLORER</span>
        </div>
      </div>
      <Footer />
    </div>
  );
}
