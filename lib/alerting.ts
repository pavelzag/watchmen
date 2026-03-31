/**
 * Alert rules engine.
 * Diffs new findings against the previously stored set and fires a webhook
 * for any new findings that match configured rules.
 */

export interface AlertRules {
  webhookUrl: string;
  onNewCritical: boolean;
  onNewHigh: boolean;
  slackBotToken?: string;
  slackChannelId?: string;
}

export interface AlertFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  resourceName: string;
  projectOrAccount: string;
  cloud: "gcp" | "aws";
}

/**
 * Compute which findings are new by diffing against the previous set of IDs.
 */
export function diffFindings(
  current: AlertFinding[],
  previousIds: string[]
): AlertFinding[] {
  const prevSet = new Set(previousIds);
  return current.filter((f) => !prevSet.has(f.id));
}

/**
 * Filter new findings based on the configured alert rules.
 */
export function filterByRules(
  newFindings: AlertFinding[],
  rules: AlertRules
): AlertFinding[] {
  return newFindings.filter((f) => {
    if (f.severity === "critical" && rules.onNewCritical) return true;
    if (f.severity === "high" && rules.onNewHigh) return true;
    return false;
  });
}

/**
 * Build a Slack-compatible webhook payload.
 */
function buildPayload(findings: AlertFinding[]): object {
  const critCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  const parts: string[] = [];
  if (critCount > 0) parts.push(`${critCount} critical`);
  if (highCount > 0) parts.push(`${highCount} high`);
  const summary = parts.join(", ");

  const lines = findings.slice(0, 10).map((f) => {
    const emoji = f.severity === "critical" ? "🔴" : "🟠";
    return `${emoji} *${f.title}* — \`${f.resourceName}\` (${f.projectOrAccount}, ${f.cloud.toUpperCase()})`;
  });

  if (findings.length > 10) {
    lines.push(`_…and ${findings.length - 10} more_`);
  }

  return {
    text: `🚨 *Watchmen Alert* — ${summary} new finding${findings.length !== 1 ? "s" : ""} detected`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🚨 *Watchmen Security Alert*\n${summary} new finding${findings.length !== 1 ? "s" : ""} detected in your cloud infrastructure.`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: lines.join("\n"),
        },
      },
    ],
  };
}

/**
 * Build a test webhook payload.
 */
export function buildTestPayload(): object {
  return {
    text: "✅ *Watchmen Alert* — Test webhook received successfully",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "✅ *Watchmen Security Alert*\nThis is a test notification. Your webhook is configured correctly.",
        },
      },
    ],
  };
}

/**
 * Fire a webhook with the given payload.
 * Returns true on success, throws on failure.
 */
export async function fireWebhook(url: string, payload: object): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webhook returned ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Post a message to Slack using a bot token via chat.postMessage.
 */
export async function postToSlack(token: string, channel: string, payload: object): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, ...payload }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`Slack API error: ${data.error ?? res.status}`);
  }
}

/**
 * Evaluate alert rules, fire webhook or Slack bot message if needed.
 * Returns the list of new alerted findings.
 */
export async function evaluateAlerts(
  rules: AlertRules,
  currentFindings: AlertFinding[],
  previousIds: string[]
): Promise<AlertFinding[]> {
  const hasSlack = rules.slackBotToken && rules.slackChannelId;
  if (!rules.webhookUrl && !hasSlack) return [];

  const newFindings = diffFindings(currentFindings, previousIds);
  const toAlert = filterByRules(newFindings, rules);

  if (toAlert.length === 0) return [];

  const payload = buildPayload(toAlert);

  if (hasSlack) {
    await postToSlack(rules.slackBotToken!, rules.slackChannelId!, payload);
  } else {
    await fireWebhook(rules.webhookUrl, payload);
  }

  return toAlert;
}
