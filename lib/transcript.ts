import { architectureProviderLabel, architectureTypeLabel, type ArchitectureEdge, type ArchitectureNode, type ArchitectureState, type ArchitectureZone } from "./architecture";
import type { ArchitectureValidation, ValidationFinding } from "./architecture-validator";
import type { EvaluationReport } from "./evaluation";
import type { InterviewState } from "./interview";

/**
 * Renders a diagram and a self-contained interview document on the client, so
 * nothing about an interview is ever stored on a server. The downloaded .html
 * file is the single source of truth for a finished interview: transcript,
 * architecture image, scoring breakdown, and scorecard, all in one file.
 */

export const TRANSCRIPT_WORLD_WIDTH = 2400;
export const TRANSCRIPT_WORLD_HEIGHT = 1500;
const NODE_WIDTH = 145;
const NODE_HEIGHT = 64;

const nodeFill: Record<string, string> = {
  client: "#7dd3fc",
  compute: "#c4b5fd",
  service: "#a5b4fc",
  database: "#fdba74",
  cache: "#f9a8d4",
  messaging: "#6ee7b7",
  networking: "#fde047",
  storage: "#cbd5e1",
};

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clipLabel = (value: string, max = 20) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

const topologyBadge = (node: ArchitectureNode) => {
  const parts: string[] = [];
  if ((node.replicas || 0) > 1) parts.push(`×${node.replicas} replicas`);
  else if (node.replicas === 1) parts.push("1 replica");
  if ((node.shards || 0) > 1) parts.push(`${node.shards} shards`);
  else if (node.shards === 1) parts.push("1 shard");
  return parts.join(" · ");
};

const port = (node: ArchitectureNode, side: "left" | "right") => {
  const cx = (node.x / 100) * TRANSCRIPT_WORLD_WIDTH;
  const cy = (node.y / 100) * TRANSCRIPT_WORLD_HEIGHT;
  return { x: side === "left" ? cx - NODE_WIDTH / 2 : cx + NODE_WIDTH / 2, y: cy };
};

/** A clean, deterministic SVG snapshot of the architecture — used both directly and rasterised to PNG. */
export function architectureSVG(architecture: ArchitectureState): string {
  const nodes: ArchitectureNode[] = architecture.nodes;
  const edges: ArchitectureEdge[] = architecture.edges;
  const zones: ArchitectureZone[] = architecture.zones || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const zoneMarkup = zones.map((zone) => {
    const x = (zone.x / 100) * TRANSCRIPT_WORLD_WIDTH;
    const y = (zone.y / 100) * TRANSCRIPT_WORLD_HEIGHT;
    const width = (zone.width / 100) * TRANSCRIPT_WORLD_WIDTH;
    const height = (zone.height / 100) * TRANSCRIPT_WORLD_HEIGHT;
    const provider = zone.provider ? architectureProviderLabel(zone.provider) : "";
    return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="#eef2ff" stroke="#c7d2fe" stroke-width="2" stroke-dasharray="8 6"/><rect x="${x}" y="${y}" width="${width}" height="26" rx="12" fill="#e0e7ff"/><rect x="${x}" y="${y + 14}" width="${width}" height="12" fill="#e0e7ff"/><text x="${x + 14}" y="${y + 17}" font-size="12" font-weight="600" fill="#3730a3">${escapeXml(clipLabel(zone.label, 26))}${provider ? ` · ${escapeXml(provider)}` : ""}</text></g>`;
  }).join("");

  const edgeMarkup = edges.flatMap((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return [];
    const from = port(source, "right");
    const to = port(target, "left");
    const curve = `M ${from.x} ${from.y} C ${from.x + 90} ${from.y}, ${to.x - 90} ${to.y}, ${to.x} ${to.y}`;
    const labelY = (from.y + to.y) / 2 - 6;
    const labelX = (from.x + to.x) / 2;
    return [
      `<path d="${curve}" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>`,
      edge.label ? `<text x="${labelX}" y="${labelY}" font-size="10" fill="#64748b" text-anchor="middle">${escapeXml(edge.label)}</text>` : "",
    ];
  }).join("");

  const nodeMarkup = nodes.map((node) => {
    const cx = (node.x / 100) * TRANSCRIPT_WORLD_WIDTH;
    const cy = (node.y / 100) * TRANSCRIPT_WORLD_HEIGHT;
    const x = cx - NODE_WIDTH / 2;
    const y = cy - NODE_HEIGHT / 2;
    const fill = nodeFill[node.type] || "#cbd5e1";
    const badge = topologyBadge(node);
    const provider = node.provider ? architectureProviderLabel(node.provider) : "";
    return `<g><rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="10" fill="${fill}" stroke="#334155" stroke-width="1.5"/><text x="${cx}" y="${y + 24}" font-size="13" font-weight="700" fill="#0f172a" text-anchor="middle">${escapeXml(clipLabel(node.label))}</text><text x="${cx}" y="${y + 40}" font-size="10" fill="#334155" text-anchor="middle">${escapeXml(architectureTypeLabel(node.type))}${provider ? ` · ${escapeXml(provider)}` : ""}</text>${badge ? `<text x="${cx}" y="${y + 54}" font-size="9" fill="#475569" text-anchor="middle">${escapeXml(badge)}</text>` : ""}</g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TRANSCRIPT_WORLD_WIDTH}" height="${TRANSCRIPT_WORLD_HEIGHT}" viewBox="0 0 ${TRANSCRIPT_WORLD_WIDTH} ${TRANSCRIPT_WORLD_HEIGHT}" font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/></marker></defs><rect width="100%" height="100%" fill="#f8fafc"/><g stroke="#e2e8f0" stroke-width="1">${Array.from({ length: 25 }, (_, i) => `<line x1="0" y1="${i * 60}" x2="${TRANSCRIPT_WORLD_WIDTH}" y2="${i * 60}"/>`).join("")}${Array.from({ length: 41 }, (_, i) => `<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="${TRANSCRIPT_WORLD_HEIGHT}"/>`).join("")}</g>${zoneMarkup}${edgeMarkup}${nodeMarkup}</svg>`;
}

/** Rasterise the SVG diagram to a PNG data URL so the document is fully self-contained. */
export async function architecturePNGDataURL(architecture: ArchitectureState): Promise<string> {
  const svg = architectureSVG(architecture);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not render the architecture image."));
      img.src = url;
    });
    const scale = 1.5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(TRANSCRIPT_WORLD_WIDTH * scale);
    canvas.height = Math.round(TRANSCRIPT_WORLD_HEIGHT * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable.");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, TRANSCRIPT_WORLD_WIDTH, TRANSCRIPT_WORLD_HEIGHT);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const findingSeverityLabel: Record<ValidationFinding["severity"], string> = {
  error: "Blocking",
  warning: "Warning",
  info: "Note",
};

function findingsMarkup(validation: ArchitectureValidation): string {
  const groups: ValidationFinding[][] = [["error"], ["warning"], ["info"]].map(([severity]) =>
    validation.findings.filter((finding) => finding.severity === severity),
  );
  const table = (items: ValidationFinding[]) =>
    `<table><thead><tr><th style="text-align:left;width:220px">Finding</th><th style="text-align:left">Why it matters</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeXml(item.title)}</strong></td><td>${escapeXml(item.detail)}</td></tr>`).join("")}</tbody></table>`;
  return `<h3>Architecture health — ${validation.score}/100</h3><p>The health score is calculated as <code>100 − ${validation.findings.filter((f) => f.severity === "error").length} × 25 (blocking) − ${validation.findings.filter((f) => f.severity === "warning").length} × 8 (warnings) − ${validation.findings.filter((f) => f.severity === "info").length} × 2 (notes)</code>, clamped to 0–100. Every blocking issue or warning above is a design risk the interviewer would probe.</p>${groups
    .filter((items) => items.length > 0)
    .map(
      (items) =>
        `<h4>${findingSeverityLabel[items[0]?.severity || "info"]} (${items.length})</h4>${table(items)}`,
    )
    .join("") || "<p>No findings — a clean architecture.</p>"}`;
}

function scorecardMarkup(evaluation: EvaluationReport): string {
  const critique = evaluation.critique
    ? `<h4>Staff-engineer critique</h4><p>${escapeXml(evaluation.critique.summary)}</p>${evaluation.critique.strengths.length ? `<p><strong>What held up</strong></p><ul>${evaluation.critique.strengths.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>` : ""}${evaluation.critique.improvements.length ? `<p><strong>What to fix</strong></p><ul>${evaluation.critique.improvements.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>` : ""}`
    : "";
  return `<h3>End-of-interview scorecard</h3><p><strong>${evaluation.score}/100</strong> overall — 70% answer evidence, 30% architecture health, scaled by how many design phases were addressed. Levels use fixed anchors and quoted transcript excerpts.</p><p>${evaluation.scorecard.answersAssessed} answers assessed. ${escapeXml(evaluation.scorecard.overall.summary)}</p><table><thead><tr><th style="text-align:left">Competency</th><th style="text-align:left;width:180px">Level</th><th style="text-align:left">Evidence</th><th style="text-align:right">Score</th></tr></thead><tbody>${evaluation.scorecard.competencies.map((item) => `<tr><td><strong>${escapeXml(item.name)}</strong></td><td>${item.level ? `${item.level} · ${escapeXml(item.label)}` : "Not assessed"}</td><td>${escapeXml(item.evidence)}${item.quotes.length ? `<br/><em>Quotes: ${item.quotes.map((quote) => `“${escapeXml(quote.text)}” (${quote.phase})`).join("; ")}</em>` : ""}</td><td style="text-align:right">${item.score !== null ? `${item.score}/100` : "–"}</td></tr>`).join("")}</tbody></table>${critique}${evaluation.improvements.length ? `<h4>Next practice targets</h4><ul>${evaluation.improvements.slice(0, 3).map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>` : ""}<h4>How levels are calibrated</h4><ol>${evaluation.scorecard.scale.map((level) => `<li><strong>${level.level} · ${escapeXml(level.label)}</strong> — ${escapeXml(level.anchor)}</li>`).join("")}</ol>`;
}

export function buildTranscriptDoc(options: {
  scenario: string;
  difficulty: string;
  completedAt: string;
  architecture: ArchitectureState;
  validation: ArchitectureValidation;
  interviewState: InterviewState;
  evaluation?: EvaluationReport | null;
  imageDataURL?: string;
}): string {
  const { scenario, difficulty, completedAt, architecture, validation, interviewState, evaluation, imageDataURL } = options;
  const date = new Date(completedAt);
  const dateLabel = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const image = imageDataURL
    ? `<figure><img src="${imageDataURL}" alt="Final architecture diagram" style="max-width:100%;border:1px solid #dbe2ea;border-radius:8px"/><figcaption style="color:#667085;font-size:12px;margin-top:6px">Final architecture — ${architecture.nodes.length} components · ${architecture.edges.length} connections${architecture.zones?.length ? ` · ${architecture.zones.length} availability zone${architecture.zones.length === 1 ? "" : "s"}` : ""}</figcaption></figure>`
    : `<figure><div style="border:1px dashed #d0d7e2;border-radius:8px;padding:28px 16px;color:#667085;text-align:center">Architecture image failed to render — the JSON export below still contains the full state.</div></figure>`;

  const nodeRows = architecture.nodes.map((node) => {
    const zone = (architecture.zones || []).find((item) => item.id === node.zone);
    return `<tr><td><strong>${escapeXml(node.label)}</strong></td><td>${architectureTypeLabel(node.type)}</td><td>${node.provider ? architectureProviderLabel(node.provider) : "—"}</td><td>${node.zone && zone ? escapeXml(zone.label) : "—"}</td><td>${topologyBadge(node) || "—"}</td><td>${escapeXml(node.reasoning || "—")}</td></tr>`;
  }).join("");
  const edgeRows = architecture.edges.map((edge) => {
    const source = architecture.nodes.find((node) => node.id === edge.source);
    const target = architecture.nodes.find((node) => node.id === edge.target);
    return `<li><strong>${escapeXml(source?.label || edge.source)}</strong> → <strong>${escapeXml(target?.label || edge.target)}</strong>${edge.label ? ` <em>(${escapeXml(edge.label)})</em>` : ""}</li>`;
  }).join("");

  const answers = interviewState.answers.map((item, index) => `<div style="margin:14px 0"><p style="margin:0 0 4px"><strong>Q${index + 1}. ${escapeXml(item.question)}</strong></p><p style="margin:0 0 4px;white-space:pre-wrap">${escapeXml(item.answer)}</p><p style="margin:0;color:#667085;font-size:12px">Phase: ${item.phase.replaceAll("_", " ")}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeXml(scenario)} — Blueprint interview</title><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101828;background:#ffffff;margin:0;line-height:1.5}
  .wrap{max-width:860px;margin:0 auto;padding:40px 28px 80px}header{border-bottom:2px solid #101828;padding-bottom:18px;margin-bottom:28px}
  h1{font-size:30px;margin:0 0 6px}h2{font-size:20px;margin:34px 0 10px;padding-top:18px;border-top:1px solid #eef1f5}h3{font-size:16px;margin:22px 0 8px}h4{font-size:13px;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:#475467}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}th,td{border:1px solid #e4e9f0;padding:8px 10px;vertical-align:top}th{background:#f8fafc;font-weight:600}
  .meta{color:#475467;font-size:13px}code{background:#f2f4f7;padding:1px 5px;border-radius:4px;font-size:12px}.scores{display:flex;gap:16px;margin:18px 0}
  .score-box{border:1px solid #e4e9f0;border-radius:10px;padding:14px 18px;flex:1}.score-box strong{font-size:26px}.score-box span{display:block;color:#667085;font-size:12px;margin-top:2px}
  ul,ol{margin:6px 0;padding-left:22px}li{margin:3px 0}footer{margin-top:44px;padding-top:14px;border-top:1px solid #e4e9f0;color:#667085;font-size:12px}
  .privacy-note{background:#f2f4f7;border-radius:8px;padding:10px 14px;font-size:12px;color:#475467;margin:26px 0}
  </style></head><body><div class="wrap"><header><h1>${escapeXml(scenario)}</h1><p class="meta">System design interview · ${difficulty} · ${dateLabel}</p></header>
  ${image}
  <div class="scores"><div class="score-box"><strong>${validation.score}/100</strong><span>Architecture health</span></div>${evaluation ? `<div class="score-box"><strong>${evaluation.score}/100</strong><span>Overall evaluation</span></div>` : ""}<div class="score-box"><strong>${interviewState.answers.length}</strong><span>Answers given</span></div></div>
  ${findingsMarkup(validation)}
  <h2>Components</h2><table><thead><tr><th style="text-align:left">Component</th><th style="text-align:left">Type</th><th style="text-align:left">Provider</th><th style="text-align:left">Zone</th><th style="text-align:left">Replication / sharding</th><th style="text-align:left">Justification</th></tr></thead><tbody>${nodeRows}</tbody></table>
  <h3>Connections</h3><ul>${edgeRows}</ul>
  <h2>Interview transcript</h2>${answers || "<p>No answers were recorded.</p>"}
  ${evaluation ? scorecardMarkup(evaluation) : ""}
  <div class="privacy-note"><strong>Private by design.</strong> This document is generated in your browser and was never stored on any Blueprint server — keep it as your record of the interview. Re-open <code>${escapeXml(scenario)}</code> from the scenario picker to run a fresh practice session.</div>
  <footer>Generated by Blueprint · ${dateLabel} · The evaluation score weights answer evidence above architecture health and scales it by coverage.</footer>
  </div></body></html>`;
}