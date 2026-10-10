import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
// Device Guard blocks Playwright's chrome-headless-shell binary on this machine; the full Chromium build launches fine.
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

// Capture every interviewer turn request so we can prove canvas edits (add and
// delete) are sent as observations rather than as spoken answers.
const turnRequests = [];
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/interview/next")) {
    try {
      turnRequests.push(JSON.parse(request.postData() || "{}"));
    } catch {
      turnRequests.push({ parseError: true });
    }
  }
});

const observations = () => turnRequests.filter((body) => body.mode === "observe");
const labels = (body, key) => (body.state?.[key]?.nodes || []).map((node) => node.label);
const waitForObservation = async (predicate, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  let match = observations().find(predicate);
  while (!match && Date.now() < deadline) {
    await page.waitForTimeout(400);
    match = observations().find(predicate);
  }
  return match || null;
};

await page.goto(`${base}/interview?scenario=youtube`);
await page.getByText("Interview live").waitFor({ timeout: 20000 });
await page.locator(".architecture-node").first().waitFor({ timeout: 15000 });

// 1) Add a component the way a candidate would.
await page.getByRole("button", { name: /Add service/ }).click();
await page.getByLabel("New service name").fill("Redis cache");
await page.locator(".add-service-form .primary-button").click();

const addObservation = await waitForObservation(
  (body) => labels(body, "architectureSnapshot").includes("Redis cache"),
);
if (!addObservation) {
  failures.push(`no observation after adding a node (saw ${observations().length} observations)`);
} else {
  if (addObservation.answer !== "") failures.push(`add observation carried a spoken answer: ${JSON.stringify(addObservation.answer)}`);
  const previousIds = new Set((addObservation.state?.previousArchitectureSnapshot?.nodes || []).map((node) => node.id));
  const added = (addObservation.state?.architectureSnapshot?.nodes || []).filter((node) => !previousIds.has(node.id));
  if (!added.some((node) => node.label === "Redis cache")) failures.push("add observation did not include the added component");
}

// 2) Delete a component. Give the add reaction a moment to land so the delete
//    request diffs against a canvas that already contains Redis.
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Redis cache component/ }).click();
await page.getByRole("button", { name: "Delete component" }).click();
await page.waitForTimeout(500);
if (await page.getByRole("button", { name: /Redis cache component/ }).count()) failures.push("delete did not remove the component from the canvas");

const deleteObservation = await waitForObservation(
  (body) => !labels(body, "architectureSnapshot").includes("Redis cache") && labels(body, "previousArchitectureSnapshot").includes("Redis cache"),
);
if (!deleteObservation) {
  failures.push(`no observation diffing the removed node (saw ${observations().length} observations)`);
} else if (deleteObservation.answer !== "") {
  failures.push(`delete observation carried a spoken answer: ${JSON.stringify(deleteObservation.answer)}`);
}

await browser.close();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Observation smoke passed: add and delete both sent as observe-mode turns (${observations().length} observations).`);
}
