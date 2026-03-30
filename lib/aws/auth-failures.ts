import {
  CloudTrailClient,
  LookupEventsCommand,
} from "@aws-sdk/client-cloudtrail";
import { useMockAwsData } from "./client";

export interface AwsAuthFailure {
  timestamp: string;
  principal: string;
  eventName: string;
  sourceIp?: string;
  region: string;
  accountId: string;
  errorCode: string;
  errorMessage: string;
}

async function getMockAuthFailures(): Promise<AwsAuthFailure[]> {
  const now = Date.now();
  return [
    {
      timestamp: new Date(now - 20 * 60 * 1000).toISOString(),
      principal: "alice@corp.com",
      eventName: "ConsoleLogin",
      sourceIp: "203.0.113.10",
      region: "us-east-1",
      accountId: "123456789012",
      errorCode: "FailedAuthentication",
      errorMessage: "Failed authentication",
    },
    {
      timestamp: new Date(now - 45 * 60 * 1000).toISOString(),
      principal: "AKIAIOSFODNN7EXAMPLE",
      eventName: "GetObject",
      sourceIp: "198.51.100.77",
      region: "us-east-1",
      accountId: "123456789012",
      errorCode: "AccessDenied",
      errorMessage: "Access Denied",
    },
    {
      timestamp: new Date(now - 90 * 60 * 1000).toISOString(),
      principal: "arn:aws:iam::123456789012:role/ci-role",
      eventName: "AssumeRole",
      sourceIp: "10.0.1.5",
      region: "us-west-2",
      accountId: "123456789012",
      errorCode: "AccessDenied",
      errorMessage: "User is not authorized to perform: sts:AssumeRole",
    },
  ];
}

async function getRealAuthFailures(
  accountIds: string[],
  hours: number
): Promise<AwsAuthFailure[]> {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const client = new CloudTrailClient({ region });

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  const endTime = new Date();

  // Fetch console login failures and access denied errors
  const [loginRes, accessDeniedRes] = await Promise.allSettled([
    client.send(new LookupEventsCommand({
      LookupAttributes: [{ AttributeKey: "EventName", AttributeValue: "ConsoleLogin" }],
      StartTime: startTime,
      EndTime: endTime,
      MaxResults: 50,
    })),
    client.send(new LookupEventsCommand({
      LookupAttributes: [{ AttributeKey: "EventName", AttributeValue: "AccessDenied" }],
      StartTime: startTime,
      EndTime: endTime,
      MaxResults: 100,
    })),
  ]);

  const entries: AwsAuthFailure[] = [];

  if (loginRes.status === "fulfilled") {
    for (const e of loginRes.value.Events ?? []) {
      const detail = e.CloudTrailEvent ? JSON.parse(e.CloudTrailEvent) : {};
      if (detail.responseElements?.ConsoleLogin !== "Failure") continue;
      entries.push({
        timestamp: e.EventTime?.toISOString() ?? "",
        principal: e.Username ?? detail.userIdentity?.arn ?? "unknown",
        eventName: "ConsoleLogin",
        sourceIp: detail.sourceIPAddress,
        region: detail.awsRegion ?? region,
        accountId: detail.recipientAccountId ?? accountIds[0] ?? "",
        errorCode: "FailedAuthentication",
        errorMessage: "Failed authentication",
      });
    }
  }

  if (accessDeniedRes.status === "fulfilled") {
    for (const e of accessDeniedRes.value.Events ?? []) {
      const detail = e.CloudTrailEvent ? JSON.parse(e.CloudTrailEvent) : {};
      if (!detail.errorCode) continue;
      entries.push({
        timestamp: e.EventTime?.toISOString() ?? "",
        principal: e.Username ?? detail.userIdentity?.arn ?? "unknown",
        eventName: e.EventName ?? "",
        sourceIp: detail.sourceIPAddress,
        region: detail.awsRegion ?? region,
        accountId: detail.recipientAccountId ?? accountIds[0] ?? "",
        errorCode: detail.errorCode ?? "AccessDenied",
        errorMessage: detail.errorMessage ?? "",
      });
    }
  }

  return entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getAwsAuthFailures(
  accountIds: string[],
  hours: number,
  forceMock?: boolean
): Promise<AwsAuthFailure[]> {
  if (useMockAwsData(forceMock)) return getMockAuthFailures();
  return getRealAuthFailures(accountIds, hours);
}
