import nodemailer from "nodemailer";
import { recordMonitoringEvent } from "./db";

type MonitorSnapshot = {
  startedAt: string;
  llmFailures: number;
  rateLimitEvents: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastLatencyMs: number | null;
  latencyBreaches: number;
  totalRequests: number;
  latencyByRoute: Record<string, RouteLatencyBucket>;
};

export type RouteLatencyBucket = { count: number; sum: number; max: number; samples: number[] };

const snapshot: MonitorSnapshot = {
  startedAt: new Date().toISOString(),
  llmFailures: 0,
  rateLimitEvents: 0,
  lastError: null,
  lastErrorAt: null,
  lastLatencyMs: null,
  latencyBreaches: 0,
  totalRequests: 0,
  latencyByRoute: {},
};

export function recordRateLimit() {
  snapshot.rateLimitEvents += 1;
  void recordMonitoringEvent("monitoring.rate_limit");
}

export function recordLLMFailure(error: unknown) {
  snapshot.llmFailures += 1;
  snapshot.lastError = error instanceof Error ? error.message : "Unknown LLM failure";
  snapshot.lastErrorAt = new Date().toISOString();
  void recordMonitoringEvent("monitoring.llm_failure", { message: snapshot.lastError });
}

export function recordLLMLatency(latencyMs: number, thresholdMs: number) {
  snapshot.lastLatencyMs = latencyMs;
  if (latencyMs > thresholdMs) {
    snapshot.latencyBreaches += 1;
    void recordMonitoringEvent("monitoring.latency_breach", { latencyMs, thresholdMs });
  }
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] || 0);
};

const summarize = (route: string, bucket: RouteLatencyBucket | undefined): LatencySummary => {
  if (!bucket || bucket.count === 0) return { route, count: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  return {
    route,
    count: bucket.count,
    avg: Math.round(bucket.sum / bucket.count),
    p50: percentile(bucket.samples, 50),
    p95: percentile(bucket.samples, 95),
    max: Math.round(bucket.max),
  };
};

export type LatencySummary = { route: string; count: number; avg: number; p50: number; p95: number; max: number };

/** Per-route request latency, kept in memory for the live panel and written to the event log for the 24h view. */
export function recordLatency(route: string, latencyMs: number) {
  const bucket = (snapshot.latencyByRoute[route] ||= { count: 0, sum: 0, max: 0, samples: [] });
  bucket.count += 1;
  bucket.sum += latencyMs;
  bucket.max = Math.max(bucket.max, latencyMs);
  bucket.samples.push(latencyMs);
  if (bucket.samples.length > 200) bucket.samples.shift();
  snapshot.totalRequests += 1;
  snapshot.lastLatencyMs = latencyMs;
  void recordMonitoringEvent("monitoring.latency", { route, ms: Math.round(latencyMs) });
}

/** Summaries of the live (since-process-start) latency windows. */
export function getLatencyByRoute(): LatencySummary[] {
  return Object.keys(snapshot.latencyByRoute)
    .sort()
    .map((route) => summarize(route, snapshot.latencyByRoute[route]));
}

export function getMonitorSnapshot() {
  return { ...snapshot, now: new Date().toISOString(), latencyByRoute: getLatencyByRoute() };
}

type AlertSeverity = "critical" | "warning" | "info";

function formatSlackAlert(subject: string, detail: string, severity: AlertSeverity) {
  const color = severity === "critical" ? "#ff0000" : severity === "warning" ? "#ff9900" : "#36a64f";
  const emoji = severity === "critical" ? ":rotating_light:" : severity === "warning" ? ":warning:" : ":information_source:";
  const text = `${emoji} *${subject}*\n${detail}`;
  return {
    username: "Blueprint Ops",
    icon_emoji: ":rocket:",
    attachments: [{
      color,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `Severity: *${severity.toUpperCase()}* | Time: ${new Date().toISOString()}` },
          ],
        },
      ],
    }],
  };
}

export function notifyOperationalFailure(subject: string, detail: string, severity: AlertSeverity = "critical") {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook) void fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formatSlackAlert(subject, detail, severity)),
    }).catch(() => undefined);
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const alertTo = process.env.ALERT_EMAIL_TO;
  if (smtpHost && smtpUser && smtpPass && alertTo) {
    const transporter = nodemailer.createTransport({ host: smtpHost, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: { user: smtpUser, pass: smtpPass } });
    void transporter.sendMail({ from: process.env.SMTP_FROM || smtpUser, to: alertTo, subject: `[${severity.toUpperCase()}] ${subject}`, text: detail }).catch(() => undefined);
  }
}
