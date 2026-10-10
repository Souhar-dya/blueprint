import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about Blueprint system design interviews.",
  alternates: { canonical: "/faq" },
  openGraph: { title: "FAQ | Blueprint", description: "Answers about Blueprint system design interviews." },
};
export default function FaqPage() { return <main className="shell"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link></nav><section className="section" style={{ borderTop: 0, maxWidth: 900 }}><div className="eyebrow">Frequently asked</div><h1 style={{ fontSize: 62 }}>Good questions<br /><em>are the point.</em></h1><div className="steps" style={{ gridTemplateColumns: "1fr 1fr" }}><article className="step"><h3>Is this a chatbot?</h3><p>No. The canvas and your reasoning are first-class interview state. The interviewer should challenge the system you actually built.</p></article><article className="step"><h3>Can I create my own prompt?</h3><p>Custom scenarios are planned. The current slice includes a curated set of common system design prompts.</p></article><article className="step"><h3>Does it give the solution away?</h3><p>The intended behavior is to ask one meaningful follow-up at a time and evaluate trade-offs without dumping an answer.</p></article><article className="step"><h3>Is my interview saved?</h3><p>Not in this prototype. Persistence, accounts, and history are explicitly tracked as remaining implementation work.</p></article></div></section></main> }
