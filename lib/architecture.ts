export type ArchitectureNode = {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  reasoning: string;
  note: string;
  /** Deployment environment tag, e.g. "aws" or "local". */
  provider?: string;
  /** Availability-zone container id this node sits inside. */
  zone?: string;
  /** Replica count shown as a badge (1 = single copy). */
  replicas?: number;
  /** Shard count shown as a badge. */
  shards?: number;
};

export type ArchitectureEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  /** Handle the wire leaves from, e.g. "right-1". Optional so older saves load. */
  sourceHandle?: string;
  targetHandle?: string;
};

export type ArchitectureZone = {
  id: string;
  label: string;
  provider?: string;
  /** Top-left corner and size as percentages of the canvas world. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArchitectureState = {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  zones?: ArchitectureZone[];
};

export const ARCHITECTURE_TYPES = [
  "client",
  "networking",
  "compute",
  "service",
  "cache",
  "messaging",
  "database",
  "storage",
] as const;

export type ArchitectureType = (typeof ARCHITECTURE_TYPES)[number];

export const ARCHITECTURE_PROVIDERS = ["aws", "gcp", "azure", "cloudflare", "local"] as const;
export type ArchitectureProvider = (typeof ARCHITECTURE_PROVIDERS)[number];

const TYPE_LABELS: Record<string, string> = {
  client: "Client",
  networking: "Gateway / LB",
  compute: "Compute",
  service: "Service",
  cache: "Cache",
  messaging: "Messaging",
  database: "Database",
  storage: "Object storage",
};

export function architectureTypeLabel(type: string): string {
  return TYPE_LABELS[type] || type;
}

const PROVIDER_LABELS: Record<string, string> = {
  aws: "AWS",
  gcp: "Google Cloud",
  azure: "Azure",
  cloudflare: "Cloudflare",
  local: "Local / on-prem",
};

export function architectureProviderLabel(provider?: string): string {
  if (!provider) return "";
  return PROVIDER_LABELS[provider] || provider;
}

/** Guess a component type from a free-typed service name so the form can default to it. */
export function inferArchitectureType(name: string): ArchitectureType {
  const value = name.toLowerCase();
  if (/client|browser|mobile|frontend|web app|web ui/.test(value)) return "client";
  if (/load balancer|balancer|api gateway|gateway|reverse proxy|proxy|cdn|dns|edge|firewall/.test(value)) return "networking";
  if (/redis|memcache|cache|varnish/.test(value)) return "cache";
  if (/kafka|rabbit|queue|pub\/?sub|sqs|sns|nats|messaging|event bus|stream|kinesis/.test(value)) return "messaging";
  if (/postgres|mysql|mariadb|mongo|cassandra|dynamo|cockroach|sql|database|db|scylla|spanner/.test(value)) return "database";
  if (/s3|blob|object storage|bucket|gcs|storage|filesystem|nfs/.test(value)) return "storage";
  return "service";
}

const clientTypes = new Set(["client"]);
const persistenceTypes = new Set(["database", "storage"]);
const cacheTypes = new Set(["cache"]);

/**
 * Deterministic rule for whether one component may wire to another. Returns a
 * human-readable reason when the link is not allowed, or null when it is fine.
 * Shared by the canvas (to block the drag) and the validator (to flag a saved
 * architecture that already contains the link, e.g. imported JSON).
 */
export function connectionRuleError(source: ArchitectureNode, target: ArchitectureNode): string | null {
  if (source.id === target.id) return `${source.label} can't connect to itself.`;
  if (clientTypes.has(source.type) && persistenceTypes.has(target.type)) {
    return `${source.label} can't talk to ${target.label} directly — route through a service or gateway.`;
  }
  if (persistenceTypes.has(source.type) && clientTypes.has(target.type)) {
    return `${source.label} shouldn't initiate traffic to ${target.label}.`;
  }
  if (cacheTypes.has(source.type) && cacheTypes.has(target.type)) {
    return "Two caches shouldn't chain directly — put a service between them.";
  }
  return null;
}
