import { chromium } from "@playwright/test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.WORK_HELPER_UI_URL ?? "http://127.0.0.1:3000";
const projectPath = await mkdtemp(join(tmpdir(), "work-helper-e2e-project-"));
const projectName = `E2E Todo ${Date.now().toString(36)}`;
const waitForCompletion = process.env.WORK_HELPER_E2E_WAIT_FOR_COMPLETION !== "0";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let projectId: string | null = null;

try {
  await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Name").fill(projectName);
  await page.getByPlaceholder("Path (optional)").fill(projectPath);
  await page.getByRole("button", { name: /create/i }).click();
  await page.getByText(projectName).waitFor({ timeout: 10_000 });
  await page.getByRole("link", { name: "Open" }).last().click();
  await page.waitForURL(/\/projects\/.+/u, { timeout: 10_000 });
  projectId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1) ?? null;

  await page
    .locator("textarea")
    .fill(
      "Create a minimal React todo app in this project. Create these files: package.json, index.html, vite.config.js, src/main.jsx, src/App.jsx, src/styles.css. Include a simple todo UI. Reply with only COMPLETED.",
    );
  if (waitForCompletion) {
    await page.getByRole("button", { name: /send request/i }).click();
    const status = page.getByTestId("run-status");
    await status.waitFor({ timeout: 20_000 });
    await page.getByText("job.md").waitFor({ timeout: 10_000 });

    await page.waitForFunction(() => {
      const value = document.querySelector('[data-testid="run-status"]')?.textContent?.trim();
      if (value === "failed") {
        throw new Error("Request run failed before todo app files were created.");
      }
      return value === "completed";
    }, null, { timeout: 620_000 });
    await stat(join(projectPath, "package.json"));
    await stat(join(projectPath, "src"));
  }
} finally {
  if (projectId) {
    await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
  }
  await browser.close();
}
