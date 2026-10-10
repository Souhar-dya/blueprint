import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using Blueprint.",
  alternates: { canonical: "/terms" },
};
export default function TermsPage() {
  return <main className="shell"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link></nav><article className="section" style={{ borderTop: 0, maxWidth: 820 }}><div className="eyebrow">Legal / informational</div><h1 className="page-title">Terms of use.</h1><p className="hero-copy">These draft terms describe the intended rules for Blueprint and are informational until the service is formally launched.</p><h2>Account usage</h2><p className="hero-copy">Keep account information accurate, protect credentials, and use the service for legitimate learning and interview preparation.</p><h2>AI-generated content</h2><p className="hero-copy">Questions, hints, and evaluations are generated assistance, not guarantees of correctness or hiring outcomes. Apply engineering judgment and verify important claims.</p><h2>User content</h2><p className="hero-copy">You retain ownership of your scenarios, diagrams, and answers. You grant the service permission to process them only to provide and improve the requested product experience.</p><h2>Availability and changes</h2><p className="hero-copy">The service may change, be interrupted, or be discontinued. Terms will be updated with meaningful product or policy changes.</p></article></main>;
}
