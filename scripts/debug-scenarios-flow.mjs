import { chromium } from "playwright";

const base = "http://localhost:3000";

const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

// Enable request/response logging
page.on("request", (req) => {
  if (req.url().includes("/api/scenarios")) {
    console.log(`[REQ] ${req.method()} ${req.url()}`);
  }
});
page.on("response", (res) => {
  if (res.url().includes("/api/scenarios")) {
    console.log(`[RES] ${res.status()} ${res.url()}`);
  }
});

const email = `debug-${Date.now()}@example.com`;
console.log("1. Registering user:", email);
const register = await page.request.post(`${base}/api/auth/register`, {
  data: { email, password: "testpassword123" },
});
console.log("   Register status:", register.status());

console.log("2. Navigating to /scenarios");
await page.goto(`${base}/scenarios`);
await page.getByRole("heading", { name: /What are you ready/i }).waitFor({ timeout: 20000 });

console.log("3. Filling custom scenario form");
const testName = `Debug Scenario ${Date.now()}`;
await page.getByLabel("Name").fill(testName);
await page.getByLabel("Problem statement").fill("Build a test system.");
await page.getByLabel("Expected scale").fill("1,000 users");
await page.getByLabel("Difficulty").selectOption("medium");

console.log("4. Submitting form (POST /api/scenarios)");
const [response] = await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/scenarios")),
  page.getByRole("button", { name: /Start custom interview/i }).click(),
]);
console.log("   POST response status:", response.status());
const postBody = await response.json();
console.log("   POST response body:", JSON.stringify(postBody));

console.log("5. Waiting for redirect to /interview");
await page.waitForURL("**/interview**", { timeout: 20000 });
console.log("   Redirected to:", page.url());

console.log("6. Going back to /scenarios");
await page.goto(`${base}/scenarios`);
await page.getByRole("heading", { name: /What are you ready/i }).waitFor({ timeout: 20000 });

console.log("7. Waiting for saved scenarios to load");
await page.waitForTimeout(2000);

console.log("8. Checking for saved scenario");
const savedHeading = page.getByRole("heading", { name: /Your saved scenarios/i });
const headingVisible = await savedHeading.isVisible().catch(() => false);
console.log("   'Your saved scenarios' heading visible:", headingVisible);

if (headingVisible) {
  const scenarioText = await page.locator("text=" + testName).first().isVisible().catch(() => false);
  console.log("   Scenario name visible:", scenarioText);
} else {
  // Check what the API returns
  const apiResult = await page.evaluate(async () => {
    const r = await fetch("/api/scenarios", { credentials: "include" });
    return { status: r.status, body: await r.json() };
  });
  console.log("   API returns:", JSON.stringify(apiResult));

  // Check all h2s
  const h2s = await page.locator("h2").allInnerTexts();
  console.log("   H2 headings on page:", JSON.stringify(h2s));
}

await browser.close();
console.log("Done.");
