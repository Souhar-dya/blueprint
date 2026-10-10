import { architectureProviderLabel, connectionRuleError, type ArchitectureState } from "./architecture";

export type ValidationSeverity = "error" | "warning" | "info";

export type ValidationFinding = {
  code: string;
  severity: ValidationSeverity;
  title: string;
  detail: string;
  nodeIds: string[];
};

export type ArchitectureValidation = {
  valid: boolean;
  score: number;
  findings: ValidationFinding[];
};

const persistenceTypes = new Set(["database", "storage"]);
const entryTypes = new Set(["client", "networking"]);
const computeTypes = new Set(["compute", "service"]);

export function validateArchitecture(architecture: ArchitectureState): ArchitectureValidation {
  const findings: ValidationFinding[] = [];
  const nodes = architecture.nodes;
  const edges = architecture.edges;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      findings.push({
        code: "broken-connection",
        severity: "error",
        title: "Broken connection",
        detail: "An edge points to a component that no longer exists.",
        nodeIds: [edge.source, edge.target],
      });
      continue;
    }
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) || 0) + 1);
  }

  // Same rule the canvas uses to block a drag: flag any link that already
  // exists in a saved or imported architecture but is not allowed.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const reason = connectionRuleError(source, target);
    if (reason) {
      findings.push({
        code: "illegal-connection",
        severity: "error",
        title: "Illegal connection",
        detail: reason,
        nodeIds: [source.id, target.id],
      });
    }
  }

  const entryNodes = nodes.filter((node) => entryTypes.has(node.type) || /client|gateway|load balancer/i.test(node.label));
  const persistenceNodes = nodes.filter((node) => persistenceTypes.has(node.type) || /postgres|mysql|mongo|cassandra|dynamo|database|storage|s3|blob/i.test(node.label));
  const computeNodes = nodes.filter((node) => computeTypes.has(node.type) || /server|service|worker|function|kubernetes/i.test(node.label));
  const cacheNodes = nodes.filter((node) => node.type === "cache" || /redis|cache/i.test(node.label));

  if (nodes.length === 0) {
    findings.push({ code: "empty-architecture", severity: "error", title: "Canvas is empty", detail: "Add at least one entry point and one backend component.", nodeIds: [] });
  }
  if (entryNodes.length > 0 && entryNodes.every((node) => (outgoing.get(node.id) || 0) === 0)) {
    findings.push({ code: "no-entry-flow", severity: "error", title: "No request flow", detail: "Your client or entry point is not connected to another component.", nodeIds: entryNodes.map((node) => node.id) });
  }
  if (computeNodes.length > 0 && persistenceNodes.length === 0) {
    findings.push({ code: "missing-persistence", severity: "warning", title: "No persistence layer", detail: "The design has compute but no durable data store or object storage.", nodeIds: computeNodes.map((node) => node.id) });
  }
  if (computeNodes.length > 0 && entryNodes.length === 0) {
    findings.push({ code: "missing-entry-point", severity: "warning", title: "No clear entry point", detail: "Add a client, load balancer, gateway, or other explicit traffic origin.", nodeIds: computeNodes.map((node) => node.id) });
  }
  if (persistenceNodes.length === 1 && computeNodes.length > 0) {
    findings.push({ code: "single-database", severity: "warning", title: "Potential database single point of failure", detail: "Explain the replication, failover, and recovery strategy for the only persistence component.", nodeIds: persistenceNodes.map((node) => node.id) });
  }
  if (computeNodes.length > 1 && !nodes.some((node) => /load balancer|api gateway|rate limiter/i.test(node.label))) {
    findings.push({ code: "missing-traffic-control", severity: "warning", title: "No traffic control layer", detail: "Multiple backend components have no visible gateway or load-balancing boundary.", nodeIds: computeNodes.map((node) => node.id) });
  }
  if (computeNodes.length > 0 && cacheNodes.length === 0) {
    findings.push({ code: "no-cache", severity: "info", title: "Caching is not represented", detail: "State why caching is unnecessary or identify the read-heavy path that needs it.", nodeIds: [] });
  }
  for (const node of nodes) {
    if ((incoming.get(node.id) || 0) === 0 && !entryNodes.includes(node)) {
      findings.push({ code: "unreachable-node", severity: "warning", title: `${node.label} is unreachable`, detail: "This component has no incoming connection from the visible architecture.", nodeIds: [node.id] });
    }
    if (!node.reasoning.trim()) {
      findings.push({ code: "missing-justification", severity: "info", title: `${node.label} needs a justification`, detail: "Explain the workload or trade-off that led to this component choice.", nodeIds: [node.id] });
    }
  }

  // Phase-2 topology: replication, sharding, and availability zones. These only
  // fire once a designer actually tags a component or draws a zone, so a plain
  // canvas is not penalised for ignoring them.
  const zones = architecture.zones || [];
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  for (const node of nodes) {
    const shards = node.shards || 0;
    const replicas = node.replicas || 0;
    if (shards > 1 && replicas <= 1) {
      findings.push({
        code: "sharded-no-replicas",
        severity: "warning",
        title: `${node.label} is sharded but not replicated`,
        detail: `Each of the ${shards} shards has a single copy — losing one shard loses that slice of data. Add read replicas per shard.`,
        nodeIds: [node.id],
      });
    }
    const zone = node.zone ? zoneById.get(node.zone) : undefined;
    if (zone && node.provider && zone.provider && zone.provider !== node.provider) {
      findings.push({
        code: "provider-mismatch",
        severity: "info",
        title: `${node.label} provider differs from its zone`,
        detail: `The component is tagged ${architectureProviderLabel(node.provider)} but ${zone.label} is ${architectureProviderLabel(zone.provider)}.`,
        nodeIds: [node.id],
      });
    }
  }
  if (zones.length === 1 && nodes.length > 1) {
    findings.push({
      code: "single-zone",
      severity: "warning",
      title: "Everything runs in one availability zone",
      detail: `All components sit in ${zones[0].label}. A zone outage takes down the whole system — spread critical components across at least two zones.`,
      nodeIds: nodes.map((node) => node.id),
    });
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const score = Math.max(0, Math.min(100, 100 - errors * 25 - warnings * 8 - findings.filter((finding) => finding.severity === "info").length * 2));
  return { valid: errors === 0, score, findings };
}
