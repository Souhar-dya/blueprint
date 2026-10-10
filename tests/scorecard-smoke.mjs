import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
// Device Guard blocks Playwright's chrome-headless-shell binary on this machine; the full Chromium build launches fine.
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];

page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

// Create a throwaway account; the session cookie stays in this browser context.
const email = `scorecard-smoke-${Date.now()}@example.com`;
const register = await page.request.post(`${base}/api/auth/register`, {
  data: { email, password: "scorecard-smoke-pass" },
});
if (!register.ok()) throw new Error(`Registration failed: ${register.status()} ${await register.text()}`);

await page.goto(`${base}/interview?scenario=youtube`);
await page.getByText("Interview live").waitFor({ timeout: 20000 });

// Record one substantive answer so the scorecard has transcript evidence.
// The text answer box is gone: typed answers now go through the component
// popover ("Ask AI" on a canvas node), and voice taps stream straight to AI.
const answer = "The core requirements are short-link creation and redirect lookups, because the read path dominates. Roughly 10 million creates per day, so I would keep the write path simple at about 5,000 writes per second.";
await page.locator(".architecture-node").first().click();
await page.locator(".component-popover").waitFor({ timeout: 10000 });
await page.locator(".component-answer").fill(answer);
await page.locator(".component-popover .primary-button").click();
await page.getByText("2 / 14", { exact: false }).first().waitFor({ timeout: 30000 });

// End the interview and generate the scorecard.
await page.getByRole("button", { name: "End interview" }).click();
await page.getByRole("button", { name: /End and evaluate/i }).click();
await page.getByText("End-of-interview scorecard").waitFor({ timeout: 30000 });

const rows = await page.locator(".scorecard-row").count();
if (rows !== 5) failures.push(`expected 5 scorecard rows, found ${rows}`);

const assessedChips = await page.locator(".level-chip").allInnerTexts();
if (!assessedChips.some((text) => text.includes("·"))) failures.push("no competency reached an assessed level");
if (!assessedChips.some((text) => text.includes("Not assessed"))) failures.push("expected at least one not-assessed competency");

const quotes = await page.locator(".scorecard-quote").count();
if (quotes < 1) failures.push("expected at least one quoted transcript excerpt");

const summary = await page.locator(".scorecard-summary").innerText();
if (!summary.includes("Overall")) failures.push(`scorecard summary missing overall level: ${summary}`);

// The quoted evidence must be the candidate's own words.
const quoteText = await page.locator(".scorecard-quote").first().innerText();
if (!quoteText.includes("read path dominates") && !quoteText.includes("10 million")) {
  failures.push(`quoted evidence is not a real excerpt: ${quoteText}`);
}

// Level legend expands with the calibration anchors (scoped: anchors also appear in evidence notes).
await page.locator(".level-scale summary").click();
await page.locator("details.level-scale[open]").waitFor({ timeout: 5000 });
await page.locator("details.level-scale").getByText("Compares alternatives, ties decisions to requirements and scale").waitFor({ timeout: 5000 });

// Practice targets are level-calibrated (they reference the next level).
const improvements = await page.locator(".evaluation-improvements li").allInnerTexts();
if (!improvements.length) failures.push("expected at least one practice target");

mkdirSync("artifacts", { recursive: true });
await page.screenshot({ path: "artifacts/scorecard-desktop.png" });

// Narrow viewport: the scorecard must not overflow horizontally.
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 1) failures.push(`horizontal overflow of ${overflow}px at 375px wide`);
await page.screenshot({ path: "artifacts/scorecard-mobile.png" });

await browser.close();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Scorecard smoke passed: 5 rows, ${assessedChips.filter((text) => text.includes("·")).length} assessed levels, ${quotes} quoted excerpts, summary "${summary.trim()}"`);
}
