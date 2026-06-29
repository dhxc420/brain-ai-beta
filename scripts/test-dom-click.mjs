import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8787/?v=31", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__brainAI?.clusterKeys()?.length > 0);
await page.evaluate(() => document.getElementById("brainZoomReset")?.click());
await page.waitForTimeout(800);
const d0 = await page.evaluate(() => window.__brainAI.cameraDistance());
await page.evaluate(() => document.querySelector('[data-cluster="repo_world-runner"]')?.click());
await page.waitForTimeout(1000);
const d1 = await page.evaluate(() => window.__brainAI.cameraDistance());
const focused = await page.evaluate(() => window.__brainAI.focusedCluster());
console.log("DOM click:", d0?.toFixed(3), "->", d1?.toFixed(3), "focused:", focused);
await browser.close();
