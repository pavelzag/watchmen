import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCloudTraces } from "@/lib/gcp/traces";
import { useMockData, initGoogleAuthFromKey, initUserAuth, getProjectIdsForOrg } from "@/lib/gcp/client";
import { getUserCloudCredentials } from "@/lib/credentials";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (useMockData() || session.isDemoUser) {
    const traces = await getCloudTraces([], true);
    return NextResponse.json({ traces });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  const accessToken = session.accessToken;

  if (!gcpCreds && !accessToken) {
    return NextResponse.json(
      { error: "No GCP credentials configured.", credentialsRequired: true },
      { status: 422 }
    );
  }

  try {
    if (gcpCreds?.serviceAccountKey) {
      initGoogleAuthFromKey(gcpCreds.serviceAccountKey as string);
    } else if (accessToken) {
      initUserAuth(accessToken as string);
    }

    const projectIds = await getProjectIdsForOrg();
    if (projectIds.length === 0) {
      return NextResponse.json({ traces: [] });
    }

    const traces = await getCloudTraces(projectIds);
    return NextResponse.json({ traces });
  } catch (err) {
    console.error("[api/gcp/traces]", err);
    return NextResponse.json({ error: "Failed to fetch traces." }, { status: 500 });
  }
}
