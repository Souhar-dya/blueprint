import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Blueprint handles interview and account data.",
  alternates: { canonical: "/privacy" },
};
export default function PrivacyPage() {
  return <main className="shell"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link></nav><article className="section" style={{ borderTop: 0, maxWidth: 820 }}><div className="eyebrow">Legal / informational</div><h1 className="page-title">Privacy, plainly.</h1><p className="hero-copy">This page describes the intended data practices for Blueprint. It is informational and will be updated as the product and infrastructure evolve.</p><h2>What we collect</h2><p className="hero-copy">When implemented, Blueprint may store account details, scenarios, architecture diagrams, answers, feedback, and product events needed to provide the service. We do not need sensitive personal information to run an interview.</p><h2>AI processing</h2><p className="hero-copy">Interview answers and structured architecture context may be sent to the configured server-side model provider to generate questions and feedback. Providers and retention settings will be documented before launch.</p><h2>Cookies and retention</h2><p className="hero-copy">Essential cookies may support sessions and security. Optional analytics will require consent. Users will be able to request deletion of their data once accounts and persistence are available.</p><h2>Contact</h2><p className="hero-copy">Questions about privacy can be sent through the contact channel when it is connected. This page is not legal advice.</p></article></main>;
}
