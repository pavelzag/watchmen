import { google } from "googleapis";

export interface PubsubAuthResult {
  ok: boolean;
  status?: number;
  error?: string;
  email?: string;
}

export interface PubsubJwtPayload {
  email?: string;
  email_verified?: boolean;
  aud?: string | string[];
  iss?: string;
}

export type PubsubTokenVerifier = (idToken: string, audience?: string | string[]) => Promise<PubsubJwtPayload | undefined>;

const defaultOAuthClient = new google.auth.OAuth2();

let customVerifier: PubsubTokenVerifier | null = null;

export function setPubsubTokenVerifierForTests(verifier: PubsubTokenVerifier | null): void {
  customVerifier = verifier;
}

async function verifyWithGoogle(idToken: string, audience?: string | string[]): Promise<PubsubJwtPayload | undefined> {
  if (customVerifier) {
    return customVerifier(idToken, audience);
  }
  const ticket = await defaultOAuthClient.verifyIdToken({
    idToken,
    audience,
  });
  return ticket.getPayload();
}

function parseCsvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isPubsubOidcRequired(): boolean {
  return (
    process.env.GCP_PUBSUB_REQUIRE_OIDC === "true" ||
    Boolean(process.env.GCP_PUBSUB_PUSH_AUDIENCE?.trim()) ||
    Boolean(process.env.GCP_PUBSUB_PUSH_EMAIL?.trim())
  );
}

function resolveExpectedAudiences(requestUrl: string): string[] | undefined {
  const configured = parseCsvList(process.env.GCP_PUBSUB_PUSH_AUDIENCE);
  if (configured.length > 0) return configured;

  try {
    const parsed = new URL(requestUrl);
    const originPath = `${parsed.origin}${parsed.pathname}`;
    const baseUrl = process.env.WATCHMEN_BASE_URL?.trim();
    const candidates = [requestUrl, originPath];
    if (baseUrl) {
      candidates.push(`${baseUrl.replace(/\/$/, "")}${parsed.pathname}`);
    }
    return [...new Set(candidates)];
  } catch {
    return undefined;
  }
}

export async function verifyPubsubPushRequest(req: Pick<Request, "headers" | "url">): Promise<PubsubAuthResult> {
  const required = isPubsubOidcRequired();
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const idToken = bearerMatch?.[1]?.trim();

  if (!idToken) {
    if (!required) {
      return { ok: true };
    }
    return {
      ok: false,
      status: 401,
      error: "Missing Pub/Sub OIDC bearer token.",
    };
  }

  try {
    const expectedAudiences = resolveExpectedAudiences(req.url);
    const payload = await verifyWithGoogle(idToken, expectedAudiences);
    if (!payload) {
      return {
        ok: false,
        status: 401,
        error: "Invalid Pub/Sub OIDC token payload.",
      };
    }

    if (payload.email_verified === false) {
      return {
        ok: false,
        status: 403,
        error: "Pub/Sub OIDC token email is not verified.",
      };
    }

    const allowedEmails = parseCsvList(process.env.GCP_PUBSUB_PUSH_EMAIL);
    if (allowedEmails.length > 0) {
      const tokenEmail = (payload.email ?? "").trim().toLowerCase();
      if (!tokenEmail || !allowedEmails.some((allowed) => allowed.toLowerCase() === tokenEmail)) {
        return {
          ok: false,
          status: 403,
          error: "Pub/Sub OIDC token email does not match GCP_PUBSUB_PUSH_EMAIL.",
        };
      }
    }

    return { ok: true, email: payload.email };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      error: error instanceof Error ? `Invalid Pub/Sub OIDC token: ${error.message}` : "Invalid Pub/Sub OIDC token.",
    };
  }
}
