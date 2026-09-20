import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const chrome =
  "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});

async function shot(html, width, height, out) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: out, type: "png", omitBackground: false });
  await page.close();
}

await shot("/workspace/.grok/og-card.html", 1200, 630, "/workspace/.grok/og-raw.png");
await shot("/workspace/.grok/x-banner.html", 1200, 264, "/workspace/.grok/x-banner-raw.png");
await browser.close();
console.log("screenshots written");
