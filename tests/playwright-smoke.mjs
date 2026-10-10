import { chromium } from "playwright";

// Device Guard blocks Playwright's chrome-headless-shell binary on this machine; the full Chromium build launches fine.
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];

page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

async function expectText(text) {
  await page.getByText(text, { exact: false }).first().waitFor();
}

await page.goto("http://localhost:3000/");
await expectText("Build systems.");
await page.getByRole("link", { name: /Start an interview/i }).first().click();
await page.waitForURL("**/scenarios");
await page.getByRole("heading", { name: "Design YouTube" }).waitFor();
await page.getByRole("link", { name: /Design YouTube/i }).click();
// The interview product is anonymous: a scenario starts directly without a
// sign-in, and the loader assigns a fresh per-interview run token.
await page.waitForURL(/\/interview\?scenario=youtube/);
await page.waitForURL(/run=[0-9a-zA-Z]+/);
await expectText("Architecture tools");
await expectText("Web Client");

await page.goto("http://localhost:3000/scenarios");
await page.getByLabel("Name").fill("Design an Internal Platform");
await page.getByLabel("Problem statement").fill("Build a platform for teams to deploy services safely.");
await page.getByLabel("Expected scale").fill("10,000 deployments per day");
await page.getByRole("button", { name: /Start custom interview/i }).click();
await page.waitForURL(/scenario=Design\+an\+Internal\+Platform/);
await page.waitForURL(/run=[0-9a-zA-Z]+/);
await expectText("Architecture tools");

for (const route of ["/how-it-works", "/resources", "/faq", "/privacy", "/terms", "/contact", "/history", "/monitoring", "/not-a-route"]) {
  const response = await page.goto(`http://localhost:3000${route}`);
  if (!response || response.status() >= 500) failures.push(`${route}: ${response?.status()}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Playwright smoke test passed: landing, scenarios, anonymous interview with per-run token, custom scenario, public routes, history, monitoring, and 404.");
}

await browser.close();