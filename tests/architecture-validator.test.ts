import { describe, expect, it } from "vitest";
import { validateArchitecture } from "../lib/architecture-validator";
import type { ArchitectureState } from "../lib/architecture";

const node = (id: string, type: string, label: string, reasoning = "because") => ({ id, type, label, x: 0, y: 0, reasoning, note: "" });

describe("validateArchitecture", () => {
  it("flags edges that reference deleted nodes", () => {
    const result = validateArchitecture({ nodes: [node("api", "compute", "API Server")], edges: [{ id: "e", source: "api", target: "missing", label: "HTTP" }] });
    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.code === "broken-connection")).toBe(true);
  });

  it("flags compute-only designs without persistence", () => {
    const result = validateArchitecture({ nodes: [node("client", "client", "Web Client"), node("api", "compute", "API Server")], edges: [{ id: "e", source: "client", target: "api", label: "HTTPS" }] });
    expect(result.findings.some((finding) => finding.code === "missing-persistence")).toBe(true);
  });

  it("flags unreachable components and missing reasoning", () => {
    const architecture: ArchitectureState = { nodes: [node("client", "client", "Web Client"), node("db", "database", "PostgreSQL", "")], edges: [] };
    const result = validateArchitecture(architecture);
    expect(result.findings.some((finding) => finding.code === "unreachable-node")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "missing-justification")).toBe(true);
  });

  it("flags a sharded component that has no replicas", () => {
    const architecture: ArchitectureState = {
      nodes: [node("db", "database", "Cassandra"), { ...node("shard", "database", "Cassandra", "because"), shards: 6 }],
      edges: [],
    };
    const result = validateArchitecture(architecture);
    expect(result.findings.some((finding) => finding.code === "sharded-no-replicas")).toBe(true);
  });

  it("flags a single availability zone when every component sits in one box", () => {
    const architecture: ArchitectureState = {
      nodes: [node("api", "compute", "API"), node("db", "database", "DB")],
      edges: [],
      zones: [{ id: "z1", label: "us-east-1a", provider: "aws", x: 0, y: 0, width: 50, height: 50 }],
    };
    const result = validateArchitecture(architecture);
    expect(result.findings.some((finding) => finding.code === "single-zone")).toBe(true);
  });

  it("flags a provider mismatch between a component and its zone", () => {
    const architecture: ArchitectureState = {
      nodes: [{ ...node("api", "compute", "API", "because"), provider: "gcp", zone: "z1" }],
      edges: [],
      zones: [{ id: "z1", label: "us-east-1a", provider: "aws", x: 0, y: 0, width: 50, height: 50 }],
    };
    const result = validateArchitecture(architecture);
    expect(result.findings.some((finding) => finding.code === "provider-mismatch")).toBe(true);
  });
});
