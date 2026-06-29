import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8787/?v=32", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__brainAI?.clusterKeys()?.length > 0);

const info = await page.evaluate(() => {
  const btn = document.querySelector('[data-cluster="repo_world-runner"]');
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  return {
    btnTag: btn?.tagName,
    btnClass: btn?.className,
    topTag: top?.tagName,
    topClass: top?.className,
    topId: top?.id,
    same: top === btn || btn?.contains(top),
    cx,
    cy,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
