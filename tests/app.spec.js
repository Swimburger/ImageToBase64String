import { expect, test } from "@playwright/test";

const relativeLuminance = (hex) => {
  const channels = hex.match(/[\da-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};

const contrastRatio = (first, second) => {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

const dispatchClipboardPaste = (page, { files = [], text, target = "body" } = {}) => (
  page.evaluate(({ files, text, target }) => {
    const clipboardData = new DataTransfer();
    if (text !== undefined) clipboardData.setData("text/plain", text);
    for (const file of files) {
      clipboardData.items.add(new File(
        [new Uint8Array(file.bytes)],
        file.name,
        { type: file.type, lastModified: file.lastModified || 1 },
      ));
    }
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    document.querySelector(target).dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented };
  }, { files, text, target })
);

const onePixelPng = [...Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)];

test("serves the production-shaped app with local assets and metadata", async ({ page, request }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(response.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  const html = await response.text();
  expect(html).not.toMatch(/google-analytics|googletagmanager|gtag\(|cdn\.jsdelivr|bootstrap/i);
  expect(html).toContain('<meta name="color-scheme" content="light dark">');
  expect(html.indexOf('<meta name="color-scheme"')).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  expect(html).toContain('<link rel="canonical" href="https://img2base64.swimburger.net/">');
  expect(html).toContain('<meta property="og:url" content="https://img2base64.swimburger.net/">');
  expect(html).toContain('<meta property="og:image" content="https://img2base64.swimburger.net/og-image.png">');
  expect(html).toContain('<meta property="og:image:width" content="1200">');
  expect(html).toContain('<meta property="og:image:height" content="630">');
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">');
  expect(html).toContain('href="https://swimburger.net/privacy"');

  for (const asset of [
    "/og-image.png",
    "/favicon.svg",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/favicon-96x96.png",
    "/apple-touch-icon.png",
  ]) {
    const assetResponse = await request.get(asset);
    expect(assetResponse.status(), asset).toBe(200);
    expect(assetResponse.headers()["cache-control"], asset).toContain("max-age=86400");
  }

  await page.goto("/");
  await expect(page).toHaveTitle("Online base64 image encoder");
  await expect(page.locator("#output-text")).toHaveValue(/^data:image\/jpeg;base64,/);
  await expect(page.getByRole("status")).toContainText("Sample image encoded successfully");
  await expect(page.locator("#copy-button")).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("pastes a PNG through the image pipeline without moving keyboard focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#copy-button")).toBeEnabled();
  await page.locator("#drop-zone").focus();

  const paste = await dispatchClipboardPaste(page, {
    files: [{ name: "", type: "image/png", bytes: onePixelPng }],
    target: "#drop-zone",
  });

  expect(paste.defaultPrevented).toBe(true);
  await expect(page.locator("#drop-zone")).toBeFocused();
  await expect(page.locator("#output-text")).toHaveValue(/^data:image\/png;base64,/);
  await expect(page.locator("#file-name")).toHaveText("pasted-image.png");
  await expect(page.locator("#mime-type")).toHaveText("image/png");
  await expect(page.locator("#output-image")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Pasted image “pasted-image.png” encoded successfully. The complete output is ready to copy.",
  );
  await expect(page.locator("#paste-hint")).toContainText("Ctrl+V or Command+V");
});

test("uses an image from mixed clipboard data and leaves non-image paste alone", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#copy-button")).toBeEnabled();
  const originalOutput = await page.locator("#output-text").inputValue();
  const originalStatus = await page.getByRole("status").textContent();

  const textPaste = await dispatchClipboardPaste(page, {
    text: "keep this normal text paste",
    target: "#output-text",
  });
  expect(textPaste.defaultPrevented).toBe(false);
  await expect(page.locator("#output-text")).toHaveValue(originalOutput);
  await expect(page.getByRole("status")).toHaveText(originalStatus);

  const mixedPaste = await dispatchClipboardPaste(page, {
    text: "clipboard also contains text",
    files: [{ name: "clipboard.webp", type: "image/webp", bytes: [82, 73, 70, 70] }],
  });
  expect(mixedPaste.defaultPrevented).toBe(true);
  await expect(page.locator("#file-name")).toHaveText("clipboard.webp");
  await expect(page.locator("#mime-type")).toHaveText("image/webp");
  await expect(page.locator("#output-text")).toHaveValue(/^data:image\/webp;base64,/);
});

test("keeps the newest pasted image when reads are replaced rapidly", async ({ page }) => {
  await page.addInitScript(() => {
    class DelayedFileReader {
      readyState = 0;

      readAsDataURL(file) {
        this.readyState = 1;
        const delay = file.name === "first.png" ? 250 : 0;
        window.setTimeout(() => {
          if (this.readyState !== 1) return;
          this.readyState = 2;
          this.result = `data:${file.type || "image/jpeg"};base64,${btoa(file.name || "sample")}`;
          this.onload?.();
        }, delay);
      }

      abort() {
        if (this.readyState !== 1) return;
        this.readyState = 2;
        this.onabort?.();
      }
    }
    Object.defineProperty(window, "FileReader", { configurable: true, value: DelayedFileReader });
  });
  await page.goto("/");
  await expect(page.locator("#copy-button")).toBeEnabled();

  await dispatchClipboardPaste(page, {
    files: [{ name: "first.png", type: "image/png", bytes: [1] }],
  });
  await dispatchClipboardPaste(page, {
    files: [{ name: "second.png", type: "image/png", bytes: [2] }],
  });

  await expect(page.locator("#file-name")).toHaveText("second.png");
  await expect(page.locator("#output-text")).toHaveValue("data:image/png;base64,c2Vjb25kLnBuZw==");
  await page.waitForTimeout(300);
  await expect(page.locator("#file-name")).toHaveText("second.png");
  await expect(page.getByRole("status")).toContainText("Pasted image “second.png” encoded successfully");
});

test("announces a pasted-image read failure without moving focus", async ({ page }) => {
  await page.addInitScript(() => {
    class FailingFileReader {
      readyState = 0;

      readAsDataURL() {
        this.readyState = 1;
        queueMicrotask(() => {
          this.readyState = 2;
          this.onerror?.();
        });
      }
    }
    Object.defineProperty(window, "FileReader", { configurable: true, value: FailingFileReader });
  });
  await page.goto("/");
  await page.locator("#drop-zone").focus();
  await dispatchClipboardPaste(page, {
    files: [{ name: "broken.png", type: "image/png", bytes: [0] }],
    target: "#drop-zone",
  });

  await expect(page.locator("#drop-zone")).toBeFocused();
  await expect(page.locator("#copy-button")).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText(
    "The pasted image could not be read. Copy it again and retry.",
  );
  await expect(page.getByRole("status")).toHaveAttribute("data-tone", "error");
});

for (const [layout, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test(`uses one visible keyboard focus system across the ${layout} layout`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#copy-button")).toBeEnabled();

    const assertFocus = async (selector, expectedColor) => {
      const control = page.locator(selector);
      await expect(control).toBeFocused();
      const appearance = await control.evaluate((element) => {
        const paintedElement = element.matches('.format-options input')
          ? element.nextElementSibling
          : element;
        const style = getComputedStyle(paintedElement);
        return {
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      expect(appearance).toEqual({
        outlineColor: expectedColor,
        outlineOffset: "3px",
        outlineStyle: "solid",
        outlineWidth: "3px",
      });
    };

    await page.keyboard.press("Tab");
    await assertFocus(".github-corner", "rgb(255, 201, 102)");
    await page.keyboard.press("Tab");
    await assertFocus("#drop-zone", "rgb(74, 6, 54)");
    await page.keyboard.press("Tab");
    await assertFocus("#format-dataurl", "rgb(74, 6, 54)");
    await page.keyboard.press("ArrowRight");
    await assertFocus("#format-base64", "rgb(74, 6, 54)");
    await page.keyboard.press("Tab");
    await assertFocus("#copy-button", "rgb(74, 6, 54)");
    await page.keyboard.press("Tab");
    await assertFocus("#output-text", "rgb(74, 6, 54)");

    for (const selector of [
      "#snippet-html", '[data-target="snippet-html"]',
      "#snippet-css", '[data-target="snippet-css"]',
      "#snippet-md", '[data-target="snippet-md"]',
    ]) {
      await page.keyboard.press("Tab");
      await assertFocus(selector, "rgb(74, 6, 54)");
    }

    for (const selector of [
      'footer a[href="https://swimburger.net"]',
      'footer a[href="https://twitter.com/RealSwimburger"]',
      'footer a[href="https://swimburger.net/privacy"]',
    ]) {
      await page.keyboard.press("Tab");
      await assertFocus(selector, "rgb(255, 201, 102)");
    }
  });
}

test("uses a system focus color in forced colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".github-corner")).toBeFocused();
  await expect(page.locator("html")).toHaveCSS("--focus-ring", "Highlight");
  await expect(page.locator(".github-corner")).toHaveCSS("outline-style", "solid");
  await expect(page.locator(".github-corner")).toHaveCSS("outline-width", "3px");
  await expect(page.locator("html")).toHaveCSS("--border", "CanvasText");
  await expect(page.locator("html")).toHaveCSS("--primary", "Highlight");
  await page.locator("#copy-button").evaluate((button) => { button.disabled = true; });
  await expect(page.locator("#copy-button")).toHaveCSS("opacity", "1");
});

test("renders all result states with contrast-safe dark theme tokens", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard unavailable"); } },
    });
  });
  await page.goto("/");
  await expect(page.locator("#copy-button")).toBeEnabled();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light dark");

  const expectedTokens = {
    "--background": "#171216",
    "--surface": "#231c21",
    "--surface-muted": "#2d252b",
    "--text": "#f7f2f5",
    "--text-muted": "#c9bec5",
    "--border": "#877780",
    "--primary": "#b83e69",
    "--primary-hover": "#c04b75",
    "--interactive": "#d86b94",
    "--focus-ring": "#ffc966",
  };
  for (const [token, value] of Object.entries(expectedTokens)) {
    await expect(page.locator("html")).toHaveCSS(token, value);
  }

  expect(contrastRatio("#877780", "#231c21")).toBeGreaterThanOrEqual(3);
  expect(contrastRatio("#b83e69", "#231c21")).toBeGreaterThanOrEqual(3);
  expect(contrastRatio("#ffffff", "#b83e69")).toBeGreaterThanOrEqual(4.5);
  for (const adjacentColor of ["#171216", "#231c21", "#b83e69", "#c04b75"]) {
    expect(contrastRatio("#ffc966", adjacentColor)).toBeGreaterThanOrEqual(3);
  }
  for (const adjacentColor of ["#fafafa", "#ffffff"]) {
    expect(contrastRatio("#4a0636", adjacentColor)).toBeGreaterThanOrEqual(3);
  }
  expect(contrastRatio("#81747c", "#ffffff")).toBeGreaterThanOrEqual(3);

  await expect(page.locator("#drop-zone")).toHaveCSS("background-color", "rgb(35, 28, 33)");
  await expect(page.locator("#drop-zone")).toHaveCSS("border-color", "rgb(135, 119, 128)");
  await expect(page.locator("#drop-zone svg")).toHaveCSS("fill", "rgb(216, 107, 148)");
  await expect(page.locator("#format-dataurl + label")).toHaveCSS("background-color", "rgb(184, 62, 105)");
  await expect(page.locator("#output-text")).toHaveCSS("background-color", "rgb(35, 28, 33)");
  await expect(page.locator("#output-text")).toHaveCSS("color-scheme", "light dark");
  await expect(page.locator(".file-details div").first()).toHaveCSS("background-color", "rgb(45, 37, 43)");
  await expect(page.locator(".snippet-copy").first()).toHaveCSS("border-color", "rgb(135, 119, 128)");
  await expect(page.getByRole("status")).toHaveCSS("color", "rgb(142, 224, 174)");
  await expect(page.getByRole("status")).toHaveCSS("background-color", "rgb(22, 59, 39)");
  await expect(page.locator("footer a").first()).toHaveCSS("color", "rgb(255, 201, 102)");

  await page.locator("#file-input").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc((100 * 1024) + 1),
  });
  await expect(page.locator("#output-preview-note")).toBeVisible();
  await expect(page.locator("#output-preview-note")).toHaveCSS("color", "rgb(201, 190, 197)");

  await page.locator("#copy-button").click();
  await expect(page.getByRole("status")).toHaveCSS("color", "rgb(255, 180, 189)");
  await expect(page.getByRole("status")).toHaveCSS("background-color", "rgb(75, 29, 36)");

  await page.locator(".github-corner").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#drop-zone")).toBeFocused();
  await expect(page.locator("#drop-zone")).toHaveCSS("outline-color", "rgb(255, 201, 102)");
});

test("encodes an image, reports its details, and toggles the output format", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("ramen.jpg");

  await expect(page.locator("#output-text")).toHaveValue(/^data:image\/jpeg;base64,/);
  await expect(page.locator("#output-image")).toBeVisible();
  await expect(page.locator("#snippet-section")).toBeVisible();
  await expect(page.locator("#original-size")).not.toBeEmpty();
  await expect(page.locator("#encoded-size")).not.toBeEmpty();
  await expect(page.locator("#size-overhead")).toHaveText(/^\+\d+\.\d%$/);
  await expect(page.locator("#mime-type")).toHaveText("image/jpeg");
  await expect(page.locator("#snippet-section")).toContainText(
    "Ctrl+C or Command+C from these fields use the complete, valid snippets",
  );

  const formatControl = await page.locator('label[for="format-dataurl"]').boundingBox();
  const copyControl = await page.locator("#copy-button").boundingBox();
  expect(copyControl.height).toBe(formatControl.height);

  await page.locator('label[for="format-base64"]').click();
  await expect(page.locator("#format-base64")).toBeChecked();
  await expect(page.locator("#output-text")).not.toHaveValue(/^data:/);
});

test("copies a complete snippet even though its visible preview is shortened", async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.copiedText = value; } },
    });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("ramen.jpg");

  await expect(page.locator("#snippet-html")).toHaveValue(/…/);
  await page.getByRole("button", { name: "Copy HTML" }).click();
  const copied = await page.evaluate(() => window.copiedText);
  expect(copied).toMatch(/^<img src="data:image\/jpeg;base64,/);
  expect(copied).not.toContain("…");
  await expect(page.getByRole("status")).toHaveText("Copied the complete HTML snippet.");
});

test("keeps full copy actions available while shortening previews over 100 KB", async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.copiedText = value; } },
    });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc((100 * 1024) + 1),
  });

  await expect(page.locator("#output-preview-note")).toBeVisible();
  await expect(page.locator("#output-text")).toHaveValue(/…$/);
  await expect(page.locator("#snippet-section")).toBeVisible();
  await expect(page.locator("#snippet-html")).toHaveValue(/…/);
  await expect(page.locator("#snippet-css")).toHaveValue(/…/);
  await expect(page.locator("#snippet-md")).toHaveValue(/…/);
  await expect(page.locator("#copy-button")).toBeEnabled();

  await page.locator("#copy-button").click();
  const copiedDataUrl = await page.evaluate(() => window.copiedText);
  expect(copiedDataUrl).toMatch(/^data:image\/png;base64,/);
  expect(copiedDataUrl.length).toBeGreaterThan(100_000);
  expect(copiedDataUrl).not.toContain("…");

  const snippets = [
    { button: "Copy HTML", prefix: '<img src="data:image/png;base64,' },
    { button: "Copy CSS", prefix: 'background-image: url("data:image/png;base64,' },
    { button: "Copy Markdown", prefix: "![alt](data:image/png;base64," },
  ];
  for (const snippet of snippets) {
    await page.getByRole("button", { name: snippet.button }).click();
    const copiedSnippet = await page.evaluate(() => window.copiedText);
    expect(copiedSnippet.startsWith(snippet.prefix)).toBe(true);
    expect(copiedSnippet.length).toBeGreaterThan(100_000);
    expect(copiedSnippet).not.toContain("…");
  }
});

test("keyboard copy uses the full value only for truncated read-only fields", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4273",
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc((100 * 1024) + 1),
  });

  const output = page.locator("#output-text");
  await expect(output).toHaveAttribute("data-truncated", "");
  await expect(page.locator("#output-preview-note")).toContainText("Ctrl+C");
  await output.focus();
  await output.selectText();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");

  const copiedFullValue = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedFullValue).toMatch(/^data:image\/png;base64,/);
  expect(copiedFullValue.length).toBeGreaterThan(100_000);
  expect(copiedFullValue).not.toContain("…");
  await expect(page.getByRole("status")).toHaveText(
    "Copied the complete value from the shortened preview.",
  );

  const htmlSnippet = page.locator("#snippet-html");
  await htmlSnippet.focus();
  await htmlSnippet.selectText();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
  const copiedFullSnippet = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedFullSnippet).toMatch(/^<img src="data:image\/png;base64,/);
  expect(copiedFullSnippet.length).toBeGreaterThan(100_000);
  expect(copiedFullSnippet).not.toContain("…");

  await page.locator("#file-input").setInputFiles("ramen.jpg");
  await expect(output).not.toHaveAttribute("data-truncated", "");
  await output.focus();
  await output.evaluate((field) => field.setSelectionRange(0, 4));
  await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("data");
});

test("keeps copy disabled and shows a visible polite error when reading fails", async ({ page }) => {
  await page.addInitScript(() => {
    class FailingFileReader {
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    Object.defineProperty(window, "FileReader", { configurable: true, value: FailingFileReader });
  });
  await page.goto("/");

  await expect(page.locator("#copy-button")).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("The file could not be read. Please try another file.");
  await expect(page.getByRole("status")).toHaveAttribute("data-tone", "error");
});

test("shows visible polite feedback when clipboard access fails", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard unavailable"); } },
    });
  });
  await page.goto("/");
  await expect(page.locator("#copy-button")).toBeEnabled();
  await page.locator("#copy-button").click();

  await expect(page.getByRole("status")).toHaveText(
    "Copying to the clipboard failed. Select the text and copy it manually.",
  );
  await expect(page.getByRole("status")).toHaveAttribute("data-tone", "error");
});

test("publishes only the explicit production asset allowlist", async ({ request }) => {
  expect((await request.get("/app.css")).status()).toBe(200);
  expect((await request.get("/app.js")).status()).toBe(200);
  expect((await request.get("/og-image.png")).status()).toBe(200);
  expect((await request.get("/ramen.jpg")).status()).toBe(200);
  expect((await request.get("/og-generator.html")).status()).toBe(404);
  expect((await request.get("/package.json")).status()).toBe(404);
});
