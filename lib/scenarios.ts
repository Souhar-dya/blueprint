import type { Difficulty } from "./interview";

export type Scenario = {
  slug: string;
  name: string;
  category: string;
  difficulty: Difficulty;
  prompt: string;
  scale: string;
  constraints: string[];
};

export const scenarios: Scenario[] = [
  { slug: "youtube", name: "Design YouTube", category: "Video platform", difficulty: "hard", prompt: "Design a video-sharing platform where users upload, discover, and stream videos.", scale: "500M daily active users", constraints: ["High read volume", "Upload processing", "Global playback"] },
  { slug: "url-shortener", name: "Design a URL Shortener", category: "Distributed systems", difficulty: "easy", prompt: "Design a URL shortening service with redirects, custom aliases, and analytics.", scale: "100M redirects/day", constraints: ["Low-latency redirects", "High availability"] },
  { slug: "whatsapp", name: "Design WhatsApp", category: "Real-time messaging", difficulty: "hard", prompt: "Design a global messaging system with one-to-one chat, groups, delivery status, and media.", scale: "2B users", constraints: ["Online presence", "Ordering", "Offline delivery"] },
  { slug: "uber", name: "Design Uber", category: "Geo-distributed", difficulty: "expert", prompt: "Design a ride-matching platform for riders, drivers, pricing, and trip state.", scale: "20M trips/day", constraints: ["Geospatial matching", "Strong trip state", "Regional failure"] },
  { slug: "ticket-booking", name: "Design Ticket Booking", category: "Consistency", difficulty: "medium", prompt: "Design a ticket reservation system that prevents double booking under high demand.", scale: "1M events", constraints: ["Inventory correctness", "Flash sales"] },
  { slug: "notification-system", name: "Design a Notification System", category: "Async processing", difficulty: "medium", prompt: "Design a multi-channel notification platform for email, SMS, push, and in-app delivery.", scale: "1B notifications/day", constraints: ["Retries", "Preferences", "Provider failures"] },
  { slug: "file-storage", name: "Design File Storage", category: "Object storage", difficulty: "hard", prompt: "Design a secure file storage product with uploads, sharing, versioning, and downloads.", scale: "10PB stored", constraints: ["Large objects", "Durability", "Access control"] },
  { slug: "stock-alerts", name: "Design a Stock Alert System", category: "Event-driven", difficulty: "expert", prompt: "Design a real-time alerting system that notifies users when market conditions match their rules.", scale: "100M rules", constraints: ["Event ordering", "Burst traffic", "Low latency"] },
];

export function getScenario(slug: string) {
  return scenarios.find((scenario) => scenario.slug === slug);
}
