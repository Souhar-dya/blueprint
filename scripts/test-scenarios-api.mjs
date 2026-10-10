import { chromium } from "playwright";

const base = "http://localhost:3000";

const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext();
const page = await context.newPage();

const email = `test-${Date.now()}@example.com`;
const register = await page.request.post(`${base}/api/auth/register`, {
  data: { email, password: "testpassword123" },
});
console.log("Register:", register.status());

await page.goto(`${base}/scenarios`);
await page.getByRole("heading", { name: /What are you ready/i }).waitFor({ timeout: 20000 });

const testName = `Debug Scenario ${Date.now()}`;
const postResult = await page.evaluate(async (name) => {
  const r = await fetch("/api/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, prompt: "Test prompt for debugging", scale: "100", difficulty: "medium" }),
  });
  return { status: r.status, body: await r.json() };
}, testName);
console.log("POST /api/scenarios:", JSON.stringify(postResult));

const listResult = await page.evaluate(async () => {
  const r = await fetch("/api/scenarios", { credentials: "include" });
  return { status: r.status, body: await r.json() };
});
console.log("GET /api/scenarios:", JSON.stringify(listResult));

await browser.close();
