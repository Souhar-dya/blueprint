import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];

page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

// Register a throwaway account
const email = `scenarios-smoke-${Date.now()}@example.com`;
const register = await page.request.post(`${base}/api/auth/register`, {
  data: { email, password: "scenarios-smoke-pass" },
});
if (!register.ok()) throw new Error(`Registration failed: ${register.status()} ${await register.text()}`);

// Navigate to scenarios page
await page.goto(`${base}/scenarios`);
await page.getByRole("heading", { name: /What are you ready/i }).waitFor({ timeout: 20000 });

// Fill the custom scenario form
const testName = `Test Scenario ${Date.now()}`;
const testPrompt = "Build a real-time collaborative document editor.";
await page.getByLabel("Name").fill(testName);
await page.getByLabel("Problem statement").fill(testPrompt);
await page.getByLabel("Expected scale").fill("10,000 concurrent editors");
await page.getByLabel("Difficulty").selectOption("hard");

// Submit the custom scenario
await page.getByRole("button", { name: /Start custom interview/i }).click();

// Should redirect to interview page (now authenticated)
await page.waitForURL("**/interview**", { timeout: 20000 });
await page.getByText("Interview live").waitFor({ timeout: 20000 });

// Verify the scenario name appears in the interview header
const headerText = await page.locator(".workspace-title").innerText();
if (!headerText.includes(testName)) {
  failures.push(`Custom scenario name not found in interview header: ${headerText}`);
}

// Go back to scenarios page to verify the saved scenario appears
await page.goto(`${base}/scenarios`);
await page.getByRole("heading", { name: /What are you ready/i }).waitFor({ timeout: 20000 });

// Wait for the saved scenarios section to load
await page.waitForTimeout(1000);

// The saved scenario should appear in the "Custom scenarios" section
const savedHeading = page.getByRole("heading", { name: /Custom scenarios/i });
if (!(await savedHeading.isVisible().catch(() => false))) {
  failures.push("Saved scenarios section not found");
} else {
  const savedScenario = page.locator("text=" + testName).first();
  if (!(await savedScenario.isVisible().catch(() => false))) {
    failures.push("Custom scenario not found in saved scenarios list");
  } else {
    // Delete the saved scenario
    const deleteButton = page.getByRole("button", { name: "Delete" }).first();
    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click();
      await page.waitForTimeout(500);
      const stillVisible = await page.locator("text=" + testName).first().isVisible().catch(() => false);
      if (stillVisible) {
        failures.push("Custom scenario still visible after deletion");
      }
    } else {
      failures.push("Delete button not visible for saved scenario");
    }
  }
}

// Verify predefined scenarios still work
await page.getByRole("link", { name: /Design YouTube/i }).first().click();
await page.waitForURL("**/interview?scenario=youtube**", { timeout: 20000 });
await page.getByText("Interview live").waitFor({ timeout: 20000 });

await browser.close();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Scenarios smoke test passed: custom scenario creation, persistence, deletion, and predefined scenario flow.");
}
