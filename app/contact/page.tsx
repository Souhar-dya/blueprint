import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact the Blueprint team.",
  alternates: { canonical: "/contact" },
  openGraph: { title: "Contact | Blueprint", description: "Contact the Blueprint team." },
};
export default function ContactPage() { return <main className="shell"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link></nav><section className="section" style={{ borderTop: 0, maxWidth: 760 }}><div className="eyebrow">Contact</div><h1 style={{ fontSize: 62 }}>Have a sharp<br /><em>edge case?</em></h1><p className="hero-copy">Blueprint is being built in the open. For product feedback, scenario suggestions, or privacy questions, use the project repository once the public contact channel is connected.</p><p style={{ color: "var(--muted)" }}>No contact form is presented until it has server-side validation, spam protection, and a real delivery path.</p></section></main> }
