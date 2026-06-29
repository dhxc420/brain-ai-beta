/**
 * E2E test: brain region buttons zoom like pin.
 * Run: node scripts/test-brain-zoom.mjs
 * Requires: npx playwright install chromium (once)
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8787";
const CACHE_BUST = "?v=32";

const results = [];

function log(msg) {
  console.log(msg);
}

async function waitForBrain(page) {
  await page.goto(`${BASE}/${CACHE_BUST}`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("canvas", { timeout: 15000 });
  await page.waitForFunction(
    () => window.__brainAI && window.__brainAI.clusterKeys().length > 0,
    { timeout: 20000 }
  );
  await page.waitForSelector(".cluster-strip-btn", { timeout: 10000 });
  await page.waitForTimeout(500);
}

async function getDist(page) {
  return page.evaluate(() => window.__brainAI.cameraDistance());
}

async function clickClusterByLabel(page, label) {
  const btn = page.locator(`[data-cluster].cluster-strip-btn`).filter({ hasText: label }).first();
  await btn.waitFor({ state: "visible", timeout: 5000 });
  await btn.click({ force: false });
}

async function testClusterZoom(page, label, clusterKey) {
  const initial = await getDist(page);
  const ok = await page.evaluate((key) => window.__brainAI.locateCluster(key), clusterKey);
  await page.waitForTimeout(1000);
  const final = await getDist(page);
  const focused = await page.evaluate(() => window.__brainAI.focusedCluster());
  const reduction = initial > 0 ? ((initial - final) / initial) * 100 : 0;
  const pass = ok && final < 2.0 && reduction > 30 && focused === clusterKey;
  results.push({
    scenario: `Cluster: ${label}`,
    pass,
    initial: initial?.toFixed(3),
    final: final?.toFixed(3),
    reduction: `${reduction.toFixed(1)}%`,
    focused,
    clusterKey,
  });
  return pass;
}

async function testPinZoom(page, neuronId) {
  const initial = await getDist(page);
  const ok = await page.evaluate((id) => window.__brainAI.pinNeuron(id), neuronId);
  await page.waitForTimeout(1000);
  const final = await getDist(page);
  const reduction = initial > 0 ? ((initial - final) / initial) * 100 : 0;
  const pass = ok && final < 2.0 && reduction > 30;
  results.push({
    scenario: `Pin: ${neuronId}`,
    pass,
    initial: initial?.toFixed(3),
    final: final?.toFixed(3),
    reduction: `${reduction.toFixed(1)}%`,
  });
  return pass;
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await waitForBrain(page);

    const keys = await page.evaluate(() => window.__brainAI.clusterKeys());
    log(`Cluster keys: ${keys.join(", ")}`);

    // Reset view before tests
    await page.evaluate(() => {
      window.__brainAI.focusCluster(null);
      document.getElementById("brainZoomReset")?.click();
    });
    await page.waitForTimeout(800);

    const worldRunnerKey = keys.find((k) => k.includes("world-runner") || k.includes("world_runner"));
    if (worldRunnerKey) {
      await testClusterZoom(page, "World Runner", worldRunnerKey);
    } else {
      results.push({ scenario: "Cluster: World Runner", pass: false, error: "key not found" });
    }

    // Reset between tests
    await page.evaluate(() => document.getElementById("brainZoomReset")?.click());
    await page.waitForTimeout(800);

    const cortexKey = keys.includes("cortex") ? "cortex" : null;
    if (cortexKey) {
      await testClusterZoom(page, "Memorias", cortexKey);
    } else {
      results.push({ scenario: "Cluster: Memorias", pass: false, error: "cortex key not found" });
    }

    // Pin comparison
    const memRes = await fetch(`${BASE}/api/memories`);
    const memData = await memRes.json();
    const firstMem = memData.memories?.[0];
    if (firstMem?.id) {
      await page.evaluate(() => document.getElementById("brainZoomReset")?.click());
      await page.waitForTimeout(800);
      await testPinZoom(page, `memory_${firstMem.id}`);
    }

    // UI click test for World Runner button
    if (worldRunnerKey) {
      await page.evaluate(() => document.getElementById("brainZoomReset")?.click());
      await page.waitForTimeout(800);
      const initial = await getDist(page);
      await clickClusterByLabel(page, "World Runner");
      await page.waitForTimeout(1000);
      const final = await getDist(page);
      const active = await page.locator(".cluster-strip-btn.active").filter({ hasText: "World Runner" }).count();
      const reduction = initial > 0 ? ((initial - final) / initial) * 100 : 0;
      const pass = final < 2.0 && reduction > 30 && active > 0;
      results.push({
        scenario: "UI click: World Runner",
        pass,
        initial: initial?.toFixed(3),
        final: final?.toFixed(3),
        reduction: `${reduction.toFixed(1)}%`,
        activeButton: active > 0,
      });
    }

    console.log("\n=== BRAIN ZOOM TEST RESULTS ===\n");
    let allPass = true;
    for (const r of results) {
      const status = r.pass ? "PASS" : "FAIL";
      if (!r.pass) allPass = false;
      console.log(`${status} | ${r.scenario}`);
      if (r.initial) console.log(`       dist: ${r.initial} → ${r.final} (${r.reduction} reduction)`);
      if (r.focused) console.log(`       focused: ${r.focused}`);
      if (r.error) console.log(`       error: ${r.error}`);
      if (r.activeButton !== undefined) console.log(`       active button: ${r.activeButton}`);
    }
    console.log(`\nOverall: ${allPass ? "ALL PASS" : "SOME FAILED"}\n`);
    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error("Test error:", err.message);
    process.exit(2);
  } finally {
    if (browser) await browser.close();
  }
}

main();
