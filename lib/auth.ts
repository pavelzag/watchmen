import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";

type WatchmenAuthUser = {
  authKind?: "demo" | "local";
};

const DEMO_MODE = process.env.DEMO_MODE === "true";
const LOCAL_AUTH_ENABLED = process.env.WATCHMEN_LOCAL_AUTH !== "false";
const LOCAL_AUTH_EMAIL = process.env.WATCHMEN_LOCAL_EMAIL || "local@watchmen.dev";
const LOCAL_AUTH_PASSWORD = process.env.WATCHMEN_LOCAL_PASSWORD || "";

function hasUsableEnv(value: string | undefined, placeholder: string): value is string {
  return Boolean(value && value.trim() && !value.includes(placeholder) && !value.startsWith("your_"));
}


// Comma-separated list of allowed emails, e.g. "alice@gmail.com,bob@company.com"
// OR restrict by domain below. Leave ALLOWED_EMAILS empty to use domain restriction only.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

// Restrict to a specific Google Workspace domain (e.g. "yourcompany.com")
// Leave empty to skip domain restriction and rely on ALLOWED_EMAILS only.
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN ?? "";

const REFRESH_ACCESS_TOKEN_ERROR = "RefreshAccessTokenError";
const hasGoogleAuth = hasUsableEnv(process.env.GOOGLE_CLIENT_ID, "your_google_client_id") &&
  hasUsableEnv(process.env.GOOGLE_CLIENT_SECRET, "your_google_client_secret");
const hasGithubAuth = hasUsableEnv(process.env.GITHUB_CLIENT_ID, "your_github_client_id") &&
  hasUsableEnv(process.env.GITHUB_CLIENT_SECRET, "your_github_client_secret");

function isAllowed(email: string): boolean {
  if (ALLOWED_EMAILS.includes(email)) return true;
  if (ALLOWED_DOMAIN && email.endsWith(`@${ALLOWED_DOMAIN}`)) return true;
  // If neither is configured, allow everyone (useful for personal GCP accounts)
  if (!ALLOWED_EMAILS.length && !ALLOWED_DOMAIN) return true;
  return false;
}

function describeRefreshError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const maybeError = err as { error?: unknown; error_description?: unknown };
    const parts = [maybeError.error, maybeError.error_description].filter(
      (part): part is string => typeof part === "string" && part.length > 0
    );
    if (parts.length) return parts.join(": ");
  }
  return "Unknown token refresh error";
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) {
    console.warn("[auth] Cannot refresh access token: missing refresh token");
    return {
      ...token,
      accessToken: undefined,
      error: REFRESH_ACCESS_TOKEN_ERROR,
    };
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshed = await res.json();
    if (!res.ok) throw refreshed;

    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      // keep existing refresh token if no new one returned
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (err) {
    console.warn(`[auth] Failed to refresh access token: ${describeRefreshError(err)}`);
    return {
      ...token,
      accessToken: undefined,
      error: REFRESH_ACCESS_TOKEN_ERROR,
    };
  }
}

const providers = DEMO_MODE
  ? [
      Credentials({
        id: "demo",
        name: "Demo",
        credentials: {},
        authorize() {
          return {
            id: "demo-user",
            name: "Demo User",
            email: "demo@watchmen.dev",
            image: null,
            authKind: "demo",
          };
        },
      }),
    ]
  : [
      ...(LOCAL_AUTH_ENABLED
        ? [
            Credentials({
              id: "local",
              name: "Local",
              credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
              },
              authorize(credentials) {
                const email = typeof credentials?.email === "string" && credentials.email.trim()
                  ? credentials.email.trim()
                  : LOCAL_AUTH_EMAIL;
                const password = typeof credentials?.password === "string" ? credentials.password : "";
                if (LOCAL_AUTH_PASSWORD && password !== LOCAL_AUTH_PASSWORD) return null;
                if (!isAllowed(email)) return null;
                return {
                  id: `local:${email}`,
                  name: email.split("@")[0] || "Watchmen User",
                  email,
                  image: null,
                  authKind: "local",
                };
              },
            }),
          ]
        : []),
      ...(hasGoogleAuth
        ? [
            Google({
              clientId: process.env.GOOGLE_CLIENT_ID!,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
              authorization: {
                params: {
                  scope: "openid email profile",
                  access_type: "offline",
                  prompt: "consent",
                },
              },
            }),
          ]
        : []),
      ...(hasGithubAuth
        ? [
            GitHub({
              clientId: process.env.GITHUB_CLIENT_ID!,
              clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            }),
          ]
        : []),
    ];

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  callbacks: {
    signIn({ account, profile }) {
      // Credentials providers validate access in authorize().
      if (account?.type === "credentials" || account?.provider === "demo" || account?.provider === "local") return true;
      const email = profile?.email ?? "";
      if (!isAllowed(email)) {
        console.warn(`[auth] blocked sign-in attempt from: ${email}`);
        return false;
      }
      return true;
    },
    async jwt({ token, account, user }) {
      // Demo credentials: mark as demo, skip OAuth token handling.
      const authKind = (user as WatchmenAuthUser | undefined)?.authKind;
      if (authKind === "demo") {
        return { ...token, isDemoUser: true };
      }
      if (authKind === "local") {
        return { ...token, isLocalUser: true };
      }

      // Initial Google sign-in: store tokens from account.
      if (account?.provider === "google") {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }

      // Demo/local users: no token refresh needed.
      if (token.isDemoUser || token.isLocalUser) return token;

      // Token still valid
      if (token.expiresAt && Date.now() / 1000 < token.expiresAt - 60) {
        return token;
      }

      // Token expired — refresh it
      return refreshAccessToken(token);
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      session.accessToken = token.accessToken;
      session.error = token.error;
      session.isDemoUser = token.isDemoUser;
      session.isLocalUser = token.isLocalUser;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
