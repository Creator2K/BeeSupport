import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { accountLinks as links } from "../tests/account-fixtures.mjs";

/** Runs only inside the account harness's disposable database and local SMTP sink. */
export async function runDeliveryChecks({
  db,
  APP,
  ADMIN,
  page,
  platformPage,
  merchantPage,
  platform,
  team,
  test,
  until,
  axe,
  inbox,
  smtp,
  artifacts,
  stamp,
}) {
  const prefix = `delivery-browser-${stamp}`,
    address = `${prefix}@test.local`,
    privateText = `private-notification-${stamp}`;
  const mail = { to: address, subject: "隔离投递探针", text: privateText };
  let failed, capturedAction;
  platformPage.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      request.url().includes("/deliveries")
    )
      capturedAction = {
        action: request.headers()["next-action"],
        body: request.postData(),
        type: request.headers()["content-type"],
      };
  });
  await merchantPage.keyboard.press("Escape");
  await platformPage.setViewportSize({ width: 1280, height: 900 });
  const url = (extra = {}) =>
    `${APP}${ADMIN}/deliveries?${new URLSearchParams({ search: prefix, ...extra })}`;
  const record = (id) =>
    platformPage.getByRole("article", { name: `通知任务 ${id}`, exact: true });
  async function openRetry(id) {
    await record(id)
      .getByRole("button", { name: "重试任务", exact: true })
      .click();
    await platformPage.getByRole("alertdialog").waitFor();
  }

  await test("delivery monitoring shows actual SMTP failures without exposing payloads or raw errors", async () => {
    await db.setting.update({
      where: { key: "smtp" },
      data: {
        value: {
          host: "127.0.0.1",
          port: 1,
          secure: false,
          from: "noreply@test.local",
        },
      },
    });
    failed = await db.notificationJob.create({
      data: {
        id: `${prefix}-failed`,
        kind: "MAIL",
        payload: mail,
        attempts: 4,
        totalAttempts: 4,
      },
    });
    await until(
      async () =>
        (
          await db.notificationJob.findUniqueOrThrow({
            where: { id: failed.id },
          })
        ).status === "FAILED",
      "final SMTP failure",
    );
    failed = await db.notificationJob.findUniqueOrThrow({
      where: { id: failed.id },
    });
    assert.equal(failed.attempts, 5);
    assert.equal(failed.totalAttempts, 5);
    assert.equal(
      inbox.some((m) => m.recipients.includes(address)),
      false,
    );
    await platformPage.goto(url());
    await record(failed.id).waitFor();
    await record(failed.id).getByText("失败", { exact: true }).waitFor();
    const body = await platformPage.locator("body").innerText();
    for (const value of [privateText, address, "ECONNREFUSED", "127.0.0.1:1"])
      assert.equal(body.includes(value), false);
    await axe(platformPage);
  });

  await test("manual retry recovers SMTP delivery and retains cumulative attempts and one audit entry", async () => {
    await db.setting.update({
      where: { key: "smtp" },
      data: {
        value: {
          host: "127.0.0.1",
          port: smtp.address().port,
          secure: false,
          from: "noreply@test.local",
        },
      },
    });
    await openRetry(failed.id);
    await platformPage
      .getByText("收件方可能收到重复通知", { exact: false })
      .waitFor();
    await platformPage
      .getByRole("button", { name: "确认重新排队", exact: true })
      .click();
    await until(
      async () =>
        (
          await db.notificationJob.findUniqueOrThrow({
            where: { id: failed.id },
          })
        ).outcome === "SUCCESS",
      "retried mail delivered",
    );
    const delivered = await db.notificationJob.findUniqueOrThrow({
      where: { id: failed.id },
    });
    assert.equal(delivered.totalAttempts, 6);
    assert.equal(delivered.attempts, 1);
    assert.equal(delivered.manualRetries, 1);
    assert.equal(
      await db.auditLog.count({
        where: { targetId: failed.id, action: "notification.retry" },
      }),
      1,
    );
    assert.equal(inbox.filter((m) => m.recipients.includes(address)).length, 1);
    await platformPage
      .getByRole("button", { name: "刷新状态", exact: true })
      .click();
    await record(failed.id).getByText("已投递", { exact: true }).waitFor();
    assert.equal(
      await record(failed.id)
        .getByRole("button", { name: "重试任务", exact: true })
        .count(),
      0,
    );
    assert.ok(capturedAction);
  });

  await test("expired credential mail remains failed and retry never extends or exposes the link", async () => {
    const raw = links.newAccountToken();
    const token = await db.accountToken.create({
      data: {
        tenantId: platform.tenantId,
        userId: platform.id,
        email: platform.email,
        purpose: "RESET",
        tokenVersion: platform.tokenVersion,
        tokenHash: links.accountTokenHash(raw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const row = await db.notificationJob.create({
      data: {
        id: `${prefix}-expired`,
        kind: "ACCOUNT_MAIL",
        status: "FAILED",
        attempts: 5,
        totalAttempts: 5,
        payload: {
          tokenId: token.id,
          encrypted: links.sealAccountToken(raw, process.env.AUTH_SECRET),
        },
      },
    });
    await platformPage.goto(url());
    await openRetry(row.id);
    await platformPage
      .getByRole("button", { name: "确认重新排队", exact: true })
      .click();
    await platformPage
      .getByText("账号链接已失效或发送条件已变更，请重新申请邮件或邀请", {
        exact: true,
      })
      .waitFor();
    const unchanged = await db.notificationJob.findUniqueOrThrow({
      where: { id: row.id },
    });
    assert.equal(unchanged.status, "FAILED");
    assert.equal(unchanged.manualRetries, 0);
    assert.equal(
      (
        await db.accountToken.findUniqueOrThrow({ where: { id: token.id } })
      ).expiresAt.getTime(),
      token.expiresAt.getTime(),
    );
    assert.equal((await platformPage.content()).includes(raw), false);
    await platformPage
      .getByRole("button", { name: "取消", exact: true })
      .click();
  });

  await test("disabled webhooks are recorded as skipped; filters and pagination distinguish history", async () => {
    const endpoint = await db.webhookEndpoint.create({
      data: {
        tenantId: team.id,
        siteId: team.sites[0].id,
        name: "禁用投递探针",
        type: "GENERIC",
        url: "http://127.0.0.1:1/never-sent",
        active: false,
        events: [],
      },
    });
    const skipped = await db.notificationJob.create({
      data: {
        id: `${prefix}-skipped`,
        kind: "WEBHOOK",
        payload: {
          endpointId: endpoint.id,
          webhook: { siteId: team.sites[0].id, event: "conversation.created" },
        },
      },
    });
    await until(
      async () =>
        (
          await db.notificationJob.findUniqueOrThrow({
            where: { id: skipped.id },
          })
        ).outcome === "SKIPPED",
      "disabled channel skipped",
    );
    await db.notificationJob.create({
      data: {
        id: `${prefix}-history`,
        kind: "MAIL",
        status: "DELIVERED",
        completedAt: new Date(),
        payload: {},
        outcome: null,
      },
    });
    await db.notificationJob.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        id: `${prefix}-extra-${i}`,
        kind: "MAIL",
        status: "FAILED",
        attempts: 5,
        totalAttempts: 5,
        payload: mail,
      })),
    });
    await platformPage.goto(url({ state: "SKIPPED" }));
    await record(skipped.id).getByText("已跳过", { exact: true }).waitFor();
    assert.equal(await platformPage.getByRole("article").count(), 1);
    await platformPage.goto(url({ state: "LEGACY" }));
    await record(`${prefix}-history`)
      .getByText("历史已处理", { exact: true })
      .waitFor();
    await platformPage.goto(url());
    await until(
      async () => (await platformPage.getByRole("article").count()) === 20,
      "unfiltered delivery page loaded",
    );
    assert.equal(await platformPage.getByRole("article").count(), 20);
    await platformPage
      .getByRole("link", { name: "下一页", exact: true })
      .click();
    await until(
      async () => (await platformPage.getByRole("article").count()) === 6,
      "second delivery page loaded",
    ).catch(async (error) => {
      await platformPage.screenshot({
        path: `${artifacts}/delivery-pagination-failure.png`,
        fullPage: true,
      });
      await writeFile(
        `${artifacts}/delivery-pagination-diagnostic.json`,
        JSON.stringify(
          {
            url: platformPage.url(),
            count: await platformPage.getByRole("article").count(),
            text: await platformPage.locator("main").innerText(),
            database: await db.notificationJob.count({
              where: { id: { contains: prefix } },
            }),
            links: await platformPage
              .getByRole("link")
              .evaluateAll((nodes) =>
                nodes
                  .filter((n) => ["下一页", "上一页"].includes(n.textContent))
                  .map((n) => ({ label: n.textContent, href: n.href })),
              ),
          },
          null,
          2,
        ),
      );
      throw error;
    });
    assert.equal(await platformPage.getByRole("article").count(), 6);
    await platformPage
      .getByRole("link", { name: "上一页", exact: true })
      .click();
    await until(
      async () => (await platformPage.getByRole("article").count()) === 20,
      "first delivery page restored",
    );
  });

  await test("merchant routes and forged action requests cannot operate the platform delivery queue", async () => {
    const before = await db.notificationJob.count({
      where: { manualRetries: { gt: 0 } },
    });
    const denied = await merchantPage.request.post(
      `${APP}${ADMIN}/deliveries`,
      {
        headers: {
          "next-action": capturedAction.action,
          "content-type": capturedAction.type,
          origin: APP,
        },
        data: capturedAction.body,
      },
    );
    assert.ok((await denied.text()).includes("需要平台管理员权限"));
    assert.equal(
      await db.notificationJob.count({ where: { manualRetries: { gt: 0 } } }),
      before,
    );
    await merchantPage.goto(`${APP}${ADMIN}/deliveries`);
    await merchantPage
      .getByRole("heading", { name: "404", exact: true })
      .waitFor();
    assert.equal(
      await merchantPage
        .getByRole("button", { name: "重试任务", exact: true })
        .count(),
      0,
    );
  });

  await test("delivery monitoring and retry confirmation work at phone width and pass accessibility checks", async () => {
    await platformPage.setViewportSize({ width: 375, height: 812 });
    await platformPage.goto(url());
    await until(
      async () => (await platformPage.getByRole("article").count()) === 20,
      "mobile delivery page loaded",
    );
    await axe(platformPage);
    const first = platformPage
      .getByRole("article")
      .filter({
        has: platformPage.getByRole("button", {
          name: "重试任务",
          exact: true,
        }),
      })
      .first();
    await first.getByRole("button", { name: "重试任务", exact: true }).click();
    await platformPage.getByRole("alertdialog").waitFor();
    await axe(platformPage);
    await platformPage.screenshot({
      path: `${artifacts}/mobile-delivery-retry.png`,
      fullPage: true,
    });
    await platformPage
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await platformPage.screenshot({
      path: `${artifacts}/mobile-deliveries.png`,
      fullPage: true,
    });
    await platformPage
      .getByRole("button", { name: "暗色", exact: true })
      .click();
    await until(
      () =>
        platformPage
          .locator("html")
          .evaluate((el) => el.classList.contains("dark")),
      "dark theme applied",
    );
    await axe(platformPage);
    await platformPage
      .getByRole("button", { name: "亮色", exact: true })
      .click();
    await page.goto(`${APP}/login`);
  });
}
