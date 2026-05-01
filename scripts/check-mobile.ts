import { chromium } from "@playwright/test";

const baseUrl = process.env.WORK_HELPER_UI_URL ?? "http://127.0.0.1:3000";
const routes = ["/projects"];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

try {
  for (const route of routes) {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    if (!response?.ok()) {
      throw new Error(`Mobile check failed for ${route}: HTTP ${response?.status() ?? "unknown"}`);
    }

    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (horizontalOverflow) {
      throw new Error(`Mobile check failed for ${route}: horizontal overflow detected.`);
    }
  }

  const detailLink = page.getByRole("link", { name: /open/i }).first();
  if ((await detailLink.count()) > 0) {
    await detailLink.click();
    await page.waitForLoadState("networkidle");
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (horizontalOverflow) {
      throw new Error("Mobile check failed for detail page: horizontal overflow detected.");
    }
  }
} finally {
  await browser.close();
}
