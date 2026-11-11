import assert from "node:assert/strict";
import {
  followUpService,
  followUpPolicy as policy,
} from "../tests/follow-up-fixtures.mjs";

/** Uses only the account harness's disposable database. No visitor messages or mails are sent. */
export async function runFollowUpChecks({
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
  until,
  axe,
  artifacts,
  stamp,
}) {
  const prefix = `follow-${stamp}`,
    site = team.sites[0];
  const service = followUpService(db);
  const secondSite = await db.site.create({
    data: {
      tenantId: team.id,
      name: "未授权跟进站点",
      slug: `${prefix}-second`,
    },
  });
  const agent = await db.user.create({
    data: {
      tenantId: team.id,
      name: "跟进客服甲",
      email: `${prefix}-a@test.local`,
      role: "AGENT",
      passwordHash: merchant.passwordHash,
      sites: { create: { siteId: site.id } },
    },
  });
  const colleague = await db.user.create({
    data: {
      tenantId: team.id,
      name: "跟进客服乙",
      email: `${prefix}-b@test.local`,
      role: "AGENT",
      passwordHash: merchant.passwordHash,
      sites: { create: { siteId: site.id } },
    },
  });
  const inactive = await db.user.create({
    data: {
      tenantId: team.id,
      name: "停用客服",
      email: `${prefix}-inactive@test.local`,
      role: "AGENT",
      active: false,
      passwordHash: merchant.passwordHash,
      sites: { create: { siteId: site.id } },
    },
  });
  const foreign = await db.tenant.create({
    data: {
      name: "外部跟进商家",
      slug: `${prefix}-foreign`,
      sites: { create: { name: "外部站点", slug: `${prefix}-foreign` } },
      users: {
        create: {
          name: "外部管理员",
          email: `${prefix}-foreign@test.local`,
          role: "MERCHANT_ADMIN",
          passwordHash: merchant.passwordHash,
        },
      },
    },
    include: { sites: true, users: true },
  });
  const visitor = await db.visitor.create({
    data: {
      siteId: site.id,
      email: `${prefix}@test.local`,
      localKey: prefix,
      name: "跟进验收访客",
    },
  });
  const makeConversation = async (
    suffix,
    source = "WIDGET",
    status = "OPEN",
    currentSite = site,
    currentVisitor = visitor,
  ) =>
    db.conversation.create({
      data: {
        id: `${prefix}-${suffix}`,
        siteId: currentSite.id,
        visitorId: currentVisitor.id,
        source,
        status,
        subject: `${prefix}-${suffix}`,
        messages: {
          create: { sender: "VISITOR", type: "TEXT", body: `咨询-${suffix}` },
        },
      },
    });
  const offline = await makeConversation("offline", "OFFLINE_FORM", "PENDING");
  const closed = await makeConversation("closed", "WIDGET", "CLOSED");
  const concurrent = await makeConversation("concurrent");
  const rollback = await makeConversation("rollback");
  const unauthorizedVisitor = await db.visitor.create({
    data: {
      siteId: secondSite.id,
      email: `${prefix}-unauthorized@test.local`,
      localKey: prefix,
    },
  });
  const unauthorized = await makeConversation(
    "unauthorized",
    "WIDGET",
    "OPEN",
    secondSite,
    unauthorizedVisitor,
  );
  const foreignVisitor = await db.visitor.create({
    data: {
      siteId: foreign.sites[0].id,
      email: `${prefix}-foreign-visitor@test.local`,
      localKey: prefix,
    },
  });
  const foreignConversation = await makeConversation(
    "foreign",
    "WIDGET",
    "OPEN",
    foreign.sites[0],
    foreignVisitor,
  );
  const agentContext = await browser.newContext(),
    colleagueContext = await browser.newContext();
  for (const [context, user] of [
    [agentContext, agent],
    [colleagueContext, colleague],
  ])
    assert.equal(
      (
        await context.request.post(`${APP}/api/auth/login`, {
          data: { email: user.email, password: `Test-${stamp}!` },
        })
      ).status(),
      200,
    );
  const agentPage = await agentContext.newPage();
  agentPage.setDefaultTimeout(15000);
  const errors = [];
  agentPage.on("pageerror", (error) =>
    errors.push(`${new URL(agentPage.url()).pathname}: ${error.message}`),
  );
  const endpoint = (conversation) =>
    `${APP}/api/agent/conversations/${conversation.id}/follow-up`;
  const post = (context, conversation, data) =>
    context.request.post(endpoint(conversation), { data });
  const version = async (conversation) =>
    (
      await db.followUp.findUniqueOrThrow({
        where: { conversationId: conversation.id },
      })
    ).version;
  const future = () => new Date(Date.now() + 24 * 3600000).toISOString();
  const actor = { ...merchant, siteIds: [site.id, secondSite.id] };
  const agentActor = { ...agent, siteIds: [site.id] };
  const dialog = merchantPage.getByRole("dialog", {
    name: "会话跟进",
    exact: true,
  });
  let task;
  try {
    await test("offline conversations can be scheduled from the real workbench without sending a message or changing conversation state", async () => {
      await merchantPage.goto(`${APP}/agent?c=${offline.id}`);
      await merchantPage
        .getByRole("button", { name: "安排或处理会话跟进", exact: true })
        .click();
      await dialog
        .getByLabel("跟进事项", { exact: true })
        .fill(`${prefix}-核对离线留言`);
      await dialog
        .getByLabel("跟进时间（北京时间）", { exact: true })
        .fill(policy.followUpLocalTime(new Date(Date.now() + 24 * 3600000)));
      await dialog.getByLabel("负责人", { exact: true }).selectOption(agent.id);
      assert.equal(
        await dialog.locator(`option[value="${inactive.id}"]`).count(),
        0,
      );
      await axe(merchantPage);
      await dialog
        .getByRole("button", { name: "保存跟进", exact: true })
        .click();
      await dialog
        .getByRole("status")
        .filter({ hasText: "跟进任务已保存" })
        .waitFor();
      await dialog
        .getByRole("button", { name: "标记已完成", exact: true })
        .waitFor();
      task = await db.followUp.findUniqueOrThrow({
        where: { conversationId: offline.id },
      });
      assert.equal(task.ownerId, agent.id);
      assert.equal(task.tenantId, team.id);
      assert.equal(task.version, 1);
      assert.equal(
        (await db.conversation.findUniqueOrThrow({ where: { id: offline.id } }))
          .status,
        "PENDING",
      );
      assert.equal(
        await db.message.count({ where: { conversationId: offline.id } }),
        1,
      );
      const audits = await db.auditLog.findMany({
        where: { targetId: task.id },
      });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].tenantId, team.id);
      assert.equal(
        JSON.stringify(audits[0].meta).includes("核对离线留言"),
        false,
      );
    });
    await test("tenant, site, owner and delegation checks protect task reads and mutations", async () => {
      assert.equal((await page.request.get(endpoint(offline))).status(), 401);
      assert.equal(
        (
          await agentContext.request.get(endpoint(foreignConversation))
        ).status(),
        404,
      );
      assert.equal(
        (await agentContext.request.get(endpoint(unauthorized))).status(),
        404,
      );
      const other = await (
        await colleagueContext.request.get(endpoint(offline))
      ).json();
      assert.equal(other.canEdit, false);
      assert.equal(
        (
          await post(colleagueContext, offline, {
            action: "complete",
            expectedVersion: 1,
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await post(agentContext, closed, {
            action: "save",
            ownerId: colleague.id,
            dueAt: future(),
            note: "伪造委派",
            expectedVersion: 0,
          })
        ).status(),
        403,
      );
      for (const ownerId of [foreign.users[0].id, inactive.id])
        assert.equal(
          (
            await post(merchantPage, closed, {
              action: "save",
              ownerId,
              dueAt: future(),
              note: "无效负责人",
              expectedVersion: 0,
            })
          ).status(),
          400,
        );
      assert.equal(
        (
          await post(agentContext, closed, {
            action: "save",
            ownerId: agent.id,
            dueAt: new Date(Date.now() - 1000).toISOString(),
            note: "过去时间",
            expectedVersion: 0,
          })
        ).status(),
        400,
      );
      assert.equal(
        (
          await post(agentContext, closed, {
            action: "save",
            ownerId: agent.id,
            dueAt: future(),
            note: "跨商家",
            expectedVersion: 0,
            tenantId: foreign.id,
          })
        ).status(),
        422,
      );
      assert.equal(
        await db.followUp.count({ where: { conversationId: closed.id } }),
        0,
      );
      const otherBoard = await service.listFollowUps(
        { ...colleague, siteIds: [site.id] },
        { mine: "", query: prefix },
      );
      assert.equal(otherBoard.total, 0);
    });
    await test("parallel creation and edits have one winner, and stale workbench versions cannot complete a changed task", async () => {
      const data = {
        action: "save",
        expectedVersion: 0,
        ownerId: agent.id,
        dueAt: future(),
        note: `${prefix}-并发新建`,
      };
      const create = await Promise.all([
        post(agentContext, concurrent, data),
        post(agentContext, concurrent, data),
      ]);
      assert.deepEqual(
        create.map((response) => response.status()).sort(),
        [200, 409],
      );
      assert.equal(
        await db.followUp.count({ where: { conversationId: concurrent.id } }),
        1,
      );
      const c = await db.followUp.findUniqueOrThrow({
        where: { conversationId: concurrent.id },
      });
      assert.equal(
        await db.auditLog.count({
          where: { targetId: c.id, action: "followup.create" },
        }),
        1,
      );
      const edits = await Promise.all([
        post(agentContext, offline, {
          ...data,
          expectedVersion: 1,
          note: `${prefix}-最新版本甲`,
        }),
        post(agentContext, offline, {
          ...data,
          expectedVersion: 1,
          note: `${prefix}-最新版本乙`,
        }),
      ]);
      assert.deepEqual(
        edits.map((response) => response.status()).sort(),
        [200, 409],
      );
      await dialog
        .getByRole("button", { name: "标记已完成", exact: true })
        .click();
      await dialog.getByRole("alert").filter({ hasText: "已被更新" }).waitFor();
      assert.equal(
        (
          await db.followUp.findUniqueOrThrow({
            where: { conversationId: offline.id },
          })
        ).status,
        "OPEN",
      );
      await dialog
        .getByRole("button", { name: "刷新任务", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "标记已完成", exact: true })
        .click();
      await dialog
        .getByRole("status")
        .filter({ hasText: "跟进任务已完成" })
        .waitFor();
      assert.equal(
        (
          await db.followUp.findUniqueOrThrow({
            where: { conversationId: offline.id },
          })
        ).version,
        3,
      );
      assert.equal(
        (await db.conversation.findUniqueOrThrow({ where: { id: offline.id } }))
          .status,
        "PENDING",
      );
      assert.equal(
        await db.message.count({ where: { conversationId: offline.id } }),
        1,
      );
      await merchantPage.keyboard.press("Escape");
    });
    await test("closed chats can be followed up, processed tasks can be rescheduled, and reassignment takes effect immediately", async () => {
      const saved = await post(agentContext, closed, {
        action: "save",
        expectedVersion: 0,
        ownerId: agent.id,
        note: `${prefix}-已结束会话跟进`,
        dueAt: future(),
      });
      assert.equal(saved.status(), 200);
      assert.equal(
        (await db.conversation.findUniqueOrThrow({ where: { id: closed.id } }))
          .status,
        "CLOSED",
      );
      assert.equal(
        (
          await post(agentContext, closed, {
            action: "cancel",
            expectedVersion: 1,
          })
        ).status(),
        200,
      );
      assert.equal(
        (
          await post(agentContext, closed, {
            action: "complete",
            expectedVersion: 2,
          })
        ).status(),
        409,
      );
      const original = await db.followUp.findUniqueOrThrow({
        where: { conversationId: closed.id },
      });
      assert.equal(
        (
          await post(merchantPage, closed, {
            action: "save",
            expectedVersion: 2,
            ownerId: colleague.id,
            note: `${prefix}-重新安排`,
            dueAt: future(),
          })
        ).status(),
        200,
      );
      const rescheduled = await db.followUp.findUniqueOrThrow({
        where: { conversationId: closed.id },
      });
      assert.equal(rescheduled.id, original.id);
      assert.equal(rescheduled.status, "OPEN");
      assert.equal(rescheduled.finishedAt, null);
      assert.equal(
        (
          await post(agentContext, closed, {
            action: "complete",
            expectedVersion: 3,
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await post(colleagueContext, closed, {
            action: "complete",
            expectedVersion: 3,
          })
        ).status(),
        200,
      );
    });
    await test("audit failure rolls back a scheduled task instead of leaving an untracked change", async () => {
      const failing = followUpService({
        $transaction: (run) =>
          db.$transaction((tx) =>
            run(
              new Proxy(tx, {
                get(target, key) {
                  if (key === "auditLog")
                    return {
                      create: async () => {
                        throw Error("Isolated audit failure");
                      },
                    };
                  const value = Reflect.get(target, key);
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
              }),
            ),
          ),
      });
      await assert.rejects(
        failing.changeFollowUp(actor, rollback.id, {
          action: "save",
          expectedVersion: 0,
          ownerId: agent.id,
          note: `${prefix}-不得保留`,
          dueAt: future(),
        }),
        /Isolated audit failure/,
      );
      assert.equal(
        await db.followUp.count({ where: { conversationId: rollback.id } }),
        0,
      );
    });
    await test("overdue and Beijing-today boards paginate accurately and ordinary agents only see their own authorized tasks", async () => {
      const pagePrefix = `follow-page-${stamp}`;
      const ids = Array.from({ length: 26 }, (_, n) => `${pagePrefix}-${n}`);
      await db.conversation.createMany({
        data: ids.map((id) => ({
          id,
          siteId: site.id,
          visitorId: visitor.id,
          source: "OFFLINE_FORM",
        })),
      });
      await db.followUp.createMany({
        data: ids.map((conversationId, n) => ({
          tenantId: team.id,
          conversationId,
          ownerId: agent.id,
          note: `${pagePrefix}-待处理${n}`,
          dueAt: new Date(Date.now() - (n + 1) * 60000),
        })),
      });
      await db.followUp.createMany({
        data: [
          {
            tenantId: team.id,
            conversationId: unauthorized.id,
            ownerId: agent.id,
            note: "隐藏的未授权事项",
            dueAt: new Date(Date.now() - 60000),
          },
          {
            tenantId: foreign.id,
            conversationId: foreignConversation.id,
            ownerId: foreign.users[0].id,
            note: "隐藏的外部商家事项",
            dueAt: new Date(Date.now() - 60000),
          },
        ],
      });
      const query = new URLSearchParams({
        query: pagePrefix,
        status: "overdue",
        siteId: site.id,
        mine: "1",
      });
      await agentPage.goto(`${APP}/agent/follow-ups?${query}`);
      await agentPage
        .getByText("共 26 条 · 第 1 / 2 页", { exact: true })
        .waitFor();
      assert.equal(await agentPage.getByRole("article").count(), 20);
      await agentPage
        .getByRole("link", { name: "下一页", exact: true })
        .click();
      await agentPage
        .getByText("共 26 条 · 第 2 / 2 页", { exact: true })
        .waitFor();
      assert.equal(await agentPage.getByRole("article").count(), 6);
      for (const [key, value] of query)
        assert.equal(new URL(agentPage.url()).searchParams.get(key), value);
      const body = await agentPage.locator("body").innerText();
      assert.equal(body.includes("隐藏的未授权事项"), false);
      assert.equal(body.includes("隐藏的外部商家事项"), false);
      const data = await service.listFollowUps(agentActor, {
        query: pagePrefix,
        status: "today",
      });
      const today = policy.followUpToday();
      const expected = await db.followUp.count({
        where: {
          ownerId: agent.id,
          conversationId: { in: ids },
          status: "OPEN",
          dueAt: today,
        },
      });
      assert.equal(data.total, expected);
      await merchantPage.goto(
        `${APP}${ADMIN}/follow-ups?${new URLSearchParams({ query: pagePrefix, status: "overdue" })}`,
      );
      await merchantPage
        .getByText("共 26 条 · 第 1 / 2 页", { exact: true })
        .waitFor();
      await axe(merchantPage);
      const platformRows = await (
        await platformPage.request.get(endpoint(foreignConversation))
      ).json();
      assert.equal(platformRows.task.note, "隐藏的外部商家事项");
    });
    await test("workbench due counts refresh after changes and deleting an owner preserves tasks for administrator reassignment", async () => {
      const expected = await db.followUp.count({
        where: {
          ownerId: agent.id,
          status: "OPEN",
          dueAt: { lte: new Date() },
          conversation: { siteId: site.id },
        },
      });
      const count = await (
        await agentContext.request.get(`${APP}/api/agent/follow-ups/count`)
      ).json();
      assert.equal(count.due, expected);
      await agentPage.goto(`${APP}/agent?c=${offline.id}`);
      await agentPage
        .getByRole("link", {
          name: `我的跟进，已到期 ${expected} 项`,
          exact: true,
        })
        .waitFor();
      await db.followUp.update({
        where: { conversationId: concurrent.id },
        data: { dueAt: new Date(Date.now() - 1000) },
      });
      await agentPage.evaluate(() =>
        window.dispatchEvent(new Event("beesupport:followups-changed")),
      );
      await agentPage
        .getByRole("link", {
          name: `我的跟进，已到期 ${expected + 1} 项`,
          exact: true,
        })
        .waitFor();
      await db.user.update({
        where: { id: inactive.id },
        data: { active: true },
      });
      const orphan = await service.changeFollowUp(actor, rollback.id, {
        action: "save",
        expectedVersion: 0,
        ownerId: inactive.id,
        note: `${prefix}-保留孤立任务`,
        dueAt: future(),
      });
      await db.user.delete({ where: { id: inactive.id } });
      assert.equal(
        (await db.followUp.findUniqueOrThrow({ where: { id: orphan.id } }))
          .ownerId,
        null,
      );
      const repaired = await service.changeFollowUp(actor, rollback.id, {
        action: "save",
        expectedVersion: 1,
        ownerId: agent.id,
        note: `${prefix}-已重新分配`,
        dueAt: future(),
      });
      assert.equal(repaired.ownerId, agent.id);
    });
    await test("completing the last matching task refreshes the board and counts while preserving filters", async () => {
      const note = `${prefix}-已重新分配`;
      const params = new URLSearchParams({
        query: note,
        status: "OPEN",
        siteId: site.id,
        mine: "1",
      });
      await agentPage.goto(`${APP}/agent/follow-ups?${params}`);
      await agentPage
        .getByText("共 1 条 · 第 1 / 1 页", { exact: true })
        .waitFor();
      await agentPage
        .getByRole("article")
        .getByRole("button", { name: "安排或处理会话跟进", exact: true })
        .click();
      const editor = agentPage.getByRole("dialog", {
        name: "会话跟进",
        exact: true,
      });
      await editor
        .getByRole("button", { name: "标记已完成", exact: true })
        .click();
      await agentPage
        .getByText("暂无符合条件的跟进任务", { exact: true })
        .waitFor();
      await agentPage
        .getByText("共 0 条 · 第 1 / 1 页", { exact: true })
        .waitFor();
      for (const [key, value] of params)
        assert.equal(new URL(agentPage.url()).searchParams.get(key), value);
      assert.equal(
        (
          await db.followUp.findUniqueOrThrow({
            where: { conversationId: rollback.id },
          })
        ).status,
        "DONE",
      );
    });
    await test("task boards and scheduling dialogs work on mobile in light and dark modes", async () => {
      await merchantPage.setViewportSize({ width: 375, height: 812 });
      await agentPage.setViewportSize({ width: 375, height: 812 });
      for (const theme of ["light", "dark"]) {
        for (const p of [merchantPage, agentPage])
          await p.evaluate((value) => {
            localStorage.setItem("theme", value);
            document.documentElement.classList.toggle("dark", value === "dark");
          }, theme);
        await merchantPage.goto(`${APP}${ADMIN}/follow-ups?query=${prefix}`);
        await merchantPage
          .getByRole("heading", { name: "会话跟进待办", exact: true })
          .waitFor();
        await axe(merchantPage);
        await merchantPage.screenshot({
          path: `${artifacts}/followups-board-${theme}.png`,
          fullPage: true,
        });
        await agentPage.goto(`${APP}/agent?c=${offline.id}`);
        const name = agentPage
          .locator("main")
          .getByText("跟进验收访客", { exact: true })
          .first();
        await name.waitFor();
        assert.ok(
          (await name.boundingBox()).width >= 40,
          "Mobile chat header keeps the visitor name visible",
        );
        await agentPage
          .getByRole("button", { name: "安排或处理会话跟进", exact: true })
          .click();
        const edit = agentPage.getByRole("dialog", {
          name: "会话跟进",
          exact: true,
        });
        await edit.getByLabel("跟进事项", { exact: true }).waitFor();
        await axe(agentPage);
        await agentPage.screenshot({
          path: `${artifacts}/followups-editor-${theme}.png`,
          fullPage: true,
        });
        await agentPage.keyboard.press("Escape");
      }
      assert.deepEqual(errors, []);
    });
  } catch (error) {
    await agentPage
      .screenshot({
        path: `${artifacts}/followups-failure-agent.png`,
        fullPage: true,
      })
      .catch(() => {});
    await merchantPage
      .screenshot({
        path: `${artifacts}/followups-failure-manager.png`,
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await agentContext.close();
    await colleagueContext.close();
  }
}
