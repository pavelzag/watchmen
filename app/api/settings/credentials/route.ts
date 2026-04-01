import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { initGoogleAuthFromKey } from "@/lib/gcp/client";
import {
  ensureCredentialsTable,
  listUserCloudCredentials,
  saveUserCloudCredentials,
} from "@/lib/credentials";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureCredentialsTable();
    const credentials = await listUserCloudCredentials(session.user.email);
    return NextResponse.json({ credentials });
  } catch (err) {
    console.error("[api/settings/credentials] GET error:", err);
    return NextResponse.json({ error: "Failed to load credentials." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider, credentials } = (await req.json()) as {
    provider: "gcp" | "aws" | "ghcr" | "dockerhub" | "github";
    credentials: Record<string, string>;
  };

  if (!["gcp", "aws", "ghcr", "dockerhub", "github"].includes(provider)) {
    return NextResponse.json({ error: "Invalid provider." }, { status: 400 });
  }

  if (provider === "gcp") {
    if (!credentials?.serviceAccountKey) {
      return NextResponse.json({ error: "serviceAccountKey is required." }, { status: 400 });
    }
    try {
      initGoogleAuthFromKey(credentials.serviceAccountKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `GCP credential validation failed: ${msg}` },
        { status: 422 }
      );
    }
  } else if (provider === "aws") {
    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
      return NextResponse.json(
        { error: "accessKeyId and secretAccessKey are required." },
        { status: 400 }
      );
    }
    try {
      const sts = new STSClient({
        region: credentials.region ?? "us-east-1",
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
        },
      });
      await sts.send(new GetCallerIdentityCommand({}));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `AWS credential test failed: ${msg}` },
        { status: 422 }
      );
    }
  } else if (provider === "ghcr") {
    if (!credentials?.token) {
      return NextResponse.json({ error: "Token is required for GitHub Container Registry." }, { status: 400 });
    }
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { 
          Authorization: `Bearer ${credentials.token}`,
          "User-Agent": "Watchmen-App"
        }
      });
      if (!res.ok) throw new Error("Invalid GitHub token or insufficient scope");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `GHCR validation failed: ${msg}` },
        { status: 422 }
      );
    }
  } else if (provider === "dockerhub") {
    if (!credentials?.username || !credentials?.token) {
      return NextResponse.json({ error: "Username and Token are required for Docker Hub." }, { status: 400 });
    }
    try {
      const res = await fetch("https://hub.docker.com/v2/users/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.token
        })
      });
      if (!res.ok) throw new Error("Invalid Docker Hub credentials");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Docker Hub validation failed: ${msg}` },
        { status: 422 }
      );
    }
  } else if (provider === "github") {
    if (!credentials?.token) {
      return NextResponse.json({ error: "Token is required for GitHub." }, { status: 400 });
    }
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${credentials.token}`, "User-Agent": "Watchmen-App" }
      });
      if (!res.ok) throw new Error("Invalid GitHub token");
      const user = await res.json();
      // store login alongside token for display
      credentials.login = user.login;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `GitHub validation failed: ${msg}` }, { status: 422 });
    }
  }

  try {
    await ensureCredentialsTable();
    await saveUserCloudCredentials(session.user.email, provider, credentials);
    const updated = await listUserCloudCredentials(session.user.email);
    return NextResponse.json({ ok: true, credentials: updated });
  } catch (err) {
    console.error("[api/settings/credentials] POST error:", err);
    return NextResponse.json({ error: "Failed to save credentials." }, { status: 500 });
  }
}
