/**
 * Coverflow smoke check.  `node qa-artifacts/verify-coverflow.js`
 *
 * Asserts the parts that break silently: the ring-fold transform math, the
 * five-section grouping, keyboard travel, click-to-open, and filtering.
 * Requires playwright (already on this machine: `npx playwright install chromium`).
 */
const { chromium } = require("playwright");
const path = require("path");
const assert = require("assert");

const FILE = "file:///" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");

const EXPECTED = [
  ["work-finance",  6],
  ["work-systems",  7],
  ["work-programs", 5],
  ["work-clients",  4],
  ["work-craft",    1],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(FILE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const sections = await page.$$eval(".work-section", (nodes) =>
    nodes.map((s) => [s.id, s.querySelectorAll(".cf-card").length]));
  assert.deepStrictEqual(sections, EXPECTED, "section grouping / card counts drifted");

  // Every card must be transformed and stacked; the centre one fully opaque.
  const rake = await page.$$eval("#work-finance .cf-card", (cards) => cards.map((c) => {
    const s = getComputedStyle(c);
    return { t: s.transform !== "none", op: +(+s.opacity).toFixed(2), z: +s.zIndex, active: c.classList.contains("is-active") };
  }));
  assert.ok(rake.every((c) => c.t), "cards are not being transformed — paint() never ran");
  assert.strictEqual(rake.filter((c) => c.active).length, 1, "exactly one card should be centred");
  assert.strictEqual(rake.find((c) => c.active).op, 1, "centre card must be fully opaque");
  assert.ok(Math.max(...rake.map((c) => c.z)) === 100, "centre card must sit on top");

  // Arrow key advances the rail and repaints the caption.
  await page.locator("#work-finance .cf-frame").focus();
  const before = await page.locator("#work-finance .cf-cap-main h4").textContent();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  const after = await page.locator("#work-finance .cf-cap-main h4").textContent();
  assert.notStrictEqual(before, after, "ArrowRight did not advance the carousel");

  // Clicking the centre card opens that project's modal. Regression guard:
  // setPointerCapture retargets pointerup to the frame, so the hit card has to
  // be recorded at pointerdown or this silently does nothing.
  await page.locator("#work-finance .cf-card.is-active").click();
  await page.waitForTimeout(800);
  const modalTitle = await page.evaluate(() => {
    const b = document.getElementById("project-modal-backdrop");
    return b.hidden ? null : document.getElementById("project-modal-title").textContent.trim();
  });
  assert.strictEqual(modalTitle, after.trim(), "card click did not open the matching modal");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // Filtering collapses to the one section that still has matches.
  await page.locator('.filter-button[data-filter="ai"]').click();
  await page.waitForTimeout(900);
  const filtered = await page.$$eval(".work-section", (n) => n.map((s) => s.id));
  assert.deepStrictEqual(filtered, ["work-systems"], "filter did not collapse to one section");

  assert.deepStrictEqual(errors, [], "page logged errors");

  await browser.close();
  console.log("coverflow OK — %d sections, %d cards, no console errors",
    sections.length, sections.reduce((a, [, n]) => a + n, 0));
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
