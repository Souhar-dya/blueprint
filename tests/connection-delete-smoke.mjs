import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
// Device Guard blocks Playwright's chrome-headless-shell binary on this machine; the full Chromium build launches fine.
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

// Capture every interviewer turn request so we can prove the wire removal is
// sent as an observation and never as a spoken answer.
const turnRequests = [];
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/interview/next")) {
    try {
      turnRequests.push({ body: JSON.parse(request.postData() || "{}"), done: false });
    } catch {
      turnRequests.push({ parseError: true, done: false });
    }
  }
});
page.on("response", (response) => {
  if (response.request().method() === "POST" && response.url().includes("/api/interview/next")) {
    const entry = turnRequests[turnRequests.length - 1];
    if (entry) entry.done = true;
  }
});

const observations = () => turnRequests.filter((entry) => entry.body?.mode === "observe");
const edgeCount = (body, key) => (body.state?.[key]?.edges || []).length;
const waitFor = async (predicate, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  let match = predicate();
  while (!match && Date.now() < deadline) {
    await page.waitForTimeout(300);
    match = predicate();
  }
  return match || null;
};

// A two-node design joined by a single wire, imported through the real UI.
const imported = {
  nodes: [
    { id: "web", type: "client", label: "Web client", x: 22, y: 28, reasoning: "", note: "" },
    { id: "api", type: "service", label: "API service", x: 68, y: 70, reasoning: "", note: "" },
  ],
  edges: [{ id: "edge-1", source: "web", target: "api", label: "request", sourceHandle: "right-1", targetHandle: "left-1" }],
};

await page.goto(`${base}/interview?scenario=youtube`);
await page.getByText("Interview live").waitFor({ timeout: 20000 });
await page.locator(".architecture-node").first().waitFor({ timeout: 15000 });

await page.locator(".file-button input[type='file']").setInputFiles({
  name: "arch.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(imported)),
});
await page.getByRole("button", { name: /API service component/ }).waitFor({ timeout: 15000 });

// Let the import's observation round-trip and apply so the wire removal diffs
// against a canvas that already contains the connection.
const importObservation = await waitFor(() => observations().find((entry) => entry.done && edgeCount(entry.body, "architectureSnapshot") === 1), 30000);
if (!importObservation) failures.push("import did not produce an observation carrying the wire");
await page.waitForTimeout(2500);

// Click the wire itself. The hit line is invisible but 16px wide; sample along
// the rendered geometry to find a point that isn't clipped under the sidebar.
await page.locator(".canvas-edge-hit").first().waitFor({ timeout: 10000 });
const wirePoint = await page.evaluate(() => {
  const line = document.querySelector(".canvas-edge-hit");
  if (!line) return null;
  const ctm = line.getScreenCTM();
  const a = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(ctm);
  const b = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(ctm);
  for (let t = 0.15; t <= 0.85; t += 0.02) {
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const el = document.elementFromPoint(px, py);
    if (el && el.classList.contains("canvas-edge-hit")) return { x: px, y: py };
  }
  return null;
});
if (!wirePoint) {
  failures.push("could not find a clickable point on the wire");
} else {
  await page.mouse.click(wirePoint.x, wirePoint.y);
}
await page.waitForTimeout(300);

const deleteButton = page.getByRole("button", { name: "Delete connection", exact: true });
if (await deleteButton.isDisabled()) failures.push("Delete connection stayed disabled after selecting a wire");

await deleteButton.click();
await page.waitForTimeout(600);

if (await page.locator(".canvas-edge-hit").count()) failures.push("Delete connection did not remove the wire");
if (!(await page.getByRole("button", { name: /API service component/ }).count())) failures.push("Delete connection wrongly removed a component");

const deleteObservation = await waitFor(
  () => observations().find((entry) => edgeCount(entry.body, "architectureSnapshot") === 0 && edgeCount(entry.body, "previousArchitectureSnapshot") === 1),
);
if (!deleteObservation) {
  failures.push(`no observation diffing the removed wire (saw ${observations().length} observations)`);
} else if (deleteObservation.body.answer !== "") {
  failures.push(`wire observation carried a spoken answer: ${JSON.stringify(deleteObservation.body.answer)}`);
}

await browser.close();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Connection-delete smoke passed: selecting a wire and choosing Delete connection removed the connection and notified the interviewer.`);
}
