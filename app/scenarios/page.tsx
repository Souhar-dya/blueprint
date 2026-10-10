"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { scenarios } from "../../lib/scenarios";
import { SiteNav } from "../components/site-nav";

type CustomScenario = {
  id: string;
  name: string;
  prompt: string;
  scale: string;
  difficulty: string;
  created_at: string;
};

const CUSTOM_KEY = "blueprint-custom-scenarios-v1";

// Custom scenarios are private by design and never touch a server: they live
// in this browser, exactly like the interview documents themselves.
const loadCustomScenarios = (): CustomScenario[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) || "[]") as CustomScenario[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persistCustomScenarios = (items: CustomScenario[]) => {
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked — the interview still starts, just without the saved copy.
  }
};

export default function ScenariosPage() {
  const [custom, setCustom] = useState({ name: "", prompt: "", scale: "", difficulty: "medium" });
  const [selectedScenario, setSelectedScenario] = useState("");
  const [customScenarios, setCustomScenarios] = useState<CustomScenario[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  // Saved custom scenarios live in localStorage, which the server can't see.
  // Reading them during the initial render would make the client's first paint
  // differ from the SSR HTML (hydration mismatch), so they load right after
  // hydration instead. The initial render is always the empty, server-safe state.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setCustomScenarios(loadCustomScenarios()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const startSelected = () => {
    if (selectedScenario) router.push(`/interview?scenario=${encodeURIComponent(selectedScenario)}`);
  };

  const submitCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!custom.name.trim() || !custom.prompt.trim()) return;
    const stored = loadCustomScenarios();
    const item: CustomScenario = {
      id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: custom.name.trim(),
      prompt: custom.prompt.trim(),
      scale: custom.scale.trim(),
      difficulty: custom.difficulty,
      created_at: new Date().toISOString(),
    };
    persistCustomScenarios([item, ...stored].slice(0, 20));
    setCustomScenarios(loadCustomScenarios());
    const params = new URLSearchParams({ scenario: custom.name.trim(), prompt: custom.prompt.trim(), scale: custom.scale.trim(), difficulty: custom.difficulty });
    router.push(`/interview?${params.toString()}`);
  };

  const deleteCustom = (id: string) => {
    setDeletingId(id);
    try {
      persistCustomScenarios(loadCustomScenarios().filter((item) => item.id !== id));
      setCustomScenarios((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return <main className="shell"><SiteNav links={[{ href: "/", label: "Home" }, { href: "/how-it-works", label: "How it works" }]} /><section className="section scenario-setup" style={{ borderTop: 0, paddingTop: 90 }}><div className="eyebrow">Choose your pressure</div><h1 style={{ fontSize: "clamp(44px, 6vw, 72px)", maxWidth: 700 }}>What are you ready<br />to <em>design?</em></h1><p className="hero-copy">Choose a challenge or bring your own system. The interviewer will ask one focused question at a time.</p><div className="scenario-picker"><label htmlFor="scenario-select">Start with a predefined scenario</label><select id="scenario-select" value={selectedScenario} onChange={(event) => setSelectedScenario(event.target.value)}><option value="">Select a scenario...</option>{scenarios.map((scenario) => <option value={scenario.name} key={scenario.slug}>{scenario.name} · {scenario.difficulty}</option>)}</select><button className="primary-button" type="button" disabled={!selectedScenario} onClick={startSelected}>Start interview ↗</button></div><div className="steps scenario-grid">{scenarios.map((scenario) => <Link className="step" href={`/interview?scenario=${scenario.slug}`} key={scenario.slug}><div className="step-no">{scenario.difficulty.toUpperCase()}</div><h3 style={{ marginTop: 45 }}>{scenario.name}</h3><p>{scenario.category}<br /><span style={{ color: "var(--lime)" }}>Start challenge ↗</span></p></Link>)}</div></section><section className="section custom-scenario"><div className="eyebrow">Or bring your own problem</div><h2>Create a custom scenario.</h2><p className="hero-copy">Give the interviewer a clear brief. You can refine the architecture live as the conversation unfolds.</p><form onSubmit={submitCustom} className="custom-form"><label>Name<input required value={custom.name} onChange={(event) => setCustom({ ...custom, name: event.target.value })} placeholder="Design an Internal Platform" /></label><label className="custom-prompt">Problem statement<textarea required value={custom.prompt} onChange={(event) => setCustom({ ...custom, prompt: event.target.value })} placeholder="Build a platform for teams to deploy services safely." /></label><label>Expected scale<input value={custom.scale} onChange={(event) => setCustom({ ...custom, scale: event.target.value })} placeholder="10,000 deployments/day" /></label><label>Difficulty<select value={custom.difficulty} onChange={(event) => setCustom({ ...custom, difficulty: event.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="expert">Expert</option></select></label><button className="primary-button" type="submit">Start custom interview ↗</button></form></section>{customScenarios.length > 0 && <section className="section"><div className="eyebrow">Saved on this device</div><h2>Custom scenarios.</h2><div className="steps scenario-grid">{customScenarios.map((scenario) => <div className="step" key={scenario.id} style={{ position: "relative" }}><div className="step-no">{scenario.difficulty.toUpperCase()}</div><h3 style={{ marginTop: 45 }}>{scenario.name}</h3><p>{scenario.prompt.slice(0, 80)}{scenario.prompt.length > 80 ? "…" : ""}</p><div style={{ display: "flex", gap: 8, marginTop: 12 }}><Link className="tool-button" href={`/interview?scenario=${encodeURIComponent(scenario.name)}&prompt=${encodeURIComponent(scenario.prompt)}&scale=${encodeURIComponent(scenario.scale)}&difficulty=${scenario.difficulty}`}>Start ↗</Link><button className="tool-button" disabled={deletingId === scenario.id} onClick={() => deleteCustom(scenario.id)}>{deletingId === scenario.id ? "Deleting…" : "Delete"}</button></div></div>)}</div></section>}</main>;
}
