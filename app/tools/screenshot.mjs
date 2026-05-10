// Tarayıcıda mock veriyle ekran görüntüsü üretir.
// Çalıştırmak için: app/ içinde `python3 -m http.server 8765` ardından
// `node tools/screenshot.mjs`. Çıktılar app/shots/ altına yazılır.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const PORT = process.env.PORT || 8765;
const URL  = `http://127.0.0.1:${PORT}/preview.html`;
const OUT  = new URL("../shots/", import.meta.url).pathname;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await ctx.newPage();

const wait = async () => {
  await page.waitForFunction(() =>
    document.querySelectorAll(".page .card, .page .err").length > 0 ||
    document.querySelectorAll(".page > .page-head").length > 0
  , { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(450);
};

const shoot = async (file) => {
  const path = OUT + file;
  await page.screenshot({ path, fullPage: false });
  console.log("wrote", path);
};

const scrollPage = async (px) => {
  await page.evaluate((y) => {
    document.querySelector(".page").scrollTo({ top: y, behavior: "instant" });
  }, px);
  await page.waitForTimeout(200);
};

await page.goto(URL + "#sistem", { waitUntil: "networkidle" });
await wait();
await shoot("sistem-1.png");
await scrollPage(720);
await shoot("sistem-2.png");

await page.goto(URL + "#donanim", { waitUntil: "networkidle" });
await wait();
await shoot("donanim-1.png");
await scrollPage(720);
await shoot("donanim-2.png");

await page.goto(URL + "#hakkinda", { waitUntil: "networkidle" });
await wait();
await shoot("hakkinda-1.png");

await browser.close();
