import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resources",
  description: "Practical system design preparation resources.",
  alternates: { canonical: "/resources" },
  openGraph: { title: "Resources | Blueprint", description: "Practical system design preparation resources." },
};

export default function ResourcesPage() { return <main className="shell"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link></nav><section className="section" style={{ borderTop: 0 }}><div className="eyebrow">The field guide</div><h1 className="page-title">Learn the<br /><em>trade-offs.</em></h1><p className="hero-copy">Blueprint resources will focus on the reasoning patterns behind reliable distributed systems: capacity, data, failure modes, and the cost of every &ldquo;simple&rdquo; choice.</p><div className="steps"><article className="step"><div className="step-no">GUIDE / 01</div><h3>Capacity planning</h3><p>Turn product requirements into traffic, storage, and bandwidth assumptions you can defend.</p></article><article className="step"><div className="step-no">GUIDE / 02</div><h3>Data at scale</h3><p>Understand access patterns before reaching for a database based on its reputation.</p></article><article className="step"><div className="step-no">GUIDE / 03</div><h3>Failure thinking</h3><p>Design for partial failure, recovery, and the operational signals that tell you what broke.</p></article></div></section></main> }
