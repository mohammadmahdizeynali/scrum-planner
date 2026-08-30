/* E2E GUI pass for the admin user-management flow against the dev servers
   (vite :5173 → uvicorn :8000 on the scratch DB). */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:5173";
const ADMIN = { username: "admin", password: "admin-pass-123" };
const USER = { username: "reza", password: "reza-pass-123", name: "رضا" };

const errors = [];

async function shot(page, name) {
  await page.screenshot({ path: `shots/${name}.png`, fullPage: false });
  console.log(`shot: ${name}`);
}

async function login(page, username, password) {
  await page.goto(BASE + "/");
  await page.waitForURL("**/login", { timeout: 15000 });
  await page.fill('input[autocomplete="username"]', username);
  await page.fill('input[autocomplete="current-password"]', password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await page.waitForURL(BASE + "/", { timeout: 15000 });
  await page.waitForTimeout(900);
}

async function logout(page) {
  await page.locator('button[title="خروج"]').click();
  await page.waitForURL("**/login", { timeout: 15000 });
  await page.waitForTimeout(500);
}

(async () => {
  fs.mkdirSync("shots", { recursive: true });
  const browser = await chromium.launch();

  // ---------- 0. cleanup leftovers from previous runs ----------
  {
    const ctx = await browser.newContext();
    await ctx.request.post(BASE + "/api/v1/auth/login", {
      data: { username: ADMIN.username, password: ADMIN.password },
    });
    const users = await (await ctx.request.get(BASE + "/api/v1/users")).json();
    for (const u of users) {
      if (u.username === ADMIN.username) continue;
      const del = await ctx.request.delete(BASE + `/api/v1/users/${u.id}`);
      console.log(`cleanup: ${u.username} -> ${del.status()}`);
    }
    await ctx.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // 401/403 resource logs are expected here (revoked sessions, blocked member requests)
    if (m.type() === "error" && !/40[13]/.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  // ---------- 1. admin login → admin nav visible ----------
  await login(page, ADMIN.username, ADMIN.password);
  const adminNav = page.locator('aside a[href="/admin"]');
  if ((await adminNav.count()) !== 1) throw new Error("admin nav missing for admin");
  await adminNav.click();
  await page.waitForURL("**/admin", { timeout: 10000 });
  await page.waitForTimeout(800);
  await shot(page, "a01-admin-list");

  // ---------- 2. create user ----------
  await page.getByRole("button", { name: "کاربر جدید" }).click();
  await page.waitForTimeout(400);
  await shot(page, "a02-create-modal");
  await page.locator('.z-10 input[dir="ltr"]').first().fill(USER.username);
  await page.getByPlaceholder("سارا").fill(USER.name);
  await page.locator('.z-10 input[dir="ltr"]').nth(1).fill(USER.password);
  await page.getByRole("button", { name: "ایجاد کاربر" }).click();
  await page.waitForTimeout(900);
  if (!(await page.getByText(USER.username, { exact: true }).isVisible())) {
    throw new Error("created user not visible in list");
  }
  await shot(page, "a03-user-created");

  // ---------- 3. login as the new user → no admin nav, empty workspace ----------
  await logout(page);
  await login(page, USER.username, USER.password);
  if ((await page.locator('a[href="/admin"]').count()) !== 0) {
    throw new Error("member must NOT see the admin nav");
  }
  await shot(page, "a04-member-sprint-empty");
  // their own area
  await page.click('a[href="/areas"]');
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "مسیر جدید" }).click();
  await page.getByPlaceholder("مثلا: دانشگاه").fill("فضای شخصی رضا");
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await page.waitForTimeout(700);
  await shot(page, "a05-member-own-area");

  // ---------- 4. admin deactivates reza ----------
  await logout(page);
  await login(page, ADMIN.username, ADMIN.password);
  await page.locator('aside a[href="/admin"]').click();
  await page.waitForURL("**/admin", { timeout: 10000 });
  await page.waitForTimeout(800);
  // open edit dialog on reza's row
  await page.locator('div.card > div', { hasText: USER.username }).first().getByTitle("ویرایش").click();
  await page.waitForTimeout(400);
  await shot(page, "a06-edit-modal");
  await page.locator(".z-10 button", { hasText: "فعال" }).first().click(); // toggle off
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await page.waitForTimeout(900);
  if (!(await page.getByText("غیرفعال", { exact: true }).first().isVisible())) {
    throw new Error("deactivated badge missing");
  }
  await shot(page, "a07-deactivated");

  // ---------- 5. deactivated login refused ----------
  await logout(page);
  await page.fill('input[autocomplete="username"]', USER.username);
  await page.fill('input[autocomplete="current-password"]', USER.password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await page.waitForTimeout(900);
  const refused = await page.getByText("غیرفعال شده است").isVisible();
  if (!refused) throw new Error("deactivated login not refused with message");
  await shot(page, "a08-login-refused");

  // ---------- 6. admin deletes reza ----------
  await login(page, ADMIN.username, ADMIN.password);
  await page.locator('aside a[href="/admin"]').click();
  await page.waitForURL("**/admin", { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.locator('div.card > div', { hasText: USER.username }).first().getByTitle("حذف کاربر").click();
  await page.waitForTimeout(400);
  await shot(page, "a09-delete-confirm");
  await page.locator(".z-10 button.btn-danger").click();
  await page.waitForTimeout(900);
  if (await page.getByText(USER.username, { exact: true }).isVisible()) {
    throw new Error("deleted user still listed");
  }
  await shot(page, "a10-deleted");

  await browser.close();
  if (errors.length) {
    console.log("BROWSER ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("E2E ADMIN FLOW: OK");
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
