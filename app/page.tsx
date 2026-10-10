import Link from "next/link";

function ArchitecturePreview() {
  return (
    <div className="preview" aria-label="Architecture preview">
      <div className="preview-header"><span>untitled / architecture</span><span className="status">● live canvas</span></div>
      <div className="diagram" aria-hidden="true">
        <div className="wire wire-one" /><div className="wire wire-two" /><div className="wire wire-three" /><div className="wire wire-four" />
        <div className="node node-a"><i className="dot lime" /><strong>API Gateway</strong><span>edge / ingress</span></div>
        <div className="node node-b"><i className="dot" /><strong>Auth Service</strong><span>stateless compute</span></div>
        <div className="node node-c"><i className="dot orange" /><strong>PostgreSQL</strong><span>primary store</span></div>
        <div className="node node-d"><i className="dot lime" /><strong>Redis Cache</strong><span>low latency</span></div>
        <div className="node node-e"><i className="dot" /><strong>Worker Pool</strong><span>async jobs</span></div>
      </div>
    </div>
  );
}

export default function Home() {
  return <main className="shell">
    <nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link><div className="nav-links"><Link href="/scenarios">Scenarios</Link><Link href="/how-it-works">How it works</Link><Link href="/resources">Resources</Link><Link href="/faq">FAQ</Link><Link href="/scenarios" className="nav-cta">Start an interview</Link></div></nav>
    <section className="hero"><div><div className="eyebrow">System design / under pressure</div><h1>Build systems.<br /><em>Defend decisions.</em></h1><p className="hero-copy">An adaptive interview simulator where your architecture is the answer. Design on a live canvas, explain every trade-off, and handle what happens when production fights back.</p><div className="hero-actions"><Link className="primary-button" href="/scenarios">Start an interview <span aria-hidden="true">↗</span></Link><Link className="text-link" href="/how-it-works">See how it works</Link></div></div><ArchitecturePreview /></section>
    <section className="section"><div className="section-title"><div><div className="eyebrow">The loop</div><h2>Practice the real thing.</h2></div><p>No trivia decks. No canned answers. Just the same ambiguity, constraints, and pressure you&apos;ll face in the room.</p></div><div className="steps"><article className="step"><div className="step-no">01 / FRAME</div><h3>Choose a challenge</h3><p>Start with a realistic prompt and a difficulty that matches where you are today.</p></article><article className="step"><div className="step-no">02 / BUILD</div><h3>Draw your system</h3><p>Place services, connect data flows, and annotate the reasoning behind every decision.</p></article><article className="step"><div className="step-no">03 / DEFEND</div><h3>Handle the incident</h3><p>An adaptive interviewer probes the gaps, then tests your design under production pressure.</p></article></div></section>
    <footer className="footer"><span>© 2026 Blueprint</span><span className="footer-links"><Link href="/history">Interview history</Link><Link href="/monitoring">Monitoring</Link></span><span>Practice with intent.</span></footer>
  </main>;
}
