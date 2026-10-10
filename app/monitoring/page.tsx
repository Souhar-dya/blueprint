"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Check = { configured: boolean; detail: string };
type LatencyRow = { route: string; count: number; avg: number; p50: number; p95: number; max: number };
type MonitoringUser = { id: string; email: string; role: string; created_at: string };

type Health = {
  status: string;
  provider: string;
  model: string | null;
  viewer: string | null;
  role: string;
  canManage: boolean;
  redisConfigured: boolean;
  checks: Record<string, Check>;
  snapshot: {
    llmFailures: number;
    rateLimitEvents: number;
    durableLLMFailures?: number;
    durableRateLimitEvents?: number;
    durableAccessDenied?: number;
    lastError: string | null;
    totalRequests?: number;
    latencyBreaches?: number;
    retention?: { skipped?: boolean; monitoringDeleted?: number; analyticsDeleted?: number; error?: boolean };
    latencyByRoute?: LatencyRow[];
  };
  latencyByRoute?: LatencyRow[];
  redisSweep?: { configured?: boolean; scanned?: number; removed?: number; keysBefore?: number; error?: string } | null;
};

const formatMs = (value: number | undefined) => (value === undefined ? "—" : value === 0 ? "0 ms" : `${value} ms`);

const roleChip = (role: string | undefined) => (
  <span key={role} className={`monitor-chip ${role === "admin" ? "admin" : role === "monitor" ? "monitor" : "user"}`}>{role || "user"}</span>
);

export default function MonitoringPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<MonitoringUser[]>([]);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminError, setAdminError] = useState("");
  const [sweep, setSweep] = useState(health?.redisSweep || null);
  const [sweeping, setSweeping] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "monitor" });
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const loadMonitoring = () => {
    fetch("/api/monitoring").then(async (response) => {
      const data = await response.json() as Health & { error?: string };
      if (!response.ok) throw new Error(data.error || "Monitoring unavailable");
      setHealth(data);
      setSweep(data.redisSweep || null);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Monitoring unavailable"));
  };

  useEffect(() => {
    loadMonitoring();
  }, []);

  const loadUsers = () => {
    fetch("/api/monitoring/users").then(async (response) => {
      const data = await response.json() as { users?: MonitoringUser[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load accounts.");
      setUsers(data.users || []);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load accounts."));
  };

  useEffect(() => {
    if (health?.canManage) loadUsers();
  }, [health?.canManage]);

  const performAdmin = (action: "upsert" | "set-role" | "delete", payload: Record<string, string>) => {
    setAdminMessage("");
    setAdminError("");
    return fetch("/api/monitoring/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    }).then(async (response) => {
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Action failed.");
      loadUsers();
      setAdminMessage("Accounts updated.");
    }).catch((reason: unknown) => setAdminError(reason instanceof Error ? reason.message : "Action failed."));
  };

  const addUser = (event: FormEvent) => {
    event.preventDefault();
    if (newUser.email.trim() && newUser.password.length >= 12) {
      void performAdmin("upsert", { email: newUser.email, password: newUser.password, role: newUser.role });
    } else {
      setAdminError("Use a valid email and a password of at least 12 characters.");
    }
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    setPasswordMessage("");
    setPasswordError("");
    if (passwordForm.next.length < 12) {
      setPasswordError("Use at least 12 characters.");
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError("New passwords don't match.");
      return;
    }
    fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: passwordForm.current, newPassword: passwordForm.next }),
    }).then(async (response) => {
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to change the password.");
      setPasswordForm({ current: "", next: "", confirm: "" });
      setPasswordMessage("Password updated — use the new one next time you sign in.");
    }).catch((reason: unknown) => setPasswordError(reason instanceof Error ? reason.message : "Unable to change the password."));
  };

  const runSweep = () => {
    setSweeping(true);
    setAdminError("");
    fetch("/api/monitoring?sweep=1").then(async (response) => {
      const data = await response.json() as Health & { error?: string };
      if (!response.ok) throw new Error(data.error || "Sweep failed.");
      setHealth(data);
      setSweep(data.redisSweep || null);
      setAdminMessage("Redis key sweep complete.");
    }).catch((reason: unknown) => setAdminError(reason instanceof Error ? reason.message : "Sweep failed."))
      .finally(() => setSweeping(false));
  };

  const liveLatency = health?.snapshot.latencyByRoute || [];
  const durableLatency = health?.latencyByRoute || [];

  return <main className="shell content-page">
    <nav className="nav">
      <Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link>
      <div className="monitor-nav"><span className="monitor-live"><i /> Live operations</span><Link href="/scenarios" className="text-link">Back to interviews</Link></div>
    </nav>
    <section className="monitoring-wrap">
      <div className="monitoring-heading"><div><div className="eyebrow">Operations / live status</div><h1>System monitoring</h1><p className="lede">A focused view of interviewer health, infrastructure dependencies, latency, and who has access. The interview product itself runs fully anonymous — only this console holds accounts.</p></div><div className="monitoring-refresh"><span className="monitor-pulse" /> Process status <strong>{health?.status || "Loading"}</strong></div></div>
      {error && <p role="alert" className="monitor-alert">{error} Set <code>MONITORING_ADMIN_EMAILS</code> to the signed-in user email, then <Link href="/auth" className="text-link">sign in here</Link>.</p>}
      {health && <><div className="monitor-note"><span className="dot lime" /> Access verified for <strong>{health.viewer || health.role}</strong>{roleChip(health.role)} <span className="monitor-warn">{health.role !== "admin" && health.role !== "monitor" ? "Read-only view — granted by an admin." : health.role === "monitor" ? "Read-only view." : "Admin view — manage access below."}</span></div>
        <div className="monitor-grid">
          <article className="monitor-card monitor-card-feature"><div className="monitor-card-top"><span className="eyebrow">Provider</span><span className="health-chip healthy"><i /> Operational</span></div><h2>{health.provider}</h2><p className="monitor-value-sub">{health.model || "Default model"}</p><div className="monitor-card-foot"><span>Interview generation</span><span className="metric-arrow">↗</span></div></article>
          <article className="monitor-card"><div className="monitor-card-top"><span className="eyebrow">Redis</span><span className={`health-chip ${health.redisConfigured ? "healthy" : "warning"}`}><i /> {health.redisConfigured ? "Connected" : "Not configured"}</span></div><h3>{health.redisConfigured ? "Rate limiting active" : "Fallback mode"}</h3><p>{health.redisConfigured ? "Self-expiring rate-limit counters are the only keys stored." : "The app is using configured fallback behavior."}</p></article>
          <article className="monitor-card metric-card"><div className="monitor-card-top"><span className="eyebrow">LLM failures</span><span className="metric-period">24h durable</span></div><strong className="metric-number">{health.snapshot.durableLLMFailures ?? health.snapshot.llmFailures}</strong><p>{health.snapshot.lastError || "No failures recorded."}</p></article>
          <article className="monitor-card metric-card"><div className="monitor-card-top"><span className="eyebrow">Rate-limit events</span><span className="metric-period">24h durable</span></div><strong className="metric-number">{health.snapshot.durableRateLimitEvents ?? health.snapshot.rateLimitEvents}</strong><p>Requests rejected after reaching a limit.</p></article>
          <article className="monitor-card metric-card"><div className="monitor-card-top"><span className="eyebrow">Access attempts</span><span className="metric-period">24h durable</span></div><strong className="metric-number">{health.snapshot.durableAccessDenied ?? 0}</strong><p>Signed-in accounts without monitoring access that tried to look.</p></article>
          <article className="monitor-card metric-card"><div className="monitor-card-top"><span className="eyebrow">Requests · breaches</span><span className="metric-period">process live</span></div><strong className="metric-number">{health.snapshot.totalRequests ?? 0}</strong><p>{health.snapshot.latencyBreaches ?? 0} slow responses over the latency threshold.</p></article>
        </div>

        <div className="monitor-panel"><div className="monitor-card-top"><div><div className="eyebrow">Latency · 24h durable</div><h3>Per-route timing</h3><p className="lede">p50 / p95 / max for every instrumented endpoint. The same routes also write process-live windows shown on the right.</p></div></div>{durableLatency.length === 0 && liveLatency.length === 0 ? <p className="monitor-empty">No requests measured yet — latency starts recording as soon as interviews run.</p> : <table className="monitor-table"><thead><tr><th>Route</th><th>Requests (24h)</th><th>p50</th><th>p95</th><th>Max</th></tr></thead><tbody>{durableLatency.length > 0 ? durableLatency.map((row) => <tr key={row.route}><td><strong>/{row.route}</strong></td><td>{row.count}</td><td>{formatMs(row.p50)}</td><td>{formatMs(row.p95)}</td><td><strong>{formatMs(row.max)}</strong></td></tr>) : liveLatency.map((row) => <tr key={row.route}><td><strong>/{row.route}</strong></td><td>{row.count}</td><td>{formatMs(row.p50)}</td><td>{formatMs(row.p95)}</td><td><strong>{formatMs(row.max)}</strong></td></tr>)}</tbody></table>}</div>

        <div className="monitor-panel"><div className="monitor-card-top"><div><div className="eyebrow">Redis budget</div><h3>Key compaction</h3><p className="lede">Every rate-limit key self-expires. This sweep removes any counter that lost its TTL (for example, after a process crash), reclaiming space in a small Redis budget.</p></div></div>
          <div className="monitor-note-row" style={{ marginTop: 14 }}>
            {health.canManage ? <button className="tool-button" onClick={runSweep} disabled={sweeping}>{sweeping ? "Sweeping…" : "Run Redis key sweep"}</button> : <span className="monitor-empty">Admins can run the sweep from this panel.</span>}
            {sweep && <span className="monitor-empty">Last sweep: {sweep.configured === false && sweep.error ? `could not connect (${sweep.error})` : sweep.configured === false ? "Redis not configured" : `${sweep.keysBefore} keys scanned, ${sweep.removed} expired counters removed`}</span>}
            {!sweep && !sweeping && <span className="monitor-empty">No sweep run this session.</span>}
          </div>
        </div>

        {health.canManage && <div className="monitor-panel"><div className="monitor-card-top"><div><div className="eyebrow">Access control</div><h3>Monitoring accounts</h3><p className="lede">Add new accounts or change access here. The interview product never signs anyone in — these credentials only unlock this console, and only admins can list them.</p></div><span className="monitor-chip admin">You are admin</span></div>
          {adminMessage && <p role="status" className="monitor-note" style={{ marginTop: 12 }}>{adminMessage}</p>}
          {adminError && <p role="alert" className="monitor-alert" style={{ marginTop: 12 }}>{adminError}</p>}
          <h4>Add account</h4>
          <form className="monitor-form" onSubmit={addUser}>
            <input type="email" placeholder="analyst@company.com" aria-label="Email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} required />
            <input type="password" minLength={12} placeholder="Password (12+ chars)" aria-label="Password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} required />
            <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })} aria-label="Role"><option value="monitor">Monitor (read-only)</option><option value="admin">Admin (manage access)</option></select>
            <button className="primary-button" type="submit">Add account</button>
          </form>
          <h4>Current accounts</h4>
          {users.length === 0 && <p className="monitor-empty">No accounts yet. Register the first one at /auth with an email listed in MONITORING_ADMIN_EMAILS.</p>}
          {users.map((user) => <div className="monitor-row" key={user.id}>
            <div className="monitor-row-cell"><strong>{user.email}</strong><span>{new Date(user.created_at).toLocaleDateString()}</span></div>
            <div className="monitor-row-actions">{roleChip(user.role)}<button className="tool-button" onClick={() => void performAdmin("set-role", { id: user.id, role: "monitor" })} disabled={user.role === "monitor"}>View only</button><button className="tool-button" onClick={() => void performAdmin("set-role", { id: user.id, role: "admin" })} disabled={user.role === "admin"}>Grant admin</button><button className="tool-button" onClick={() => void performAdmin("delete", { id: user.id })}>Remove</button></div>
          </div>)}
        </div>}

        {(health.role === "admin" || health.role === "monitor") && <div className="monitor-panel"><div className="monitor-card-top"><div><div className="eyebrow">Your account</div><h3>Change your password</h3><p className="lede">Update the password for {health.viewer}. You&apos;ll sign in with the new one next time.</p></div></div>
          {passwordMessage && <p role="status" className="monitor-note" style={{ marginTop: 12 }}>{passwordMessage}</p>}
          {passwordError && <p role="alert" className="monitor-alert" style={{ marginTop: 12 }}>{passwordError}</p>}
          <form className="monitor-form" onSubmit={submitPassword}>
            <input type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={passwordForm.current} onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })} required />
            <input type="password" minLength={12} autoComplete="new-password" placeholder="New password (12+ chars)" aria-label="New password" value={passwordForm.next} onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })} required />
            <input type="password" minLength={12} autoComplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password" value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} required />
            <button className="primary-button" type="submit">Update password</button>
          </form>
        </div>}

        <section className="readiness-panel"><div className="monitor-card-top"><div><div className="eyebrow">Production readiness</div><h2>Configuration checklist</h2></div><span className="readiness-count">{Object.values(health.checks).filter((check) => check.configured).length}/{Object.keys(health.checks).length} configured</span></div><div className="readiness-list">{Object.entries(health.checks).map(([name, check]) => <div className="readiness-row" key={name}><span className={`readiness-icon ${check.configured ? "ready" : "pending"}`}>{check.configured ? "✓" : "!"}</span><div><strong>{name.replace(/([A-Z])/g, " $1")}</strong><p>{check.detail}</p></div><span className={`readiness-status ${check.configured ? "ready" : "pending"}`}>{check.configured ? "Ready" : "Pending"}</span></div>)}      </div></section>
        <div className="monitor-note"><span className="dot lime" /> Durable metrics are retained in PostgreSQL for the last 24 hours (monitoring events are swept after 7 days; product analytics after 90). Process counters stay available for immediate diagnostics.</div>
      </>}
    </section>
  </main>;
}