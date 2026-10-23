import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reporting as policy } from "../tests/reporting-fixtures.mjs";

/** This runs only in the account harness's disposable database, with no outgoing messages. */
export async function runReportingChecks({
  db,
  browser,
  APP,
  ADMIN,
  page,
  platformPage,
  merchantPage,
  merchant,
  team,
  test,
  axe,
  artifacts,
  stamp,
}) {
  const prefix = `report-${stamp}`;
  const day = policy.beijingDay(new Date(Date.now() - 86400000));
  const at = new Date(`${day}T00:00:00+08:00`);
  const before = new Date(at.getTime() - 1);
  const privateText = `never-export-private-${stamp}`;
  const foreign = await db.tenant.create({
    data: {
      name: `${prefix}-foreign`,
      slug: `${prefix}-foreign`,
      sites: {
        create: {
          name: `${prefix}-foreign-site`,
          slug: `${prefix}-foreign-site`,
        },
      },
    },
    include: { sites: true },
  });
  for (const [site, name] of [
    [team.sites[0], "own"],
    [foreign.sites[0], "foreign"],
  ]) {
    const visitor = await db.visitor.create({
      data: {
        siteId: site.id,
        localKey: `${prefix}-${name}`,
        email: `${prefix}-${name}@test.local`,
        name: `访客-${name}`,
        profileNote: privateText,
      },
    });
    await db.conversation.create({
      data: {
        siteId: site.id,
        visitorId: visitor.id,
        subject: '=HYPERLINK("https://example.invalid")',
        note: privateText,
        lastMessagePreview: privateText,
        createdAt: at,
        status: "CLOSED",
        rating: 5,
      },
    });
    if (name === "own")
      await db.conversation.create({
        data: {
          siteId: site.id,
          visitorId: visitor.id,
          subject: "outside-range",
          createdAt: before,
        },
      });
  }
  const quota = {
    priceCents: 1,
    durationDays: 30,
    maxAgents: 3,
    maxSites: 2,
    monthlyConversations: 100,
    storageMB: 128,
  };
  const plan = await db.subscriptionPlan.create({
    data: { ...quota, name: `${prefix}-plan` },
  });
  for (const [tenant, status, suffix] of [
    [team, "CONFIRMED", "paid"],
    [team, "PENDING", "expired"],
    [foreign, "CONFIRMED", "foreign"],
  ]) {
    await db.subscriptionOrder.create({
      data: {
        ...quota,
        tenantId: tenant.id,
        planId: plan.id,
        planName: `${prefix}-snapshot`,
        orderNo: `${prefix}-${suffix}`,
        status,
        clientRequestId: `${prefix}-${suffix}`,
        requestedByName: "验收",
        createdAt: at,
        validUntil: at,
        merchantNote: privateText,
        reviewNote: privateText,
        paymentReference: privateText + suffix,
        paymentNote: privateText,
      },
    });
  }
  await db.auditLog.createMany({
    data: [
      ...Array.from({ length: 26 }, (_, n) => ({
        id: `${prefix}-audit-${String(n).padStart(2, "0")}`,
        tenantId: team.id,
        actorName: prefix,
        action: "site.update",
        targetType: "Site",
        targetId: team.sites[0].id,
        createdAt: at,
        meta: { privateText },
      })),
      {
        id: `${prefix}-foreign-audit`,
        tenantId: foreign.id,
        actorName: `${prefix}-foreign`,
        action: "site.update",
        createdAt: at,
        meta: { privateText },
      },
      {
        id: `${prefix}-before-audit`,
        tenantId: team.id,
        actorName: prefix,
        action: "site.update",
        createdAt: before,
      },
    ],
  });
  const filters = { from: day, to: day, query: prefix };
  const post = (p, data, origin = APP) =>
    p.request.post(`${APP}/api/admin/exports`, {
      headers: { Origin: origin },
      data: { ...filters, ...data },
    });
  const clean = (text) => {
    assert.equal(text.includes(privateText), false);
    assert.equal(text.includes(`${prefix}-foreign`), false);
  };
  let downloaded;
  await test("merchant downloads an actual CSV with Beijing day boundaries, formula neutralization and no private notes", async () => {
    await merchantPage.goto(
      `${APP}${ADMIN}/exports?${new URLSearchParams(filters)}`,
    );
    await merchantPage
      .getByRole("heading", { name: "数据导出", exact: true })
      .waitFor();
    assert.equal(
      await merchantPage
        .locator(`select[name="siteId"] option[value="${foreign.sites[0].id}"]`)
        .count(),
      0,
    );
    const download = merchantPage.waitForEvent("download");
    await merchantPage
      .getByRole("button", { name: "下载 CSV", exact: true })
      .click();
    downloaded = await download;
    assert.match(
      downloaded.suggestedFilename(),
      /^beesupport-conversations-.*\.csv$/,
    );
    const bytes = await readFile(await downloaded.path());
    assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
    const csv = bytes.toString("utf8");
    clean(csv);
    assert.ok(csv.includes("'="));
    assert.ok(csv.includes(`${day} 00:00:00`));
    assert.equal(csv.includes("outside-range"), false);
    await merchantPage
      .getByRole("status")
      .filter({ hasText: "已生成 1 条记录" })
      .waitFor();
    assert.equal(
      await db.auditLog.count({
        where: { tenantId: team.id, action: "data.export" },
      }),
      1,
    );
    await axe(merchantPage);
  });
  await test("order exports use immutable cent amounts, effective expiry and merchant scope", async () => {
    const result = await post(merchantPage, { kind: "orders" });
    assert.equal(result.status(), 200);
    assert.equal(result.headers()["x-export-rows"], "2");
    assert.equal(result.headers()["cache-control"], "no-store");
    const csv = await result.text();
    clean(csv);
    assert.ok(csv.includes('"0.01"'));
    assert.ok(csv.includes("已过期"));
    assert.ok(csv.includes(`${prefix}-snapshot`));
    const expired = await post(merchantPage, {
      kind: "orders",
      status: "EXPIRED",
    });
    assert.equal(expired.headers()["x-export-rows"], "1");
    assert.ok((await expired.text()).includes(`${prefix}-expired`));
    const pending = await post(platformPage, {
      kind: "orders",
      status: "PENDING",
    });
    assert.equal(pending.headers()["x-export-rows"], "0");
  });
  await test("audit search and pagination retain filters; exporting the same selection excludes raw metadata and other tenants", async () => {
    const qs = new URLSearchParams({ ...filters, action: "site.update" });
    await merchantPage.goto(`${APP}${ADMIN}/audit?${qs}`);
    await merchantPage
      .getByText("共 26 条 · 第 1 / 2 页", { exact: true })
      .waitFor();
    assert.equal(await merchantPage.locator("tbody tr").count(), 20);
    await merchantPage
      .getByRole("link", { name: "下一页", exact: true })
      .click();
    await merchantPage
      .getByText("共 26 条 · 第 2 / 2 页", { exact: true })
      .waitFor();
    assert.equal(await merchantPage.locator("tbody tr").count(), 6);
    const url = new URL(merchantPage.url());
    for (const [key, value] of qs)
      assert.equal(url.searchParams.get(key), value);
    clean(await merchantPage.locator("main").innerText());
    await merchantPage
      .getByRole("link", { name: "导出当前筛选", exact: true })
      .click();
    await merchantPage
      .getByRole("heading", { name: "数据导出", exact: true })
      .waitFor();
    assert.equal(
      await merchantPage.getByLabel("导出内容", { exact: true }).inputValue(),
      "audit",
    );
    assert.equal(
      await merchantPage.getByLabel("操作类型", { exact: true }).inputValue(),
      "site.update",
    );
    const wait = merchantPage.waitForEvent("download");
    await merchantPage
      .getByRole("button", { name: "下载 CSV", exact: true })
      .click();
    const audit = await wait;
    clean(await readFile(await audit.path(), "utf8"));
    await merchantPage
      .getByRole("status")
      .filter({ hasText: "已生成 26 条记录" })
      .waitFor();
    const platformExport = await post(platformPage, {
      kind: "audit",
      action: "site.update",
    });
    assert.equal(platformExport.headers()["x-export-rows"], "27");
    assert.ok((await platformExport.text()).includes(`${prefix}-foreign`));
  });
  await test("export API rejects forged tenant/site scopes, foreign origins, unauthenticated users and ordinary agents", async () => {
    assert.equal(
      (
        await post(merchantPage, {
          kind: "conversations",
          siteId: foreign.sites[0].id,
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await post(merchantPage, { kind: "orders", tenantId: foreign.id })
      ).status(),
      422,
    );
    assert.equal(
      (
        await post(merchantPage, { kind: "orders" }, "https://evil.invalid")
      ).status(),
      403,
    );
    assert.equal((await post(page, { kind: "orders" })).status(), 401);
    assert.equal(
      (
        await merchantPage.request.post(`${APP}/api/admin/exports`, {
          data: { ...filters, kind: "orders" },
        })
      ).status(),
      403,
    );
    const agent = await db.user.create({
      data: {
        tenantId: team.id,
        email: `${prefix}-agent@test.local`,
        name: "普通客服",
        role: "AGENT",
        passwordHash: merchant.passwordHash,
      },
    });
    const context = await browser.newContext();
    try {
      const login = await context.request.post(`${APP}/api/auth/login`, {
        data: { email: agent.email, password: `Test-${stamp}!` },
      });
      assert.equal(login.status(), 200);
      const denied = await context.request.post(`${APP}/api/admin/exports`, {
        headers: { Origin: APP },
        data: { ...filters, kind: "orders" },
      });
      assert.equal(denied.status(), 403);
    } finally {
      await context.close();
    }
  });
  await test("over-limit exports and invalid date ranges return actionable errors without success audits", async () => {
    await db.auditLog.createMany({
      data: Array.from({ length: 5001 }, () => ({
        tenantId: team.id,
        actorName: prefix,
        action: "limit.test",
        createdAt: at,
      })),
    });
    const count = await db.auditLog.count({
      where: { tenantId: team.id, action: "data.export" },
    });
    const response = await post(merchantPage, {
      kind: "audit",
      action: "limit.test",
    });
    assert.equal(response.status(), 413);
    assert.match((await response.json()).error, /5000/);
    assert.equal(
      (
        await post(merchantPage, {
          kind: "orders",
          from: "2026-01-01",
          to: "2026-06-01",
        })
      ).status(),
      400,
    );
    assert.equal(
      await db.auditLog.count({
        where: { tenantId: team.id, action: "data.export" },
      }),
      count,
    );
    await merchantPage.goto(
      `${APP}${ADMIN}/audit?from=invalid&action=%3Cscript%3E`,
    );
    await merchantPage
      .getByRole("alert")
      .filter({ hasText: "筛选条件无效" })
      .waitFor();
    await axe(merchantPage);
  });
  await test("export and filtered audit pages work on mobile in light and dark modes", async () => {
    await merchantPage.setViewportSize({ width: 375, height: 812 });
    for (const theme of ["light", "dark"]) {
      await merchantPage.evaluate((value) => {
        localStorage.setItem("theme", value);
        document.documentElement.classList.toggle("dark", value === "dark");
      }, theme);
      for (const path of ["exports", "audit"]) {
        await merchantPage.goto(
          `${APP}${ADMIN}/${path}?${new URLSearchParams({ ...filters, kind: "audit", action: "site.update" })}`,
        );
        await merchantPage
          .getByRole("heading", {
            name: path === "exports" ? "数据导出" : "操作日志",
            exact: true,
          })
          .waitFor();
        await axe(merchantPage);
        await merchantPage.screenshot({
          path: `${artifacts}/reporting-${path}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  });
}
