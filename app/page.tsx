import Link from "next/link";

const PREVIEW_NODE_WIDTH = 150;
const PREVIEW_NODE_HEIGHT = 64;

type PreviewNode = {
  id: string;
  label: string;
  sub: string;
  dot: string;
  x: number;
  y: number;
};

// Everything lives in one fixed 640x340 viewBox. Because the wires are drawn
// from each card's centre in the same coordinate space, they always attach to
// the boxes — regardless of how the preview is scaled. (The old version placed
// nodes with percentages but hard-coded pixel wire offsets, so the lines
// floated between the boxes.)
const previewNodes: PreviewNode[] = [
  { id: "gateway", label: "API Gateway", sub: "edge / ingress", dot: "var(--lime)", x: 18, y: 138 },
  { id: "auth", label: "Auth Service", sub: "stateless compute", dot: "var(--cyan)", x: 250, y: 30 },
  { id: "redis", label: "Redis Cache", sub: "low latency", dot: "var(--lime)", x: 250, y: 138 },
  { id: "worker", label: "Worker Pool", sub: "async jobs", dot: "var(--cyan)", x: 250, y: 246 },
  { id: "postgres", label: "PostgreSQL", sub: "primary store", dot: "var(--orange)", x: 470, y: 138 },
];

const previewEdges: Array<[string, string]> = [
  ["gateway", "auth"],
  ["gateway", "redis"],
  ["gateway", "worker"],
  ["auth", "postgres"],
  ["worker", "postgres"],
];

function ArchitecturePreview() {
  const centers = new Map(
    previewNodes.map((node) => [
      node.id,
      { cx: node.x + PREVIEW_NODE_WIDTH / 2, cy: node.y + PREVIEW_NODE_HEIGHT / 2 },
    ]),
  );
  return (
    <div className="preview" aria-label="Architecture preview">
      <div className="preview-header"><span>untitled / architecture</span><span className="status">● live canvas</span></div>
      <div className="diagram" aria-hidden="true">
        <svg className="diagram-svg" viewBox="0 0 640 340" preserveAspectRatio="xMidYMid meet" focusable="false">
          <g>
            {previewEdges.map(([from, to]) => {
              const start = centers.get(from);
              const end = centers.get(to);
              if (!start || !end) return null;
              return <line key={`${from}-${to}`} className="dedge" x1={start.cx} y1={start.cy} x2={end.cx} y2={end.cy} />;
            })}
          </g>
          {previewNodes.map((node) => (
            <g key={node.id}>
              <rect className="dnode-card" x={node.x} y={node.y} width={PREVIEW_NODE_WIDTH} height={PREVIEW_NODE_HEIGHT} rx="8" />
              <circle cx={node.x + 16} cy={node.y + 18} r="3.5" fill={node.dot} />
              <text className="dnode-label" x={node.x + 14} y={node.y + 41}>{node.label}</text>
              <text className="dnode-sub" x={node.x + 14} y={node.y + 56}>{node.sub}</text>
            </g>
          ))}
        </svg>
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
