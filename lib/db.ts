import { neon } from "@neondatabase/serverless";

let sqlClient: ReturnType<typeof neon> | null = null;

export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for durable persistence.");
  sqlClient ||= neon(process.env.DATABASE_URL);
  return sqlClient;
}

export async function recordAnalytics(eventName: string, metadata: Record<string, unknown> = {}, userId?: string) {
  const sql = getDb();
  await sql`insert into analytics_events (event_name, metadata, user_id) values (${eventName}, ${JSON.stringify(metadata)}::jsonb, ${userId || null})`;
}

export async function recordMonitoringEvent(eventName: string, metadata: Record<string, unknown> = {}) {
  try {
    await recordAnalytics(eventName, metadata);
  } catch {
    // Monitoring must never make the request path fail.
  }
}

export async function getDurableMonitoring() {
  const sql = getDb();
  const rows = await sql`select event_name, count(*)::int as count, max(created_at) as last_at from analytics_events where event_name in ('monitoring.rate_limit', 'monitoring.llm_failure', 'monitoring.access_denied') and created_at > now() - interval '24 hours' group by event_name` as unknown as Array<{ event_name: string; count: number; last_at: string | null }>;
  const latencyRows = await sql`select metadata->>'route' as route, (metadata->>'ms')::int as ms from analytics_events where event_name = 'monitoring.latency' and created_at > now() - interval '24 hours' and metadata->>'route' is not null` as unknown as Array<{ route: string; ms: number }>;
  const perRoute = new Map<string, number[]>();
  for (const row of latencyRows) {
    if (!row.route || !Number.isFinite(row.ms)) continue;
    const values = perRoute.get(row.route) || [];
    values.push(row.ms);
    perRoute.set(row.route, values);
  }
  const percentile = (values: number[], p: number) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] || 0;
  };
  const latencyByRoute = [...perRoute.entries()]
    .map(([route, values]) => ({
      route,
      count: values.length,
      avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      max: Math.max(...values),
    }))
    .sort((a, b) => b.count - a.count);
  return {
    rateLimitEvents: rows.find((row) => row.event_name === "monitoring.rate_limit")?.count || 0,
    llmFailures: rows.find((row) => row.event_name === "monitoring.llm_failure")?.count || 0,
    accessDenied: rows.find((row) => row.event_name === "monitoring.access_denied")?.count || 0,
    lastErrorAt: rows.find((row) => row.event_name === "monitoring.llm_failure")?.last_at || null,
    latencyByRoute,
  };
}

/**
 * Retention sweep for the analytics table. Monitoring events are transient
 * (they feed the 24-hour panel), and product analytics needs no more than a
 * few months. Called opportunistically from the monitoring endpoint so the
 * database never grows without bound.
 */
let lastMaintenanceAt = 0;

export async function maintainDatabase() {
  if (Date.now() - lastMaintenanceAt < 1000 * 60 * 60) return { skipped: true };
  lastMaintenanceAt = Date.now();
  try {
    const sql = getDb();
    const monitoring = await sql`delete from analytics_events where event_name like 'monitoring.%' and created_at < now() - interval '7 days'` as unknown as Array<{ rowCount?: number }>;
    const entire = await sql`delete from analytics_events where event_name not like 'monitoring.%' and created_at < now() - interval '90 days'` as unknown as Array<{ rowCount?: number }>;
    return { skipped: false, monitoringDeleted: monitoring[0]?.rowCount || 0, analyticsDeleted: entire[0]?.rowCount || 0 };
  } catch {
    return { skipped: false, monitoringDeleted: 0, analyticsDeleted: 0, error: true };
  }
}
