import { chromium } from "playwright";

// This check watches the interviewer's spoken caption, so it needs the
// deterministic mock provider to be stable (LLM_PROVIDER=mock) — though it also
// works against a real model, just with looser timing.
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

const observeRequests = [];
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/interview/next")) {
    try {
      const body = JSON.parse(request.postData() || "{}");
      if (body.mode === "observe") observeRequests.push({ body, done: false });
    } catch {
      /* ignore */
    }
  }
});
page.on("response", (response) => {
  if (response.request().method() === "POST" && response.url().includes("/api/interview/next")) {
    const entry = observeRequests[observeRequests.length - 1];
    if (entry) entry.done = true;
  }
});

const captionText = () => page.locator(".ai-caption").innerText();
const nodeLabels = (body, key) => (body.state?.[key]?.nodes || []).map((node) => node.label);
const waitFor = async (predicate, timeoutMs = 45000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(500);
  }
};

await page.goto(`${base}/interview?scenario=youtube`);
await page.getByText("Interview live").waitFor({ timeout: 20000 });
await page.locator(".architecture-node").first().waitFor({ timeout: 15000 });
const openingCaption = await captionText();

// 1) Add a component. The interviewer should name it back in a question.
await page.getByRole("button", { name: /Add service/ }).click();
await page.getByLabel("New service name").fill("Redis cache");
await page.locator(".add-service-form .primary-button").click();

const afterAdd = await waitFor(async () => {
  const text = await captionText();
  return text !== openingCaption && text.includes("Redis cache") ? text : null;
});
if (!afterAdd) failures.push(`interviewer did not ask about the added component: "${await captionText()}"`);

const addRequest = await waitFor(async () => {
  const found = observeRequests.find((entry) => entry.done && nodeLabels(entry.body, "architectureSnapshot").includes("Redis cache"));
  return found || null;
}, 45000);
if (!addRequest) failures.push("no observe request carried the added component");
else if (nodeLabels(addRequest.body, "previousArchitectureSnapshot").includes("Redis cache")) failures.push("observation baseline already contained the component");

// 2) Remove it. The interviewer should reference the removal in a fresh turn.
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /Redis cache component/ }).click();
await page.getByRole("button", { name: "Delete component" }).click();

const afterRemove = await waitFor(async () => {
  const text = await captionText();
  return text !== afterAdd && /redis/i.test(text) ? text : null;
});
if (!afterRemove) failures.push(`interviewer did not ask about the removed component: "${await captionText()}"`);

const removeRequest = await waitFor(async () => {
  const found = observeRequests.find(
    (entry) => nodeLabels(entry.body, "previousArchitectureSnapshot").includes("Redis cache") && !nodeLabels(entry.body, "architectureSnapshot").includes("Redis cache"),
  );
  return found || null;
}, 45000);
if (!removeRequest) failures.push("no observe request carried the removed component");

await browser.close();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Observation-question smoke passed.\n  After add:    "${(afterAdd || "").replace(/\s+/g, " ").trim()}"\n  After remove: "${(afterRemove || "").replace(/\s+/g, " ").trim()}"`);
}
