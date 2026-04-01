import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listUserCloudCredentials, deleteUserCloudCredentials } from "@/lib/credentials";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await params;
  if (!["gcp", "aws", "ghcr", "dockerhub", "github"].includes(provider)) {
    return NextResponse.json({ error: "Invalid provider." }, { status: 400 });
  }

  const email = session.user.email;
  try {
    await deleteUserCloudCredentials(email, provider as "gcp" | "aws" | "ghcr" | "dockerhub" | "github");
    const credentials = await listUserCloudCredentials(email);
    return NextResponse.json({ ok: true, credentials });
  } catch (err) {
    console.error("[api/settings/credentials/[provider]] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete credential." }, { status: 500 });
  }
}
