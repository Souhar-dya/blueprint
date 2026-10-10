"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function AuthForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const returnTo = searchParams.get("returnTo") || "/monitoring";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await response.json() as { error?: string };
    if (response.ok) {
      window.location.assign(returnTo);
    } else {
      setMessage(data.error || "Authentication failed. Check your details and try again.");
    }
  };
  return <main className="shell auth-shell">
    <nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link><Link href="/" className="nav-back">Back to home <span aria-hidden="true">↗</span></Link></nav>
    <section className="auth-layout">
      <div className="auth-intro">
        <div className="eyebrow">Operations console</div>
        <h1>Monitor every<br /><em>interview.</em></h1>
        <p className="lede">The interview product is fully anonymous — nothing here stores who designed what. This sign-in only guards the monitoring console, so you can see who is watching and how the system is performing.</p>
        <div className="auth-proof"><span className="proof-mark" aria-hidden="true">+</span><div><strong>Controlled access</strong><span>Admins grant access to individual accounts. Registration alone never unlocks the console.</span></div></div>
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-heading"><span className="auth-step">01 / ACCESS</span><span className="auth-secure">Encrypted session</span></div>
        <h2 id="auth-title">{mode === "register" ? "Create a monitoring account" : "Welcome back"}</h2>
        <p className="auth-card-copy">{mode === "register" ? "New accounts get no access until an admin grants it. Accounts listed in the MONITORING_ADMIN_EMAILS allowlist are admins automatically." : "Pick up where your monitoring session left off."}</p>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="auth-email">Email address</label>
          <input id="auth-email" className="editor-input" type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label className="field-label" htmlFor="auth-password">Password</label>
          <input id="auth-password" className="editor-input" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {mode === "register" && <p className="field-hint">Use at least 12 characters.</p>}
          <button className="primary-button full-button" type="submit">{mode === "register" ? "Create account" : "Sign in to monitoring"} <span aria-hidden="true">↗</span></button>
        </form>
        {message && <p role="alert" className="auth-message">{message}</p>}
        <button type="button" className="text-link auth-switch" onClick={() => { setMessage(""); setMode(mode === "register" ? "login" : "register"); }}>{mode === "register" ? "Already have an account? Sign in" : "Need an account? Register"}</button>
      </section>
    </section>
  </main>;
}

export default function AuthPage() {
  return <Suspense fallback={<main className="shell auth-shell"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link></nav><section className="auth-layout"><div className="auth-intro"><div className="eyebrow">Operations console</div><h1>Monitor every<br /><em>interview.</em></h1></div><div className="auth-card auth-loading">Loading secure sign-in…</div></section></main>}>
    <AuthForm />
  </Suspense>;
}