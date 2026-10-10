import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return ["/", "/scenarios", "/how-it-works", "/resources", "/faq", "/privacy", "/terms", "/contact"].map((path) => ({ url: `${base}${path}`, lastModified: new Date(), changeFrequency: "weekly", priority: path === "/" ? 1 : 0.8 }));
}
