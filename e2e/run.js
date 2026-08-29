/* End-to-end GUI pass against the running Docker stack on http://localhost */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost";
const ADMIN = { username: "admin", password: "change-me-too" };

const errors = [];

async function shot(page, name) {
  await page.screenshot({ path: `shots/${name}.png`, fullPage: false });
  console.log(`shot: ${name}`);
}

(async () => {
  fs.mkdirSync("shots", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  // ---------- 1. login ----------
  await page.goto(BASE + "/");
  await page.waitForURL("**/login", { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot(page, "01-login");
  await page.fill('input[autocomplete="username"]', ADMIN.username);
  await page.fill('input[autocomplete="current-password"]', ADMIN.password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await page.waitForURL(BASE + "/", { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot(page, "02-sprint-empty");

  // ---------- 2. areas ----------
  await page.click('a[href="/areas"]');
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "حوزه جدید" }).click();
  await page.getByPlaceholder("مثلا: دانشگاه").fill("دانشگاه");
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await page.waitForTimeout(600);
  // project inside the area
  await page.getByRole("button", { name: "پروژه" }).first().click();
  await page.getByPlaceholder("مثلا: درس ساختمان داده").fill("درس ساختمان داده");
  await page.getByRole("button", { name: "ساخت", exact: true }).click();
  await page.waitForTimeout(600);
  // second area (billable) for freelance
  await page.getByRole("button", { name: "حوزه جدید" }).click();
  await page.getByPlaceholder("مثلا: دانشگاه").fill("فریلنسری");
  // pick a green color swatch
  await page.locator('button[aria-label="#10b981"]').click();
  // enable billable toggle
  await page.locator('button[aria-pressed="false"]').last().click();
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await page.waitForTimeout(600);
  await shot(page, "03-areas");

  // ---------- 3. tasks ----------
  await page.click('a[href="/tasks"]');
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "تسک جدید" }).click();
  await page.getByPlaceholder("مثلا 1.5").fill("1.5");
  // title + scope (project) via the modal
  await page.locator(".z-10 .space-y-3 > label, .z-10 div").first(); // noop
  const titleInputs = page.locator(".z-10 input.input");
  await titleInputs.first().fill("خواندن فصل ۳");
  await page.locator(".z-10 select").selectOption({ label: "درس ساختمان داده" });
  await page.getByRole("button", { name: "ساخت تسک" }).click();
  await page.waitForTimeout(600);
  // quick standalone add
  await page.getByPlaceholder("افزودن سریع تسک مستقل… (Enter)").fill("پرداخت قبض اینترنت");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await shot(page, "04-all-tasks");

  // ---------- 4. sprint planning ----------
  await page.click('a[href="/"]');
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "افزودن تسک" }).click();
  await page.locator('label', { hasText: "خواندن فصل ۳" }).first().locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "ادامه (1)" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "افزودن", exact: true }).click();
  await page.waitForTimeout(800);
  await shot(page, "05-sprint-planned");

  // drag the card from باز to در حال انجام
  const card = await page.locator("div.cursor-pointer", { hasText: "خواندن فصل ۳" }).first().boundingBox();
  const target = await page.locator('div:has(> div:has-text("در حال انجام"))').filter({ hasText: "در حال انجام" }).first().boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await shot(page, "06-sprint-inprogress");

  // ---------- 5. timesheet: drag-create an entry ----------
  await page.click('a[href="/timesheet"]');
  await page.waitForTimeout(1200);
  await shot(page, "07-timesheet-week");

  const rect = await page.evaluate(() => {
    const cols = [...document.querySelectorAll("main div.grid.h-full > div.relative")];
    const c = cols[2 + 1]; // gutter first, then day index 2 (دوشنبه)
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  });
  const x = rect.left + rect.width / 2;
  const yFrom = rect.top + 9.1 * 48;
  const yTo = rect.top + 10.6 * 48;
  await page.mouse.move(x, yFrom);
  await page.mouse.down();
  await page.mouse.move(x, yTo, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await shot(page, "08-timesheet-create-modal");
  // pick the task in the modal
  await page.locator("button", { hasText: "خواندن فصل ۳" }).first().click();
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await page.waitForTimeout(900);
  await shot(page, "09-timesheet-logged");

  // ---------- 6. close sprint ----------
  await page.click('a[href="/"]');
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "بستن اسپرینت" }).click();
  await page.waitForTimeout(500);
  await shot(page, "10-close-sprint-modal");
  await page.getByRole("button", { name: "بستن اسپرینت و ساخت گزارش" }).click();
  await page.waitForTimeout(400);
  await page.locator(".btn-danger", { hasText: "بستن اسپرینت" }).click();
  await page.waitForURL("**/reports?sprint=*", { timeout: 15000 });
  await page.waitForTimeout(1000);
  await shot(page, "11-weekly-report");

  // ---------- 7. monthly report ----------
  await page.getByRole("button", { name: "گزارش ماهانه" }).click();
  await page.waitForTimeout(1000);
  await shot(page, "12-monthly-report");

  // ---------- 8. dark mode ----------
  await page.locator("aside button").first().click();
  await page.waitForTimeout(500);
  await shot(page, "13-dark-mode");

  // ---------- 9. mobile ----------
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
  await mobile.goto(BASE + "/login");
  await mobile.waitForTimeout(600);
  await mobile.fill('input[autocomplete="username"]', ADMIN.username);
  await mobile.fill('input[autocomplete="current-password"]', ADMIN.password);
  await mobile.getByRole("button", { name: "ورود", exact: true }).click();
  await mobile.waitForURL(BASE + "/");
  await mobile.waitForTimeout(1000);
  await shot(mobile, "14-mobile-sprint");
  await mobile.click('a[href="/timesheet"]');
  await mobile.waitForTimeout(1200);
  await shot(mobile, "15-mobile-timesheet");

  await browser.close();
  console.log("\n=== PAGE ERRORS ===");
  console.log(errors.length ? errors.join("\n") : "(none)");
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  console.log(errors.join("\n"));
  process.exit(1);
});
