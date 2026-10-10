import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it works",
  description: "Learn how Blueprint combines a structured canvas with an adaptive interviewer.",
  alternates: { canonical: "/how-it-works" },
  openGraph: { title: "How it works | Blueprint", description: "Learn how Blueprint combines a structured canvas with an adaptive interviewer." },
};

export default function HowItWorks() { return <main className="shell"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link></nav><section className="section" style={{ borderTop: 0 }}><div className="eyebrow">How it works</div><h1>Think in systems,<br /><em>not answers.</em></h1><p className="hero-copy">Blueprint combines a structured architecture canvas with an adaptive interviewer. Your diagram, explanations, and answers form one interview state so follow-ups stay grounded in your actual design.</p><Link className="primary-button" href="/scenarios">Choose a scenario ↗</Link></section></main> }
