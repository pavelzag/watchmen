import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { google } from "googleapis";
import { getUserCloudCredentials } from "@/lib/credentials";
import { initGoogleAuthFromKey, initUserAuth } from "@/lib/gcp/client";
import { getUserGcpTraceSourceConfig, saveUserGcpTraceSourceConfig } from "@/lib/trace-source";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getUserGcpTraceSourceConfig(session.user.email);
  if (config.mode !== "streaming") {
    return NextResponse.json({
      ok: true,
      state: "receiving_events",
      message: "Polling mode is active.",
      config: { ...config, setupState: "receiving_events" },
      details: {},
    });
  }

  if (!config.projectId.trim()) {
    return NextResponse.json({ error: "Set the GCP project id before checking setup." }, { status: 400 });
  }

  const gcpCreds = await getUserCloudCredentials(session.user.email, "gcp");
  const accessToken = session.accessToken;
  if (!gcpCreds && !accessToken) {
    return NextResponse.json({ error: "No GCP credentials configured." }, { status: 422 });
  }

  try {
    if (gcpCreds?.serviceAccountKey) {
      initGoogleAuthFromKey(gcpCreds.serviceAccountKey as string);
    } else if (accessToken) {
      initUserAuth(accessToken as string);
    }

    const topicName = `${config.namePrefix}-topic`;
    const subscriptionName = `${config.namePrefix}-subscription`;
    const sinkName = `${config.namePrefix}-sink`;

    const pubsub = google.pubsub("v1");
    const logging = google.logging("v2");

    const topicFullName = `projects/${config.projectId}/topics/${topicName}`;
    const subscriptionFullName = `projects/${config.projectId}/subscriptions/${subscriptionName}`;
    const sinkFullName = `projects/${config.projectId}/sinks/${sinkName}`;

    const [topicRes, subRes, sinkRes] = await Promise.allSettled([
      pubsub.projects.topics.get({ topic: topicFullName }),
      pubsub.projects.subscriptions.get({ subscription: subscriptionFullName }),
      logging.projects.sinks.get({ sinkName: sinkFullName }),
    ]);

    const details = {
      topic: topicRes.status === "fulfilled",
      subscription: subRes.status === "fulfilled",
      sink: sinkRes.status === "fulfilled",
    };

    const allPresent = details.topic && details.subscription && details.sink;
    const nextConfig = {
      ...config,
      setupState: allPresent ? "resources_applied" as const : "terraform_generated" as const,
      lastCheckedAt: new Date().toISOString(),
      lastCheckMessage: allPresent
        ? "Streaming resources detected. Generate live traffic to confirm Pub/Sub delivery into Watchmen."
        : "Some expected resources are still missing. Re-apply Terraform and check again.",
    };
    await saveUserGcpTraceSourceConfig(session.user.email, nextConfig);

    return NextResponse.json({
      ok: true,
      state: nextConfig.setupState,
      message: nextConfig.lastCheckMessage,
      details,
      config: nextConfig,
      expected: {
        topic: topicFullName,
        subscription: subscriptionFullName,
        sink: sinkFullName,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to verify GCP resources.";
    const nextConfig = {
      ...config,
      lastCheckedAt: new Date().toISOString(),
      lastCheckMessage: message,
    };
    await saveUserGcpTraceSourceConfig(session.user.email, nextConfig);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
