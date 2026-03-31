import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";

const DEMO_MODE = process.env.DEMO_MODE === "true";


// Comma-separated list of allowed emails, e.g. "alice@gmail.com,bob@company.com"
// OR restrict by domain below. Leave ALLOWED_EMAILS empty to use domain restriction only.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

// Restrict to a specific Google Workspace domain (e.g. "yourcompany.com")
// Leave empty to skip domain restriction and rely on ALLOWED_EMAILS only.
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN ?? "";

function isAllowed(email: string): boolean {
  if (ALLOWED_EMAILS.includes(email)) return true;
  if (ALLOWED_DOMAIN && email.endsWith(`@${ALLOWED_DOMAIN}`)) return true;
  // If neither is configured, allow everyone (useful for personal GCP accounts)
  if (!ALLOWED_EMAILS.length && !ALLOWED_DOMAIN) return true;
  return false;
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken!,
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
    };
  } catch (err) {
    console.error("[auth] Failed to refresh access token:", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: DEMO_MODE
    ? [
        Credentials({
          credentials: {},
          authorize() {
            return {
              id: "demo-user",
              name: "Demo User",
              email: "demo@watchmen.dev",
              image: null,
            };
          },
        }),
      ]
    : [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          authorization: {
            params: {
              scope: "openid email profile https://www.googleapis.com/auth/cloud-platform",
              access_type: "offline",
              prompt: "consent",
            },
          },
        }),
      ],
  callbacks: {
    signIn({ account, profile }) {
      // Always allow demo credentials
      if (account?.provider === "credentials") return true;
      const email = profile?.email ?? "";
      if (!isAllowed(email)) {
        console.warn(`[auth] blocked sign-in attempt from: ${email}`);
        return false;
      }
      return true;
    },
    async jwt({ token, account }) {
      // Demo credentials: mark as demo, skip OAuth token handling
      if (account?.provider === "credentials") {
        return { ...token, isDemoUser: true };
      }

      // Initial Google sign-in: store tokens from account
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }

      // Demo user: no token refresh needed
      if (token.isDemoUser) return token;

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
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
