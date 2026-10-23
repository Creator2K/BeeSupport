import assert from "node:assert/strict";
import { unansweredService } from "../tests/unanswered-fixtures.mjs";

export async function runUnansweredChecks({
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
    service = unansweredService(db),
    actor = { ...merchant, siteIds: [site.id] };
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
      name: "未回复提醒客服",
      email: `unanswered-${stamp}@test.local`,
      role: "AGENT",
      passwordHash: merchant.passwordHash,
      sites: { create: { siteId: site.id } },
    },
  });
  const otherSite = await db.site.create({
    data: {
      tenantId: team.id,
      name: "未授权提醒站点",
      slug: `unanswered-other-${stamp}`,
    },
  });
  const foreign = await db.tenant.create({
    data: {
      name: "外部提醒商家",
      slug: `unanswered-foreign-${stamp}`,
      sites: {
        create: { name: "外部提醒站点", slug: `unanswered-foreign-${stamp}` },
      },
    },
    include: { sites: true },
  });
  const agentContext = await browser.newContext(),
    agentPage = await agentContext.newPage(),
    errors = [];
  agentPage.on("pageerror", (error) => errors.push(error.message));
  assert.equal(
    (
      await agentContext.request.post(`${APP}/api/auth/login`, {
        data: { email: agent.email, password: `Test-${stamp}!` },
      })
    ).status(),
    200,
  );
  const ruleUrl = (id = site.id) =>
    `${APP}/api/admin/sites/${id}/unanswered-rule`;
  const rule = () =>
    db.unansweredRule.findUniqueOrThrow({ where: { siteId: site.id } });
  const form = merchantPage.getByRole("form", { name: "长时间未回复提醒规则" });
  const records = (id) =>
    db.unansweredReminder.findMany({
      where: { conversationId: id },
      orderBy: { remindedAt: "asc" },
    });
  const getConversation = (id) =>
    db.conversation.findUniqueOrThrow({ where: { id } });
  const scan = (now = new Date(Date.now() + 120000), cursor) =>
    service.generateUnansweredReminders(now, cursor, [team.id]);
  const counter = async (request) =>
    (await (await request.get(`${APP}/api/agent/follow-ups/count`)).json())
      .unanswered;
  const action = async (id, data, request = agentContext.request) => {
    const response = await request.post(
      `${APP}/api/agent/conversations/${id}/actions`,
      { data },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const save = async (
    changes = {},
    request = merchantPage.request,
    siteId = site.id,
  ) => {
    const current = await db.unansweredRule.findUnique({ where: { siteId } });
    return request.post(ruleUrl(siteId), {
      data: {
        enabled: true,
        ownerId: merchant.id,
        recipientMode: "ASSIGNED_OR_OWNER",
        delayMinutes: 1,
        expectedVersion: current?.version ?? 0,
        ...changes,
      },
    });
  };
  let sequence = 0,
    old,
    first,
    fallback;
  const visitor = async () => {
    const response = await page.request.post(`${APP}/api/widget/session`, {
      data: {
        key: site.publicKey,
        localKey: `unanswered-${stamp}-${++sequence}`,
        email: `unanswered-${stamp}-${sequence}@test.local`,
        name: `未回复访客-${sequence}`,
      },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const send = async (identity, body = "请人工协助处理", extra = {}) => {
    const response = await page.request.post(`${APP}/api/widget/conversation`, {
      headers: { Authorization: `Bearer ${identity.token}` },
      data: { body, ...extra },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const conversation = async () => {
    const identity = await visitor(),
      result = await send(identity);
    return { id: result.conversation.id, identity, result };
  };
  try {
    await test("unanswered rules are disabled by default and enabling does not backfill earlier waiting rounds", async () => {
      const defaults = await (await merchantPage.request.get(ruleUrl())).json();
      assert.deepEqual(defaults.rule, {
        enabled: false,
        ownerId: "",
        recipientMode: "ASSIGNED_OR_OWNER",
        delayMinutes: 10,
        version: 0,
      });
      old = await conversation();
      await merchantPage.goto(
        `${APP}${ADMIN}/follow-ups/rules?siteId=${site.id}`,
      );
      await form.waitFor();
      await axe(merchantPage);
      await form.getByLabel("启用未回复提醒", { exact: true }).check();
      await form
        .getByLabel("默认提醒负责人", { exact: true })
        .selectOption(merchant.id);
      await form.getByLabel("等待时长（分钟）", { exact: true }).fill("1");
      await form
        .getByRole("button", { name: "保存未回复提醒规则", exact: true })
        .click();
      await form.getByRole("status").filter({ hasText: "已保存" }).waitFor();
      assert.equal((await rule()).version, 1);
      await scan();
      assert.equal((await records(old.id)).length, 0);
      assert.equal(await db.followUpRule.count(), 0);
      const config = await (
        await page.request.get(`${APP}/api/widget/config?key=${site.publicKey}`)
      ).json();
      assert.equal(JSON.stringify(config).includes("unanswered"), false);
    });
    await test("visitor bursts, reads, internal notes and AI preserve one waiting timer; the current agent receives the due reminder", async () => {
      first = await conversation();
      const before = await getConversation(first.id);
      await send(first.identity, "补充消息");
      await action(first.id, { action: "claim" });
      await action(first.id, { action: "read" });
      await action(first.id, { action: "note", body: "正在内部核对" });
      await db.message.create({
        data: {
          conversationId: first.id,
          sender: "AI",
          type: "TEXT",
          body: "AI 初步答复",
        },
      });
      const after = await getConversation(first.id);
      assert.equal(after.waitingMessageId, before.waitingMessageId);
      assert.equal(after.waitingSince.getTime(), before.waitingSince.getTime());
      assert.equal(
        (await scan(new Date(before.waitingSince.getTime() + 59999))).created,
        0,
      );
      await scan(new Date(before.waitingSince.getTime() + 60000));
      const rows = await records(first.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].recipientId, agent.id);
      assert.equal(await counter(agentContext.request), 1);
      assert.equal(await counter(merchantPage.request), 0);
      const audit = await db.auditLog.findMany({
        where: { targetId: rows[0].id },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].tenantId, team.id);
      assert.equal(audit[0].action, "unanswered.remind");
      assert.equal(JSON.stringify(audit[0].meta).includes("补充消息"), false);
      assert.equal("waitingSince" in first.result.conversation, false);
      await agentPage.goto(`${APP}/agent?c=${first.id}`);
      await agentPage
        .getByRole("link", { name: "未回复提醒，待处理 1 项", exact: true })
        .waitFor();
      await agentPage
        .getByRole("link", { name: "未回复提醒，待处理 1 项", exact: true })
        .click();
      await agentPage
        .getByRole("article", { name: `未回复提醒 ${rows[0].id}`, exact: true })
        .waitFor();
    });
    await test("parallel scanners and repeated visitor messages deduplicate reminders; unassigned conversations use the fallback owner", async () => {
      fallback = await conversation();
      await Promise.all([scan(), scan()]);
      const rows = await records(fallback.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].recipientId, merchant.id);
      await send(fallback.identity, "仍在等待人工回复");
      await scan();
      assert.equal((await records(fallback.id)).length, 1);
      assert.equal(
        await db.auditLog.count({
          where: { targetId: rows[0].id, action: "unanswered.remind" },
        }),
        1,
      );
      await action(fallback.id, { action: "read" });
      assert.equal(await counter(merchantPage.request), 1);
    });
    await test("a real workbench reply resolves the reminder immediately and a later visitor message starts a fresh round", async () => {
      await agentPage.goto(`${APP}/agent?c=${first.id}`);
      await agentPage
        .getByPlaceholder("输入消息，Enter 发送，Shift+Enter 换行", {
          exact: true,
        })
        .fill("人工回复验收");
      await agentPage
        .getByPlaceholder("输入消息，Enter 发送，Shift+Enter 换行", {
          exact: true,
        })
        .press("Enter");
      await until(
        async () => (await getConversation(first.id)).waitingMessageId === null,
        "Public reply clears waiting round",
      );
      await agentPage
        .getByRole("link", { name: "未回复提醒，待处理 0 项", exact: true })
        .waitFor();
      assert.equal((await records(first.id))[0].resolution, "REPLIED");
      assert.equal(await counter(agentContext.request), 0);
      await scan();
      assert.equal((await records(first.id)).length, 1);
      await send(first.identity, "第二轮咨询");
      await scan();
      const rows = await records(first.id);
      assert.equal(rows.length, 2);
      assert.notEqual(rows[0].waitingMessageId, rows[1].waitingMessageId);
      assert.equal(rows[1].recipientId, agent.id);
      assert.equal(await counter(agentContext.request), 1);
    });
    await test("closing a conversation ends its reminder and reopening alone does not start another wait", async () => {
      await action(first.id, { action: "close" });
      assert.equal((await records(first.id))[1].resolution, "CLOSED");
      assert.equal((await getConversation(first.id)).waitingSince, null);
      await action(first.id, { action: "reopen" });
      await scan();
      assert.equal((await records(first.id)).length, 2);
      assert.equal(await counter(agentContext.request), 0);
      await send(first.identity, "结束后新咨询");
      await scan();
      assert.equal((await records(first.id)).length, 3);
      await action(first.id, { action: "close" });
    });
    await test("configuration rejects unauthorized users, foreign sites and owners; stale forms require reload", async () => {
      assert.equal((await page.request.get(ruleUrl())).status(), 401);
      assert.equal((await agentContext.request.get(ruleUrl())).status(), 403);
      assert.equal((await save({}, agentContext.request)).status(), 403);
      assert.equal(
        (await merchantPage.request.get(ruleUrl(foreign.sites[0].id))).status(),
        404,
      );
      assert.equal(
        (await save({}, merchantPage.request, foreign.sites[0].id)).status(),
        404,
      );
      assert.equal((await save({ ownerId: platform.id })).status(), 400);
      assert.equal(
        (
          await save({ ownerId: agent.id }, merchantPage.request, otherSite.id)
        ).status(),
        400,
      );
      const firstSaves = await Promise.all(
        [1, 2].map(() =>
          platformPage.request.post(ruleUrl(foreign.sites[0].id), {
            data: {
              enabled: false,
              ownerId: "",
              recipientMode: "OWNER",
              delayMinutes: 10,
              expectedVersion: 0,
            },
          }),
        ),
      );
      assert.deepEqual(
        firstSaves.map((response) => response.status()).sort(),
        [200, 409],
      );
      const current = await rule();
      const updates = await Promise.all(
        [1, 2].map(() => save({ expectedVersion: current.version })),
      );
      assert.deepEqual(
        updates.map((response) => response.status()).sort(),
        [200, 409],
      );
      await form
        .getByRole("button", { name: "保存未回复提醒规则", exact: true })
        .click();
      await form
        .getByRole("alert")
        .filter({ hasText: "配置已被其他管理员更新" })
        .waitFor();
      await form
        .getByRole("button", { name: "重新加载配置", exact: true })
        .click();
      await form
        .getByRole("button", { name: "保存未回复提醒规则", exact: true })
        .waitFor();
    });
    await test("recipient modes and invalid member permissions control delivery without crossing tenant boundaries", async () => {
      assert.equal((await save({ recipientMode: "OWNER" })).status(), 200);
      const fixed = await conversation();
      await action(fixed.id, { action: "claim" });
      await scan();
      assert.equal((await records(fixed.id))[0].recipientId, merchant.id);
      assert.equal((await save()).status(), 200);
      const invalid = await conversation();
      await db.user.update({
        where: { id: merchant.id },
        data: { active: false },
      });
      await scan();
      assert.equal((await records(invalid.id)).length, 0);
      const assigned = await conversation();
      await action(assigned.id, { action: "claim" });
      await scan();
      assert.equal((await records(assigned.id))[0].recipientId, agent.id);
      await db.siteAgent.deleteMany({
        where: { userId: agent.id, siteId: site.id },
      });
      assert.equal(await counter(agentContext.request), 0);
      await agentPage.goto(`${APP}/agent/unanswered`);
      await agentPage
        .getByText("暂无符合条件的未回复提醒", { exact: true })
        .waitFor();
      await db.siteAgent.create({
        data: { userId: agent.id, siteId: site.id },
      });
      await db.user.update({
        where: { id: merchant.id },
        data: { active: true },
      });
      await scan();
      assert.equal((await records(invalid.id))[0].recipientId, merchant.id);
    });
    await test("audit failures roll back configuration and reminder creation", async () => {
      const pending = await conversation(),
        before = await rule();
      const failing = unansweredService({
        $queryRaw: (...args) => db.$queryRaw(...args),
        $transaction: (run) =>
          db.$transaction((tx) =>
            run(
              new Proxy(tx, {
                get(target, key) {
                  return key === "auditLog"
                    ? {
                        create: async () => {
                          throw Error("audit unavailable");
                        },
                      }
                    : target[key];
                },
              }),
            ),
          ),
      });
      await assert.rejects(
        failing.saveUnansweredRule(actor, site.id, {
          enabled: false,
          ownerId: "",
          recipientMode: "OWNER",
          delayMinutes: 5,
          expectedVersion: before.version,
        }),
        /audit unavailable/,
      );
      assert.deepEqual(await rule(), before);
      await assert.rejects(
        failing.generateUnansweredReminders(
          new Date(Date.now() + 120000),
          undefined,
          [team.id],
        ),
        /audit unavailable/,
      );
      assert.equal((await records(pending.id)).length, 0);
      await scan();
      assert.equal((await records(pending.id)).length, 1);
    });
    await test("a reply or rule disable racing a locked scan leaves no active reminder behind", async () => {
      for (const operation of ["reply", "disable"]) {
        const pending = await conversation();
        let entered, release;
        const atInsert = new Promise((resolve) => {
          entered = resolve;
        });
        const resume = new Promise((resolve) => {
          release = resolve;
        });
        const gated = unansweredService({
          $queryRaw: (...args) => db.$queryRaw(...args),
          $transaction: (run) =>
            db.$transaction((tx) =>
              run(
                new Proxy(tx, {
                  get(target, key) {
                    if (key !== "unansweredReminder") return target[key];
                    return new Proxy(target[key], {
                      get(delegate, method) {
                        if (method !== "createMany") return delegate[method];
                        return async (args) => {
                          entered();
                          await resume;
                          return delegate.createMany(args);
                        };
                      },
                    });
                  },
                }),
              ),
            ),
        });
        const generating = gated.generateUnansweredReminders(
          new Date(Date.now() + 120000),
          undefined,
          [team.id],
        );
        await Promise.race([
          atInsert,
          generating.then(() => {
            throw Error("Scan finished before concurrency barrier");
          }),
        ]);
        const changing =
          operation === "reply"
            ? merchantPage.request.post(
                `${APP}/api/agent/conversations/${pending.id}/messages`,
                { data: { body: "扫描并发中的人工回复" } },
              )
            : save({ enabled: false });
        try {
          await until(
            async () => {
              const blocked =
                await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE '%UnansweredRule%' OR query LIKE '%Conversation%')`;
              return blocked[0].count > 0;
            },
            "Concurrent change reaches the database lock",
            2000,
          );
        } finally {
          release();
        }
        await generating;
        const response = await changing;
        assert.equal(response.status(), 200, await response.text());
        const rows = await records(pending.id);
        assert.equal(rows.length, 1);
        assert.equal(
          rows[0].resolution,
          operation === "reply" ? "REPLIED" : "DISABLED",
        );
        assert.ok(rows[0].resolvedAt);
        if (operation === "disable") assert.equal((await save()).status(), 200);
      }
    });
    await test("disabling archives active reminders and re-enabling does not revive the old waiting round", async () => {
      const waiting = await conversation();
      await scan();
      assert.equal((await records(waiting.id)).length, 1);
      assert.equal((await save({ enabled: false })).status(), 200);
      assert.equal(await counter(agentContext.request), 0);
      assert.equal(await counter(merchantPage.request), 0);
      assert.equal((await records(waiting.id))[0].resolution, "DISABLED");
      assert.equal((await save()).status(), 200);
      await send(waiting.identity, "原轮次继续补充");
      await scan();
      assert.equal((await records(waiting.id)).length, 1);
      const next = await conversation();
      await scan();
      assert.equal((await records(next.id)).length, 1);
      const hidden = await conversation();
      await db.site.update({ where: { id: site.id }, data: { active: false } });
      await scan();
      assert.equal((await records(hidden.id)).length, 0);
      assert.equal(await counter(merchantPage.request), 0);
      await db.site.update({ where: { id: site.id }, data: { active: true } });
      await db.tenant.update({
        where: { id: team.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await scan();
      assert.equal((await records(hidden.id)).length, 0);
      await db.tenant.update({
        where: { id: team.id },
        data: { expiresAt: null },
      });
    });
    await test("bounded scans advance their cursor and reminder lists paginate with scoped filters", async () => {
      const enabledAt = (await rule()).enabledAt,
        now = new Date(enabledAt.getTime() + 300000);
      const testVisitor = await db.visitor.findFirstOrThrow({
        where: { siteId: site.id },
      });
      await db.conversation.createMany({
        data: Array.from({ length: 105 }, (_, i) => ({
          id: `z-unanswered-${stamp}-${String(i).padStart(3, "0")}`,
          siteId: site.id,
          visitorId: testVisitor.id,
          subject: `batch-${stamp}`,
          waitingSince: new Date(enabledAt.getTime() + 1000),
          waitingMessageId: `batch-message-${stamp}-${i}`,
        })),
      });
      const firstBatch = await scan(now);
      assert.ok(firstBatch.cursor);
      assert.equal(firstBatch.created, 100);
      const secondBatch = await scan(now, firstBatch.cursor);
      assert.equal(secondBatch.cursor, undefined);
      assert.ok(secondBatch.created >= 5);
      const list = await service.listUnansweredReminders(
        actor,
        {
          query: `batch-${stamp}`,
          siteId: site.id,
          status: "ACTIVE",
          mine: "",
        },
        2,
      );
      assert.equal(list.total, 105);
      assert.equal(list.rows.length, 20);
      assert.equal(list.page, 2);
      await merchantPage.goto(
        `${APP}${ADMIN}/follow-ups/unanswered?query=batch-${stamp}&siteId=${site.id}&page=2`,
      );
      await merchantPage
        .getByText("共 105 条 · 第 2 / 6 页", { exact: true })
        .waitFor();
      await merchantPage
        .getByRole("link", { name: "下一页", exact: true })
        .click();
      await merchantPage
        .getByText("共 105 条 · 第 3 / 6 页", { exact: true })
        .waitFor();
      assert.equal(
        new URL(merchantPage.url()).searchParams.get("query"),
        `batch-${stamp}`,
      );
      assert.equal(
        await db.unansweredReminder.count({ where: { tenantId: foreign.id } }),
        0,
      );
    });
    await test("reminder lists and both rule forms work on mobile in light and dark themes", async () => {
      await merchantPage.setViewportSize({ width: 390, height: 844 });
      for (const theme of ["light", "dark"]) {
        await merchantPage.evaluate((value) => {
          document.documentElement.classList.toggle("dark", value === "dark");
          document.documentElement.style.colorScheme = value;
        }, theme);
        await axe(merchantPage);
        await merchantPage.screenshot({
          path: `${artifacts}/unanswered-list-${theme}.png`,
          fullPage: true,
        });
      }
      await merchantPage.goto(
        `${APP}${ADMIN}/follow-ups/rules?siteId=${site.id}`,
      );
      await form.waitFor();
      for (const theme of ["light", "dark"]) {
        await merchantPage.evaluate((value) => {
          document.documentElement.classList.toggle("dark", value === "dark");
          document.documentElement.style.colorScheme = value;
        }, theme);
        await axe(merchantPage);
        await merchantPage.screenshot({
          path: `${artifacts}/unanswered-rules-${theme}.png`,
          fullPage: true,
        });
      }
      assert.deepEqual(errors, []);
    });
  } catch (error) {
    await merchantPage
      .screenshot({
        path: `${artifacts}/unanswered-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await agentContext.close();
  }
}
