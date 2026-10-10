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

// Check what the API returns from the browser context
const apiResult = await page.evaluate(async () => {
  try {
    const r = await fetch("/api/scenarios", { credentials: "include" });
    const text = await r.text();
    return { status: r.status, body: text, headers: Object.fromEntries(r.headers.entries()) };
  } catch (e) {
    return { error: e.message };
  }
});
console.log("API result from browser:", JSON.stringify(apiResult, null, 2));

// Check cookies
const cookies = await context.cookies();
console.log("Cookies:", JSON.stringify(cookies.map(c => ({ name: c.name, domain: c.domain })), null, 2));

await browser.close();
