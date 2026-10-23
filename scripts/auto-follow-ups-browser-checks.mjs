import assert from "node:assert/strict";
import { followUpRuleService } from "../tests/follow-up-rule-fixtures.mjs";

export async function runAutoFollowUpChecks({
  db,
  browser,
  APP,
  ADMIN,
  page,
  platformPage,
  merchantPage,
  platform,
  merchant,
  team,
  test,
  until,
  axe,
  artifacts,
  stamp,
}) {
  const site = team.sites[0],
    service = followUpRuleService(db);
  await db.site.update({
    where: { id: site.id },
    data: {
      autoAssign: false,
      workHours: { enabled: true, timezone: "Asia/Shanghai", days: {} },
    },
  });
  const agent = await db.user.create({
    data: {
      tenantId: team.id,
      name: "自动跟进客服",
      email: `auto-${stamp}@test.local`,
      role: "AGENT",
      passwordHash: merchant.passwordHash,
      sites: { create: { siteId: site.id } },
    },
  });
  const otherSite = await db.site.create({
    data: {
      tenantId: team.id,
      name: "第二规则站点",
      slug: `auto-second-${stamp}`,
    },
  });
  const foreign = await db.tenant.create({
    data: {
      name: "外部规则商家",
      slug: `auto-foreign-${stamp}`,
      sites: {
        create: { name: "外部规则站点", slug: `auto-foreign-${stamp}` },
      },
    },
    include: { sites: true },
  });
  const agentContext = await browser.newContext();
  assert.equal(
    (
      await agentContext.request.post(`${APP}/api/auth/login`, {
        data: { email: agent.email, password: `Test-${stamp}!` },
      })
    ).status(),
    200,
  );
  const url = (id = site.id) => `${APP}/api/admin/sites/${id}/follow-up-rule`;
  const post = (data, id = site.id, request = merchantPage.request) =>
    request.post(url(id), { data });
  const current = () =>
    db.followUpRule.findUniqueOrThrow({ where: { siteId: site.id } });
  const taskFor = (id) =>
    db.followUp.findUnique({ where: { conversationId: id } });
  const rulesPage = `${APP}${ADMIN}/follow-ups/rules?siteId=${site.id}`;
  const form = merchantPage.getByRole("form", { name: "离线留言自动跟进规则" });
  let sequence = 0,
    old,
    initialTask;
  const newVisitor = async (label) => {
    const response = await page.request.post(`${APP}/api/widget/session`, {
      data: {
        key: site.publicKey,
        localKey: `auto-${stamp}-${++sequence}`,
        email: `auto-${stamp}-${sequence}@test.local`,
        name: `自动跟进访客-${label}`,
      },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const send = async (visitor, data = {}) => {
    const response = await page.request.post(`${APP}/api/widget/conversation`, {
      headers: { Authorization: `Bearer ${visitor.token}` },
      data: { body: "验收咨询内容", ...data },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const offline = async (label) => {
    const visitor = await newVisitor(label),
      result = await send(visitor);
    assert.equal(result.conversation.source, "OFFLINE_FORM");
    return { visitor, result, id: result.conversation.id };
  };
  try {
    await test("existing sites default to disabled and public widget configuration contains no internal automation", async () => {
      const defaults = await (await merchantPage.request.get(url())).json();
      assert.deepEqual(defaults.rule, {
        enabled: false,
        ownerId: "",
        delayMinutes: 60,
        version: 0,
      });
      old = await offline("开关关闭");
      assert.equal(await taskFor(old.id), null);
      assert.equal(await db.followUpRule.count(), 0);
      const response = await page.request.get(
          `${APP}/api/widget/config?key=${site.publicKey}`,
        ),
        config = await response.json();
      assert.equal(response.status(), 200);
      assert.equal(JSON.stringify(config).includes("followUpRule"), false);
      await merchantPage.goto(rulesPage);
      await form.waitFor();
      assert.equal(
        await form
          .getByLabel("启用离线留言自动跟进", { exact: true })
          .isChecked(),
        false,
      );
      await axe(merchantPage);
    });
    await test("a manager can enable a site rule and new offline messages create one private task with an audited deadline", async () => {
      await form.getByLabel("启用离线留言自动跟进", { exact: true }).check();
      await form
        .getByLabel("默认负责人", { exact: true })
        .selectOption(agent.id);
      await form.getByLabel("处理时限（分钟）", { exact: true }).fill("30");
      await form
        .getByRole("button", { name: "保存自动跟进规则", exact: true })
        .click();
      await form.getByRole("status").filter({ hasText: "已启用" }).waitFor();
      const rule = await current();
      assert.equal(rule.version, 1);
      const created = await offline("开启后");
      initialTask = await taskFor(created.id);
      assert.equal(initialTask.ownerId, agent.id);
      assert.equal(initialTask.tenantId, team.id);
      assert.equal(initialTask.status, "OPEN");
      const conversation = await db.conversation.findUniqueOrThrow({
        where: { id: created.id },
      });
      assert.equal(
        initialTask.dueAt.getTime() - conversation.createdAt.getTime(),
        30 * 60000,
      );
      assert.equal(conversation.status, "PENDING");
      assert.equal(
        await db.message.count({ where: { conversationId: created.id } }),
        1,
      );
      const audit = await db.auditLog.findMany({
        where: { targetId: initialTask.id },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, "followup.autoCreate");
      assert.equal(audit[0].actorId, null);
      assert.equal(audit[0].meta.ruleVersion, 1);
      assert.equal(audit[0].tenantId, team.id);
      assert.equal(
        JSON.stringify(created.result).includes(initialTask.note),
        false,
      );
      assert.equal(JSON.stringify(created.result).includes(rule.id), false);
      initialTask.visitor = created.visitor;
    });
    await test("message retries, concurrent helper calls, finished tasks and old conversations do not duplicate or overwrite tasks", async () => {
      const results = await Promise.all([
        send(initialTask.visitor, { clientId: `retry-${stamp}` }),
        send(initialTask.visitor, { clientId: `retry-${stamp}` }),
      ]);
      assert.ok(results.every((result) => result.created === false));
      await Promise.all(
        [1, 2].map(() =>
          db.$transaction((tx) =>
            service.createOfflineFollowUp(tx, initialTask.conversationId),
          ),
        ),
      );
      const after = await taskFor(initialTask.conversationId);
      assert.equal(after.version, 1);
      assert.equal(after.dueAt.getTime(), initialTask.dueAt.getTime());
      assert.equal(
        await db.auditLog.count({
          where: { targetId: initialTask.id, action: "followup.autoCreate" },
        }),
        1,
      );
      await db.followUp.update({
        where: { id: after.id },
        data: { status: "DONE", version: 2, finishedAt: new Date() },
      });
      await send(initialTask.visitor, { body: "继续咨询" });
      await db.$transaction((tx) =>
        service.createOfflineFollowUp(tx, initialTask.conversationId),
      );
      assert.equal((await taskFor(initialTask.conversationId)).status, "DONE");
      await send(old.visitor, { body: "旧留言补充" });
      assert.equal(await taskFor(old.id), null);
      const manual = await db.followUp.create({
        data: {
          tenantId: team.id,
          conversationId: old.id,
          ownerId: merchant.id,
          note: "保留人工安排事项",
          dueAt: new Date(Date.now() + 3600000),
        },
      });
      await db.$transaction((tx) => service.createOfflineFollowUp(tx, old.id));
      assert.deepEqual(await taskFor(old.id), manual);
    });
    await test("configuration APIs enforce authentication, merchant boundaries and eligible owners", async () => {
      assert.equal((await page.request.get(url())).status(), 401);
      assert.equal((await agentContext.request.get(url())).status(), 403);
      assert.equal(
        (
          await post(
            {
              enabled: false,
              ownerId: "",
              delayMinutes: 30,
              expectedVersion: 1,
            },
            site.id,
            agentContext.request,
          )
        ).status(),
        403,
      );
      assert.equal(
        (await merchantPage.request.get(url(foreign.sites[0].id))).status(),
        404,
      );
      assert.equal(
        (
          await post(
            {
              enabled: true,
              ownerId: agent.id,
              delayMinutes: 30,
              expectedVersion: 0,
            },
            foreign.sites[0].id,
          )
        ).status(),
        404,
      );
      for (const [id, ownerId, version] of [
        [site.id, platform.id, 1],
        [otherSite.id, agent.id, 0],
      ]) {
        assert.equal(
          (
            await post(
              {
                enabled: true,
                ownerId,
                delayMinutes: 30,
                expectedVersion: version,
              },
              id,
            )
          ).status(),
          400,
        );
      }
      assert.equal(
        (
          await post({
            enabled: true,
            ownerId: agent.id,
            delayMinutes: 10081,
            expectedVersion: 1,
          })
        ).status(),
        422,
      );
      const firstSaves = await Promise.all(
        [1, 2].map(() =>
          post(
            {
              enabled: false,
              ownerId: "",
              delayMinutes: 60,
              expectedVersion: 0,
            },
            foreign.sites[0].id,
            platformPage.request,
          ),
        ),
      );
      assert.deepEqual(
        firstSaves.map((response) => response.status()).sort(),
        [200, 409],
      );
      const audit = await db.auditLog.findFirstOrThrow({
        where: { tenantId: foreign.id, action: "followup.rule.update" },
      });
      assert.equal(audit.actorId, platform.id);
    });
    await test("concurrent rule updates have one winner and a stale form requires explicit reload", async () => {
      const responses = await Promise.all(
        [31, 32].map((delayMinutes) =>
          post({
            enabled: true,
            ownerId: agent.id,
            delayMinutes,
            expectedVersion: 1,
          }),
        ),
      );
      assert.deepEqual(
        responses.map((response) => response.status()).sort(),
        [200, 409],
      );
      assert.equal((await current()).version, 2);
      await form
        .getByRole("button", { name: "保存自动跟进规则", exact: true })
        .click();
      await form
        .getByRole("alert")
        .filter({ hasText: "配置已被其他管理员更新" })
        .waitFor();
      assert.equal(
        await form
          .getByRole("button", { name: "保存自动跟进规则", exact: true })
          .isDisabled(),
        true,
      );
      await form
        .getByRole("button", { name: "重新加载配置", exact: true })
        .click();
      await until(
        async () =>
          (await form
            .getByLabel("处理时限（分钟）", { exact: true })
            .inputValue()) === String((await current()).delayMinutes),
        "Reload winning rule",
      );
    });
    await test("invalid owners pause automation, deletion is visible and disabling an invalid rule remains possible", async () => {
      await db.user.update({
        where: { id: agent.id },
        data: { active: false },
      });
      assert.equal(await taskFor((await offline("负责人停用")).id), null);
      await merchantPage.goto(rulesPage);
      await form
        .getByRole("alert")
        .filter({ hasText: "负责人未配置或已失效" })
        .waitFor();
      await db.user.update({ where: { id: agent.id }, data: { active: true } });
      await db.siteAgent.deleteMany({ where: { userId: agent.id } });
      assert.equal(await taskFor((await offline("失去授权")).id), null);
      await db.user.delete({ where: { id: agent.id } });
      assert.equal((await current()).ownerId, null);
      assert.equal(await taskFor((await offline("负责人删除")).id), null);
      assert.equal((await taskFor(initialTask.conversationId)).ownerId, null);
      await merchantPage.goto(rulesPage);
      await form.getByLabel("启用离线留言自动跟进", { exact: true }).uncheck();
      await form
        .getByRole("button", { name: "保存自动跟进规则", exact: true })
        .click();
      await form.getByRole("status").filter({ hasText: "已关闭" }).waitFor();
      assert.equal((await current()).enabled, false);
      assert.equal((await taskFor(initialTask.conversationId)).status, "DONE");
      const rule = await current();
      assert.equal(
        (
          await post({
            enabled: true,
            ownerId: merchant.id,
            delayMinutes: 15,
            expectedVersion: rule.version,
          })
        ).status(),
        200,
      );
      const next = await offline("改派管理员");
      assert.equal((await taskFor(next.id)).ownerId, merchant.id);
    });
    await test("online source is decided by the server and audit failures roll back rules, conversations and tasks", async () => {
      await db.site.update({
        where: { id: site.id },
        data: { workHours: { enabled: false } },
      });
      await db.user.update({
        where: { id: merchant.id },
        data: { status: "ONLINE", lastSeenAt: new Date() },
      });
      const visitor = await newVisitor("在线"),
        online = await send(visitor, { source: "OFFLINE_FORM" });
      assert.equal(online.conversation.source, "WIDGET");
      assert.equal(await taskFor(online.conversation.id), null);
      const failingTx = (tx) =>
        new Proxy(tx, {
          get(target, key) {
            return key === "auditLog"
              ? {
                  create: async () => {
                    throw new Error("audit unavailable");
                  },
                }
              : target[key];
          },
        });
      const actor = { ...merchant, siteIds: [site.id, otherSite.id] },
        before = await current();
      const failing = followUpRuleService({
        $transaction: (run) => db.$transaction((tx) => run(failingTx(tx))),
      });
      await assert.rejects(
        failing.saveFollowUpRule(actor, site.id, {
          enabled: false,
          ownerId: "",
          delayMinutes: 40,
          expectedVersion: before.version,
        }),
        /audit unavailable/,
      );
      assert.deepEqual(await current(), before);
      const rollbackId = `auto-rollback-${stamp}`;
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.conversation.create({
            data: {
              id: rollbackId,
              siteId: site.id,
              visitorId: visitor.visitor.id,
              source: "OFFLINE_FORM",
              messages: {
                create: { sender: "VISITOR", type: "TEXT", body: "事务验收" },
              },
            },
          });
          await service.createOfflineFollowUp(failingTx(tx), rollbackId);
        }),
        /audit unavailable/,
      );
      assert.equal(
        await db.conversation.count({ where: { id: rollbackId } }),
        0,
      );
      assert.equal(
        await db.followUp.count({ where: { conversationId: rollbackId } }),
        0,
      );
      assert.equal(
        await db.message.count({ where: { conversationId: rollbackId } }),
        0,
      );
    });
    await test("rule navigation, mobile light and dark themes have no overflow or accessibility violations", async () => {
      await merchantPage.goto(`${APP}${ADMIN}/follow-ups`);
      await merchantPage
        .getByRole("link", { name: "自动跟进规则", exact: true })
        .click();
      await form.waitFor();
      await merchantPage.setViewportSize({ width: 390, height: 844 });
      for (const theme of ["light", "dark"]) {
        await merchantPage.evaluate((value) => {
          document.documentElement.classList.toggle("dark", value === "dark");
          document.documentElement.style.colorScheme = value;
        }, theme);
        await axe(merchantPage);
        await merchantPage.screenshot({
          path: `${artifacts}/auto-followups-mobile-${theme}.png`,
          fullPage: true,
        });
      }
      await merchantPage
        .getByRole("link", { name: "返回跟进待办", exact: true })
        .click();
      await merchantPage
        .getByRole("heading", { name: "会话跟进待办", exact: true })
        .waitFor();
    });
  } catch (error) {
    await merchantPage
      .screenshot({
        path: `${artifacts}/auto-followups-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await agentContext.close();
  }
}
