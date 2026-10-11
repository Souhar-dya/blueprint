import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PrivacyControls } from "./components/privacy-controls";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b100f",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "Blueprint — System design, under pressure.",
    template: "%s | Blueprint",
  },
  description:
    "Practice system design interviews by building, explaining, and defending a production-ready architecture.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Blueprint — System design, under pressure.",
    description: "An adaptive system design interview simulator for engineers.",
    type: "website",
    siteName: "Blueprint",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blueprint — System design, under pressure.",
    description: "An adaptive system design interview simulator for engineers.",
  },
  robots: { index: true, follow: true },
  verification: {
    other: {
      "strix-verification": "strix-verify-3c049a47e260194e34e40b00142fabac",
    },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Blueprint",
    description: "An adaptive system design interview simulator for engineers.",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div id="main-content">{children}</div>
        <PrivacyControls />
      </body>
    </html>
  );
}
