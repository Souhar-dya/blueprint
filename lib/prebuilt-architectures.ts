import type { ArchitectureState } from "./architecture";

/**
 * A deliberately minimal starting canvas for every scenario: one client node —
 * a browser or a mobile app depending on the scenario — and nothing else.
 * Everything behind it is the candidate's to build, so no interview ever
 * inherits a pre-filled design someone else drew.
 */
const starters: Record<string, ArchitectureState> = {
  youtube: { nodes: [{ id: "client-1", type: "client", label: "Web Client", x: 24, y: 50, reasoning: "User entry point — every upload and playback starts here.", note: "" }], edges: [] },
  "url-shortener": { nodes: [{ id: "client-1", type: "client", label: "Browser", x: 24, y: 50, reasoning: "User entry point — creates links and follows redirects here.", note: "" }], edges: [] },
  whatsapp: { nodes: [{ id: "client-1", type: "client", label: "Mobile App", x: 24, y: 50, reasoning: "User entry point — messaging happens over a persistent connection from here.", note: "" }], edges: [] },
  uber: { nodes: [{ id: "client-1", type: "client", label: "Mobile App", x: 24, y: 50, reasoning: "User entry point — the rider requests trips from here.", note: "" }], edges: [] },
  "ticket-booking": { nodes: [{ id: "client-1", type: "client", label: "Web Client", x: 24, y: 50, reasoning: "User entry point — browse, select, and pay here.", note: "" }], edges: [] },
  "notification-system": { nodes: [{ id: "client-1", type: "client", label: "Mobile App", x: 24, y: 50, reasoning: "The user's device — receives notifications and syncs preferences here.", note: "" }], edges: [] },
  "file-storage": { nodes: [{ id: "client-1", type: "client", label: "Web Client", x: 24, y: 50, reasoning: "User entry point — uploads, shares, and downloads happen here.", note: "" }], edges: [] },
  "stock-alerts": { nodes: [{ id: "client-1", type: "client", label: "Mobile App", x: 24, y: 50, reasoning: "User entry point — the alert lands on this screen.", note: "" }], edges: [] },
  default: { nodes: [{ id: "client-1", type: "client", label: "Web Client", x: 24, y: 50, reasoning: "User entry point — the candidate decides what this client is for.", note: "" }], edges: [] },
};

/**
 * Scenario briefing used for the interviewer's opening and for every LLM turn,
 * so the interview is specific to the scenario from word one instead of
 * starting with generic boilerplate.
 */
export type ScenarioBrief = {
  slug: string;
  clientLabel: string;
  description: string;
  opening: string;
};

const briefs: Record<string, ScenarioBrief> = {
  youtube: {
    slug: "youtube",
    clientLabel: "Web Client",
    description: "YouTube is a video-sharing platform: users upload, browse, search for, watch, comment on, and like videos at global scale, with recommendations, notifications, and live streaming. Reads of popular media dominate traffic; uploads arrive continuously and need heavy processing behind the scenes.",
    opening: "Welcome — you're designing YouTube today. The canvas starts with one web client and nothing behind it; everything you build is your call. Before any technology, tell me who uses the platform and the two operations that absolutely must work — then we'll put numbers behind them.",
  },
  "url-shortener": {
    slug: "url-shortener",
    clientLabel: "Browser",
    description: "A URL shortening service: users paste long links, get short aliases, share them, and expect the redirect to be fast and always available while basic analytics are captured on the side.",
    opening: "Let's design a URL shortener — a read-heavy redirect at its center, with custom aliases and analytics around it. The canvas holds only a browser client. Start with the two moments that matter: creating a link, and someone clicking it. What must be true about each, end to end?",
  },
  whatsapp: {
    slug: "whatsapp",
    clientLabel: "Mobile App",
    description: "WhatsApp is a global messaging platform: one-to-one chats, groups, delivery and read receipts, typing indicators, presence, and media sharing over a persistent real-time connection — delivered in order across unreliable networks to two billion users.",
    opening: "You're designing WhatsApp for two billion people. The canvas starts with a single mobile client; the hard parts are ordering, delivery guarantees, presence, and media over a persistent connection. Walk me through one message being sent from one phone to another — what has to happen, and what each user sees along the way.",
  },
  uber: {
    slug: "uber",
    clientLabel: "Mobile App",
    description: "Uber matches riders to nearby drivers in real time, prices every trip, keeps strongly consistent trip lifecycle state, and must ride through regional outages across entire cities.",
    opening: "Design Uber. One mobile client sits on the canvas — the rider's. The system must continuously ingest driver locations, match a rider to the nearest available driver, and keep a strongly consistent trip state through payment and rating. Start at the request: everything that has to happen between a rider tapping Request and the driver accepting.",
  },
  "ticket-booking": {
    slug: "ticket-booking",
    clientLabel: "Web Client",
    description: "A ticket reservation platform for concerts and events that must never oversell under flash-sale bursts: browsing, seat selection with temporary holds, payment, and order confirmation.",
    opening: "Ticket booking, flash-sale edition. The canvas has one web client; the real problem is inventory — thousands of people reaching for the same seats at once, and nobody may end up with a double booking. Walk me through one seat being selected and paid for: what state is protected, and what happens when two people pick the same seat at the same instant?",
  },
  "notification-system": {
    slug: "notification-system",
    clientLabel: "Mobile App",
    description: "A notification platform delivering email, SMS, push, and in-app alerts at a billion messages a day, honoring user preferences, deduplicating, and retrying through third-party providers that fail constantly while absorbing burst traffic.",
    opening: "We're building a notification system pushing a billion messages a day across email, SMS, push, and in-app. The canvas starts with a single mobile client that has to remain reachable. The core tension is delivering on time through providers that keep failing — walk me through one notification from creation to the moment it lands on screen, and what you do when the SMS provider is down.",
  },
  "file-storage": {
    slug: "file-storage",
    clientLabel: "Web Client",
    description: "A secure file storage product at 10PB: chunked uploads and downloads, sharing via signed links, versioning, and per-user access control on top of cheap, durable object storage.",
    opening: "Design a file storage product at 10PB. The canvas holds one web client; you own uploads, downloads, sharing, versioning, and access control. Start with the upload path — a client sending a 5GB file without the request timing out. How do you structure it?",
  },
  "stock-alerts": {
    slug: "stock-alerts",
    clientLabel: "Mobile App",
    description: "A real-time alerting system over market data: thousands of price ticks arrive per second in order, are matched against up to 100 million user-defined rules, and fire push, email, or SMS alerts with strict ordering and low latency.",
    opening: "Stock alerts, at exchange speed. The canvas starts with a mobile client that receives the alert; everything upstream is yours to design. The feed delivers thousands of ticks per second and must match them against millions of subscriptions in near-real time, in order. Walk me through one tick becoming one user's alert.",
  },
  default: {
    slug: "default",
    clientLabel: "Web Client",
    description: "A system the candidate chose. Nothing is prebuilt beyond a client node — the candidate owns every requirement, decision, and trade-off that follows.",
    opening: "This is your scenario, so the requirements are whatever you say they are. The canvas has one client and nothing else — you define the users, the core operations, the scale, and every component. Let's begin where every design should: who uses this system, and what core operation absolutely has to work first?",
  },
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/^design (a |an )?/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Deep-clone a starter so the live canvas never mutates the shared definition. */
function cloneStarter(value: ArchitectureState): ArchitectureState {
  return JSON.parse(JSON.stringify(value)) as ArchitectureState;
}

/**
 * Pick the starter for a scenario by slug or by display name, falling back to
 * the bare client-only layout.
 */
export function starterArchitectureFor(scenarioNameOrSlug: string): ArchitectureState {
  const key = slugify(scenarioNameOrSlug);
  return cloneStarter(starters[key] || starters[scenarioNameOrSlug] || starters.default);
}

/** Scenario briefing by slug or display name, falling back to the generic one. */
export function scenarioBriefFor(scenarioNameOrSlug: string): ScenarioBrief {
  const key = slugify(scenarioNameOrSlug);
  return briefs[key] || briefs[scenarioNameOrSlug] || briefs.default;
}