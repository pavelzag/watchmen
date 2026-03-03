import { IAMClient, ListUsersCommand, ListRolesCommand, ListAttachedUserPoliciesCommand, ListUserPoliciesCommand, ListGroupsForUserCommand, ListAccessKeysCommand, GetAccessKeyLastUsedCommand, GetLoginProfileCommand, ListMFADevicesCommand, ListAttachedRolePoliciesCommand, ListRolePoliciesCommand, GetRolePolicyCommand } from "@aws-sdk/client-iam";
import { useMockAwsData, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsIamUser, AwsIamRole, AwsAccessKey } from "./types";

async function getMockIamUsers(): Promise<AwsIamUser[]> {
  const data = await import("@/fixtures/aws/iam-users.json");
  return data.default as AwsIamUser[];
}

async function getMockIamRoles(): Promise<AwsIamRole[]> {
  const data = await import("@/fixtures/aws/iam-roles.json");
  return data.default as unknown as AwsIamRole[];
}

async function getRealIamUsers(creds?: AwsCredentials): Promise<AwsIamUser[]> {
  const client = new IAMClient(getAwsClientOptions("us-east-1", creds));
  const users: AwsIamUser[] = [];

  try {
    const listRes = await client.send(new ListUsersCommand({ MaxItems: 1000 }));
    const rawUsers = listRes.Users ?? [];

    const settled = await Promise.allSettled(
      rawUsers.map(async (u): Promise<AwsIamUser> => {
        const userName = u.UserName!;
        const accountId = u.Arn!.split(":")[4];

        const [attachedRes, groupsRes, keysRes, mfaRes] = await Promise.allSettled([
          client.send(new ListAttachedUserPoliciesCommand({ UserName: userName })),
          client.send(new ListGroupsForUserCommand({ UserName: userName })),
          client.send(new ListAccessKeysCommand({ UserName: userName })),
          client.send(new ListMFADevicesCommand({ UserName: userName })),
        ]);

        const attachedPolicies =
          attachedRes.status === "fulfilled"
            ? (attachedRes.value.AttachedPolicies ?? []).map((p) => p.PolicyArn!)
            : [];
        const groups =
          groupsRes.status === "fulfilled"
            ? (groupsRes.value.Groups ?? []).map((g) => g.GroupName!)
            : [];
        const mfaEnabled =
          mfaRes.status === "fulfilled" ? (mfaRes.value.MFADevices ?? []).length > 0 : false;

        const rawKeys =
          keysRes.status === "fulfilled" ? (keysRes.value.AccessKeyMetadata ?? []) : [];

        const accessKeys: AwsAccessKey[] = await Promise.all(
          rawKeys.map(async (k): Promise<AwsAccessKey> => {
            let lastUsedDate: string | undefined;
            let lastUsedService: string | undefined;
            let lastUsedRegion: string | undefined;
            try {
              const lu = await client.send(
                new GetAccessKeyLastUsedCommand({ AccessKeyId: k.AccessKeyId! })
              );
              lastUsedDate = lu.AccessKeyLastUsed?.LastUsedDate?.toISOString();
              lastUsedService = lu.AccessKeyLastUsed?.ServiceName ?? undefined;
              lastUsedRegion = lu.AccessKeyLastUsed?.Region ?? undefined;
            } catch { }
            return {
              accessKeyId: k.AccessKeyId!,
              status: k.Status as "Active" | "Inactive",
              createDate: k.CreateDate!.toISOString(),
              lastUsedDate,
              lastUsedService,
              lastUsedRegion,
            };
          })
        );

        let passwordLastUsed: string | undefined;
        try {
          const lp = await client.send(new GetLoginProfileCommand({ UserName: userName }));
          passwordLastUsed = u.PasswordLastUsed?.toISOString();
          void lp;
        } catch { }

        return {
          userName,
          userId: u.UserId!,
          arn: u.Arn!,
          accountId,
          createDate: u.CreateDate!.toISOString(),
          passwordLastUsed,
          mfaEnabled,
          accessKeys,
          attachedPolicies,
          groups,
          inlinePolicies: [],
          tags: Object.fromEntries((u.Tags ?? []).map((t) => [t.Key!, t.Value!])),
        };
      })
    );

    for (const r of settled) {
      if (r.status === "fulfilled") users.push(r.value);
      else logAwsWarning("iam/users", "unknown", r.reason);
    }
  } catch (err) {
    logAwsWarning("iam/users", "global", err);
  }

  return users;
}

async function getRealIamRoles(creds?: AwsCredentials): Promise<AwsIamRole[]> {
  const client = new IAMClient(getAwsClientOptions("us-east-1", creds));
  const roles: AwsIamRole[] = [];

  try {
    const listRes = await client.send(new ListRolesCommand({ MaxItems: 1000 }));
    const rawRoles = listRes.Roles ?? [];

    const settled = await Promise.allSettled(
      rawRoles.map(async (r): Promise<AwsIamRole> => {
        const roleName = r.RoleName!;
        const accountId = r.Arn!.split(":")[4];

        const [attachedRes, inlineRes] = await Promise.allSettled([
          client.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName })),
          client.send(new ListRolePoliciesCommand({ RoleName: roleName })),
        ]);

        const attachedPolicies =
          attachedRes.status === "fulfilled"
            ? (attachedRes.value.AttachedPolicies ?? []).map((p) => p.PolicyArn!)
            : [];
        const inlinePolicies =
          inlineRes.status === "fulfilled"
            ? (inlineRes.value.PolicyNames ?? [])
            : [];

        const doc = r.AssumeRolePolicyDocument
          ? JSON.parse(decodeURIComponent(r.AssumeRolePolicyDocument))
          : { Statement: [] };

        return {
          roleName,
          roleId: r.RoleId!,
          arn: r.Arn!,
          accountId,
          createDate: r.CreateDate!.toISOString(),
          assumeRolePolicyStatements: (doc.Statement ?? []).map((s: Record<string, unknown>) => ({
            effect: s.Effect as "Allow" | "Deny",
            principals: Array.isArray(s.Principal)
              ? s.Principal
              : typeof s.Principal === "object" && s.Principal !== null
                ? Object.values(s.Principal as Record<string, string[]>).flat()
                : [String(s.Principal ?? "*")],
            actions: Array.isArray(s.Action) ? s.Action : [String(s.Action ?? "*")],
            resources: Array.isArray(s.Resource) ? s.Resource : [String(s.Resource ?? "*")],
          })),
          attachedPolicies,
          inlinePolicies,
          maxSessionDuration: r.MaxSessionDuration ?? 3600,
          tags: Object.fromEntries((r.Tags ?? []).map((t) => [t.Key!, t.Value!])),
          lastUsedDate: r.RoleLastUsed?.LastUsedDate?.toISOString(),
          lastUsedRegion: r.RoleLastUsed?.Region ?? undefined,
        };
      })
    );

    for (const res of settled) {
      if (res.status === "fulfilled") roles.push(res.value);
      else logAwsWarning("iam/roles", "unknown", res.reason);
    }
  } catch (err) {
    logAwsWarning("iam/roles", "global", err);
  }

  return roles;
}

export async function getIamUsers(creds?: AwsCredentials, forceMock?: boolean): Promise<AwsIamUser[]> {
  if (useMockAwsData(forceMock)) return getMockIamUsers();
  return getRealIamUsers(creds);
}

export async function getIamRoles(creds?: AwsCredentials, forceMock?: boolean): Promise<AwsIamRole[]> {
  if (useMockAwsData(forceMock)) return getMockIamRoles();
  return getRealIamRoles(creds);
}
