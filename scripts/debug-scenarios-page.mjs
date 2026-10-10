import { chromium } from "playwright";

const base = "http://localhost:3000";

const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const email = `debug-${Date.now()}@example.com`;
await page.request.post(`${base}/api/auth/register`, {
  data: { email, password: "testpassword123" },
});

await page.goto(`${base}/scenarios`);
await page.getByRole("heading", { name: /What are you ready/i }).waitFor({ timeout: 20000 });

// Check if saved scenarios section exists
const savedHeading = await page.getByRole("heading", { name: /Your saved scenarios/i }).count();
console.log("Saved scenarios heading count:", savedHeading);

// Check for any h2 elements
const h2Texts = await page.locator("h2").allInnerTexts();
console.log("H2 texts:", JSON.stringify(h2Texts));

// Check for scenario cards
const scenarioCards = await page.locator(".scenario-grid").count();
console.log("Scenario grids:", scenarioCards);

// Get the full page text to see what's rendered
const bodyText = await page.locator("body").innerText();
console.log("Body text (first 2000 chars):", bodyText.substring(0, 2000));

await browser.close();
