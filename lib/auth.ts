import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      const email = profile?.email ?? "";
      if (!isAllowed(email)) {
        console.warn(`[auth] blocked sign-in attempt from: ${email}`);
        return false;
      }
      return true;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
