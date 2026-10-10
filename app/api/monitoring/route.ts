import { NextResponse } from "next/server";
import { getSessionAccount, isAdminEmail } from "../../../lib/auth";
import { jsonError, rejectCrossOrigin } from "../../../lib/api";
import { getDurableMonitoring, maintainDatabase, recordMonitoringEvent } from "../../../lib/db";
import { getMonitorSnapshot } from "../../../lib/monitoring";
import { runRedisSweep } from "../../../lib/redis";

type Viewer = { role: "admin" | "monitor" | "token" | "public"; identity: string | null; canManage: boolean };

async function authorizedViewer(request: Request): Promise<Viewer | null> {
  const configuredToken = process.env.MONITORING_TOKEN;
  if (configuredToken && request.headers.get("authorization") === `Bearer ${configuredToken}`) {
    return { role: "token", identity: "monitoring-token", canManage: false };
  }
  if (process.env.MONITORING_REQUIRE_AUTH === "false" && !configuredToken) {
    return { role: "public", identity: "public", canManage: false };
  }
  if (process.env.MONITORING_REQUIRE_AUTH === "false") return null;
  const account = await getSessionAccount();
  if (!account) return null;
  const isAdmin = account.role === "admin" || isAdminEmail(account.email);
  if (isAdmin) return { role: "admin", identity: account.email, canManage: true };
  if (account.role === "monitor") return { role: "monitor", identity: account.email, canManage: false };
  // A signed-in account without monitoring access: log that they tried to look.
  void recordMonitoringEvent("monitoring.access_denied", { email: account.email });
  return null;
}

export async function GET(request: Request) {
  if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
  try {
    const viewer = await authorizedViewer(request);
    if (!viewer) return NextResponse.json({ error: "Monitoring access requires a granted account or monitoring token.", code: "MONITORING_UNAUTHORIZED" }, { status: 401 });

    let durable = { rateLimitEvents: 0, llmFailures: 0, accessDenied: 0, lastErrorAt: null as string | null, latencyByRoute: [] as Array<{ route: string; count: number; avg: number; p50: number; p95: number; max: number }> };
    let retention = { skipped: true };
    if (process.env.DATABASE_URL) {
      try {
        durable = await getDurableMonitoring();
        retention = await maintainDatabase();
      } catch {
        // Readiness below still reports that the database is configured.
      }
    }

    let redisSweep: Record<string, unknown> | null = null;
    if (viewer.canManage && new URL(request.url).searchParams.get("sweep") === "1") {
      try {
        redisSweep = await runRedisSweep();
      } catch (error) {
        redisSweep = { configured: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    return NextResponse.json({
      status: "ok",
      viewer: viewer.identity,
      role: viewer.role,
      canManage: viewer.canManage,
      provider: process.env.LLM_PROVIDER || "mock",
      model: process.env.LLM_MODEL || null,
      redisConfigured: Boolean(process.env.REDIS_REST_URL && process.env.REDIS_REST_TOKEN),
      checks: {
        llm: {
          configured: Boolean(process.env.LLM_PROVIDER && process.env.LLM_MODEL && (process.env.LLM_PROVIDER === "ollama" || (process.env.LLM_BASE_URL && process.env.LLM_API_KEY))),
          detail: process.env.LLM_PROVIDER === "ollama" ? "Ollama endpoint configured" : "Hosted provider credentials configured",
        },
        redis: {
          configured: Boolean(process.env.REDIS_REST_URL && process.env.REDIS_REST_TOKEN),
          detail: process.env.REQUIRE_REDIS === "true" ? "Required in production" : "Optional fallback enabled",
        },
        database: {
          configured: Boolean(process.env.DATABASE_URL),
          detail: "Neon connection configured",
        },
        auth: {
          configured: Boolean(process.env.AUTH_SECRET && process.env.DATABASE_URL),
          detail: process.env.AUTH_SECRET && process.env.DATABASE_URL ? "Monitoring console accounts only — the interview product runs without sign-in" : "AUTH_SECRET and DATABASE_URL required",
        },
        alerts: {
          configured: Boolean(process.env.ALERT_WEBHOOK_URL || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ALERT_EMAIL_TO)),
          detail: process.env.ALERT_WEBHOOK_URL || process.env.SMTP_HOST ? "Webhook or SMTP alerting configured" : "Add alert webhook or SMTP settings",
        },
        durableMonitoring: {
          configured: Boolean(process.env.DATABASE_URL),
          detail: process.env.DATABASE_URL ? "Analytics event storage configured" : "DATABASE_URL required",
        },
      },
      snapshot: {
        ...getMonitorSnapshot(),
        durableRateLimitEvents: durable.rateLimitEvents,
        durableLLMFailures: durable.llmFailures,
        durableAccessDenied: durable.accessDenied,
        durableLastErrorAt: durable.lastErrorAt,
        retention,
      },
      latencyByRoute: durable.latencyByRoute,
      redisSweep,
    });
  } catch {
    return jsonError(request, "Monitoring is temporarily unavailable.", 503, "MONITORING_UNAVAILABLE");
  }
}