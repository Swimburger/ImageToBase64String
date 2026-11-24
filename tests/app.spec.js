import { expect, test } from "@playwright/test";

test("serves the production-shaped app with Cloudflare headers", async ({ page, request }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(response.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(await response.text()).not.toMatch(/google-analytics|googletagmanager|gtag\(/i);

  await page.goto("/");
  await expect(page).toHaveTitle("Online base64 image encoder");
  await expect(page.locator("#output-text")).toHaveValue(/^data:image\/jpeg;base64,/);
  expect(pageErrors).toEqual([]);
});

test("encodes a selected image and toggles the output format", async ({ page }) => {
  await page.goto("/");

  await page.locator("#file-input").setInputFiles("ramen.jpg");

  await expect(page.locator("#output-text")).toHaveValue(/^data:image\/jpeg;base64,/);
  await expect(page.locator("#output-image")).toBeVisible();
  await expect(page.locator("#snippet-section")).toBeVisible();

  await page.locator('label[for="format-base64"]').click();
  await expect(page.locator("#format-base64")).toBeChecked();
  await expect(page.locator("#output-text")).not.toHaveValue(/^data:/);
});

test("publishes only the explicit production asset allowlist", async ({ request }) => {
  expect((await request.get("/og-image.png")).status()).toBe(200);
  expect((await request.get("/ramen.jpg")).status()).toBe(200);
  expect((await request.get("/og-generator.html")).status()).toBe(404);
  expect((await request.get("/package.json")).status()).toBe(404);
});

