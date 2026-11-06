const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const base = process.env.APP_URL || "http://localhost:4173/";
const qaDir = path.resolve(__dirname, "../qa");
fs.mkdirSync(qaDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let browser;
(async () => {
  const launchOptions = { headless: true };
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) launchOptions.executablePath = chromePath;
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(7000);
  const step = (name) => console.log(`PASS ${name}`);
  const consoleProblems = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) consoleProblems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText || "failed"}`));

  await page.goto(base, { waitUntil: "networkidle" });
  assert(await page.title() === "中文起飞台 · Mandarin Field Lab", "Unexpected page title");
  assert(await page.locator(".product-row").count() === 10, "Home must list ten products");
  await page.screenshot({ path: path.join(qaDir, "desktop-home.png"), fullPage: true });
  step("home");

  await page.goto(`${base}#flow`);
  assert(await page.locator("#chunk-map").isHidden(), "Flow answer map must start hidden");
  await page.locator("#reveal-flow").click();
  assert(await page.locator("#chunk-map").isVisible(), "Flow chunk map did not reveal");
  assert(await page.locator(".chunk-pinyin").first().isHidden(), "Flow pinyin should remain hidden on first reveal");
  await page.locator("#dictation").fill("你最近工作忙不忙？");
  await page.locator("#check-flow").click();
  await page.getByText("Exact match").waitFor();
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  assert(await page.locator("h1").filter({ hasText: "Flow Decoder" }).isVisible(), "Skip link changed the active product");
  step("flow");

  await page.goto(`${base}#tone`);
  await page.locator('[data-tone-choice="a"]').click();
  await page.getByText(/Yes: mǎi/).waitFor();
  step("tone");

  await page.goto(`${base}#talk`);
  await page.waitForTimeout(1400);
  assert(await page.locator("h1").filter({ hasText: "Talk Rehearsal" }).isVisible(), "Tone advance timer stomped the new route");
  await page.locator('[data-talk-score="done"]').click();
  step("talk");

  await page.goto(`${base}#fixbook`);
  await page.locator("#fix-original").fill("我很喜欢喝咖啡很多");
  await page.locator("#fix-corrected").fill("我很喜欢喝咖啡");
  await page.locator("#fix-reason").fill("   ");
  await page.locator("#fix-form").evaluate((form) => form.requestSubmit());
  await page.getByText("1 corrections kept").waitFor();
  assert(await page.locator("#fix-reason").inputValue() === "   ", "Rejected correction input was lost");
  await page.locator("#fix-reason").fill("很多 is redundant here.");
  await page.locator("#fix-form").evaluate((form) => form.requestSubmit());
  await page.getByText("2 corrections kept").waitFor();
  step("fixbook");

  await page.goto(`${base}#sentence`);
  for (const chunk of ["我", "去年", "坐火车", "去了", "北京"]) {
    await page.locator(`[data-chunk="${chunk}"]`).click();
  }
  await page.locator("#check-sentence").click();
  await page.getByText("Correct: 我去年坐火车去了北京").waitFor();
  await page.evaluate(() => { location.hash = "home"; });
  await page.locator(".product-row").first().waitFor();
  await page.evaluate(() => { location.hash = "sentence"; });
  await page.locator("#sentence-bank").waitFor();
  await page.waitForTimeout(1900);
  await page.getByRole("heading", { name: "I went to Beijing by train last year.", exact: true }).waitFor();
  step("sentence");

  await page.goto(`${base}#hanzi`);
  const char = (await page.locator(".panel.accent .hanzi-display").textContent()).trim();
  const meanings = { "晴": "sunny", "请": "please", "喝": "drink", "休": "rest" };
  assert(meanings[char], `Unknown Hanzi sample: ${char}`);
  await page.locator("#hanzi-meaning").fill(meanings[char].slice(0, 1));
  await page.locator("#check-hanzi").click();
  await page.locator("#hanzi-result.bad").waitFor();
  const falseMeanings = { "晴": "unsunny", "请": "displeased", "喝": "drinking", "休": "forest" };
  await page.locator("#hanzi-meaning").fill(falseMeanings[char]);
  await page.locator("#check-hanzi").click();
  await page.locator("#hanzi-result.bad").waitFor();
  await page.locator("#hanzi-meaning").fill(meanings[char]);
  await page.locator("#check-hanzi").click();
  await page.locator("#hanzi-result.ok").waitFor();
  step("hanzi");

  await page.goto(`${base}#bridge`);
  await page.locator("#bridge-input").fill("This is not Chinese.");
  await page.locator("#analyze-bridge").click();
  assert(await page.locator(".sentence-line").count() === 0, "Content Bridge accepted non-Chinese text");
  await page.locator("#bridge-input").fill("我今天坐地铁上班。路上听了中文播客。");
  await page.locator("#analyze-bridge").click();
  assert(await page.locator(".sentence-line").count() >= 2, "Content Bridge did not segment text");
  step("bridge");

  await page.goto(`${base}#cards`);
  await page.locator("#card-sentence").fill("我今天需要认真复习中文。");
  await page.locator("#card-target").fill("   ");
  await page.locator("#card-meaning").fill("review");
  const cardCount = await page.evaluate(() => JSON.parse(localStorage.getItem("mandarin-field-lab-v1")).cards.length);
  await page.locator("#card-form").evaluate((form) => form.requestSubmit());
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem("mandarin-field-lab-v1")).cards.length) === cardCount, "Whitespace target created an invalid card");
  await page.locator("#card-target").fill("复习");
  await page.locator("#card-meaning").fill("review");
  await page.locator("#card-form").evaluate((form) => form.requestSubmit());
  await page.getByText(/Due now/).waitFor();
  for (let i = 0; i < 3 && await page.locator('[data-card-rating="good"]').count(); i += 1) {
    await page.locator('[data-card-rating="good"]').click();
  }
  await page.getByText("Nothing is due.").waitFor();
  step("cards");

  await page.goto(`${base}#next`);
  await page.locator("#plan-context").fill("Friday team lunch");
  await page.locator("#make-plan").click();
  await page.getByText("Friday team lunch").waitFor();
  step("next");

  await page.goto(`${base}#proof`);
  await page.locator("#proof-action").fill("   ");
  await page.locator("#proof-context").fill("Practice test");
  await page.locator("#proof-form").evaluate((form) => form.requestSubmit());
  await page.getByText("Ability ledger · 0").waitFor();
  await page.locator("#proof-action").fill("I understood a short voice message without opening the transcript.");
  await page.locator("#proof-context").fill("Practice test");
  await page.locator("#proof-form").evaluate((form) => form.requestSubmit());
  await page.getByText("Ability ledger · 1").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Ability ledger · 1").waitFor();
  step("proof");

  const completed = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("mandarin-field-lab-v1"));
    return Object.values(data.completed).filter(Boolean).length;
  });
  assert(completed === 10, `Expected 10 completed products, got ${completed}`);

  await page.goto(base);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(qaDir, "mobile-home.png"), fullPage: true });
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  assert(bodyWidth <= 390, `Mobile horizontal overflow: ${bodyWidth}px`);

  await page.goto(`${base}#flow`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(qaDir, "mobile-flow.png"), fullPage: true });
  const flowWidth = await page.evaluate(() => document.body.scrollWidth);
  assert(flowWidth <= 390, `Mobile Flow horizontal overflow: ${flowWidth}px`);

  assert(consoleProblems.length === 0, `Console problems:\n${consoleProblems.join("\n")}`);
  assert(failedRequests.length === 0, `Failed requests:\n${failedRequests.join("\n")}`);

  const result = {
    status: "PASS",
    routes: 11,
    productsCompleted: completed,
    consoleProblems,
    failedRequests,
    desktopViewport: "1440x1000",
    mobileViewport: "390x844",
    screenshots: ["qa/desktop-home.png", "qa/mobile-home.png", "qa/mobile-flow.png"]
  };
  fs.writeFileSync(path.join(qaDir, "smoke-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
})().finally(async () => {
  if (browser) await browser.close();
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
