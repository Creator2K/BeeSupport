import assert from "node:assert/strict";
import { cannedService } from "../tests/canned-fixtures.mjs";

/** All records live in the harness's disposable database. No outbound messages are created. */
export async function runCannedChecks({
  db,
  browser,
  APP,
  ADMIN,
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
  const prefix = `canned-${stamp}`;
  const service = cannedService(db);
  const owner = { ...merchant, siteIds: null };
  const site = team.sites[0];
  const secondSite = await db.site.create({
    data: { tenantId: team.id, name: "未授权站点", slug: `${prefix}-second` },
  });
  const foreign = await db.tenant.create({
    data: {
      name: "另一个商家",
      slug: `${prefix}-foreign`,
      sites: { create: { name: "外部站点", slug: `${prefix}-foreign` } },
    },
    include: { sites: true },
  });
  const colleague = await db.user.create({
    data: {
      tenantId: team.id,
      email: `${prefix}-manager@test.local`,
      name: "同事管理员",
      role: "MERCHANT_ADMIN",
      passwordHash: merchant.passwordHash,
    },
  });
  const agent = await db.user.create({
    data: {
      tenantId: team.id,
      email: `${prefix}-agent@test.local`,
      name: "话术验收客服",
      role: "AGENT",
      passwordHash: merchant.passwordHash,
      sites: { create: { siteId: site.id } },
    },
  });
  const makeReply = (suffix, data = {}) =>
    db.cannedResponse.create({
      data: {
        tenantId: team.id,
        title: `${prefix}-${suffix}`,
        content: `内容-${suffix}`,
        ownerId: merchant.id,
        shared: true,
        category: "售后",
        ...data,
      },
    });
  const global = await makeReply("全局问候", {
    shortcut: "greeting",
    category: "售前",
    content: "您好，很高兴为您服务。",
  });
  const scoped = await makeReply("当前站点", {
    siteId: site.id,
    shortcut: "aftercare",
  });
  const restricted = await makeReply("未授权站点", { siteId: secondSite.id });
  const ownPrivate = await makeReply("自己的私有话术", {
    shared: false,
    category: "我的分类",
  });
  const otherPrivate = await makeReply("同事的私有话术", {
    shared: false,
    ownerId: colleague.id,
    category: "机密分类",
  });
  const foreignReply = await makeReply("外部商家", {
    tenantId: foreign.id,
    siteId: null,
  });
  const conversations = [];
  for (const name of ["A", "B"]) {
    const visitor = await db.visitor.create({
      data: {
        siteId: site.id,
        email: `${prefix}-${name}@test.local`,
        localKey: `${prefix}-${name}`,
        name: `访客${name}`,
      },
    });
    conversations.push(
      await db.conversation.create({
        data: {
          siteId: site.id,
          visitorId: visitor.id,
          status: "OPEN",
          assignedAgentId: agent.id,
          lastMessagePreview: `咨询${name}`,
          messages: {
            create: { sender: "VISITOR", body: `咨询${name}`, type: "TEXT" },
          },
        },
      }),
    );
  }
  const context = await browser.newContext();
  const login = await context.request.post(`${APP}/api/auth/login`, {
    data: { email: agent.email, password: `Test-${stamp}!` },
  });
  assert.equal(login.status(), 200);
  const agentPage = await context.newPage();
  agentPage.setDefaultTimeout(15000);
  const errors = [];
  agentPage.on("pageerror", (error) => errors.push(error.message));
  const list = (p, siteId) =>
    p.request.get(`${APP}/api/agent/canned?${new URLSearchParams({ siteId })}`);
  const use = (id, siteId = site.id) =>
    context.request.post(`${APP}/api/agent/canned`, { data: { id, siteId } });
  const composer = agentPage.getByPlaceholder(
    "输入消息，Enter 发送，Shift+Enter 换行",
    { exact: true },
  );
  const popup = agentPage.getByRole("dialog", {
    name: "快捷话术",
    exact: true,
  });
  const search = popup.getByRole("textbox", { name: "搜索话术…", exact: true });
  const replyButton = (title) =>
    popup.getByRole("button").filter({ hasText: title });
  async function open(query = "") {
    await agentPage
      .getByRole("button", { name: "快捷话术", exact: true })
      .click();
    await popup.waitFor();
    await popup
      .getByRole("combobox", { name: "话术分类", exact: true })
      .selectOption("");
    await search.fill(query);
  }
  try {
    await test("private replies, other merchant globals and unauthorized sites are excluded by the server", async () => {
      const result = await list(agentPage, site.id);
      assert.equal(result.status(), 200);
      assert.equal(result.headers()["cache-control"], "no-store");
      const data = await result.json();
      const ids = data.items.map((item) => item.id);
      assert.ok(ids.includes(global.id));
      assert.ok(ids.includes(scoped.id));
      for (const item of [restricted, ownPrivate, otherPrivate, foreignReply])
        assert.ok(!ids.includes(item.id));
      assert.ok(!data.categories.includes("机密分类"));
      const own = await (await list(merchantPage, site.id)).json();
      assert.ok(own.items.some((item) => item.id === ownPrivate.id));
      assert.ok(!own.items.some((item) => item.id === otherPrivate.id));
      const platformItems = await (await list(platformPage, site.id)).json();
      assert.ok(platformItems.items.some((item) => item.id === global.id));
      assert.ok(
        !platformItems.items.some((item) => item.id === foreignReply.id),
      );
      const platformDefault = await (
        await platformPage.request.get(`${APP}/api/agent/canned`)
      ).json();
      assert.ok(
        !platformDefault.items.some((item) => item.id === foreignReply.id),
      );
    });
    await test("usage requests enforce visibility and current site authorization before updating counts", async () => {
      const before = await db.cannedResponse.findUniqueOrThrow({
        where: { id: scoped.id },
      });
      const response = await use(scoped.id);
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).item.content, scoped.content);
      assert.equal(
        (
          await db.cannedResponse.findUniqueOrThrow({
            where: { id: scoped.id },
          })
        ).usageCount,
        before.usageCount + 1,
      );
      for (const id of [
        ownPrivate.id,
        otherPrivate.id,
        restricted.id,
        foreignReply.id,
      ])
        assert.equal((await use(id)).status(), 404);
      assert.equal((await use(restricted.id, secondSite.id)).status(), 403);
      assert.equal(
        (await use(foreignReply.id, foreign.sites[0].id)).status(),
        403,
      );
      assert.equal(
        (
          await context.request.post(`${APP}/api/agent/canned`, {
            data: { id: global.id },
          })
        ).status(),
        422,
      );
      assert.equal(
        (
          await db.cannedResponse.findUniqueOrThrow({
            where: { id: otherPrivate.id },
          })
        ).usageCount,
        0,
      );
      await assert.rejects(
        service.saveCannedReply(
          owner,
          { title: "伪造", content: "禁止" },
          otherPrivate.id,
        ),
        { status: 404 },
      );
      await assert.rejects(service.deleteCannedReply(owner, otherPrivate.id), {
        status: 404,
      });
    });
    await test("simultaneous case-insensitive shortcut creation permits one reply and keeps platform edits in the correct tenant", async () => {
      const shortcut = `race-${stamp}`;
      const data = {
        title: `${prefix}-并发`,
        content: "并发内容",
        siteId: site.id,
        shortcut,
      };
      const outcomes = await Promise.allSettled([
        service.saveCannedReply(owner, data),
        service.saveCannedReply(owner, {
          ...data,
          shortcut: shortcut.toUpperCase(),
        }),
      ]);
      assert.equal(
        outcomes.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        outcomes.find((result) => result.status === "rejected").reason.status,
        409,
      );
      const created = await db.cannedResponse.findFirstOrThrow({
        where: { tenantId: team.id, shortcut },
      });
      assert.equal(
        await db.auditLog.count({
          where: {
            targetId: created.id,
            action: "canned.create",
            tenantId: team.id,
          },
        }),
        1,
      );
      const platformOwned = await service.saveCannedReply(
        { ...platform, siteIds: null },
        {
          title: `${prefix}-平台代配`,
          content: "正确归属",
          siteId: foreign.sites[0].id,
        },
      );
      assert.equal(
        (
          await db.cannedResponse.findUniqueOrThrow({
            where: { id: platformOwned.id },
          })
        ).tenantId,
        foreign.id,
      );
      assert.equal(
        await db.auditLog.count({
          where: { targetId: platformOwned.id, tenantId: foreign.id },
        }),
        1,
      );
      await assert.rejects(
        service.saveCannedReply(
          owner,
          { title: "跨商家", content: "禁止", siteId: foreign.sites[0].id },
          scoped.id,
        ),
        { status: 403 },
      );
    });
    await test("administrators can create and edit a categorized private reply with clear visibility controls", async () => {
      await merchantPage.goto(`${APP}${ADMIN}/canned`);
      await merchantPage
        .getByRole("button", { name: "新建话术", exact: true })
        .click();
      const dialog = merchantPage.getByRole("dialog");
      const title = `${prefix}-界面私用`;
      await dialog.getByLabel("话术标题", { exact: true }).fill(title);
      await dialog
        .getByLabel("话术内容", { exact: true })
        .fill("界面创建的私有内容");
      await dialog.getByLabel("话术分类", { exact: true }).fill("界面分类");
      await dialog
        .getByRole("switch", { name: "团队共享", exact: true })
        .uncheck();
      await axe(merchantPage);
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await until(
        async () =>
          (await db.cannedResponse.count({
            where: {
              title,
              shared: false,
              ownerId: merchant.id,
              category: "界面分类",
            },
          })) === 1,
        "private reply saved",
      );
      await merchantPage.goto(
        `${APP}${ADMIN}/canned?query=${encodeURIComponent(title)}`,
      );
      await merchantPage
        .locator("tbody tr")
        .getByText("仅自己可见", { exact: true })
        .waitFor();
      await merchantPage
        .getByRole("button", { name: `编辑 ${title}`, exact: true })
        .click();
      await merchantPage
        .getByRole("menuitem", { name: "编辑", exact: true })
        .click();
      await dialog.getByLabel("话术分类", { exact: true }).fill("更新分类");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const row = await db.cannedResponse.findFirstOrThrow({
        where: { title },
      });
      assert.equal(row.category, "更新分类");
      const colleagues = await service.listManagedCanned(
        { ...colleague, siteIds: null },
        { query: title },
      );
      assert.equal(colleagues.total, 0);
      await axe(merchantPage);
    });
    await test("admin search, category and visibility pagination preserve conditions and the agent picker has a bounded search", async () => {
      const pagePrefix = `page-${stamp}`;
      await db.cannedResponse.createMany({
        data: Array.from({ length: 56 }, (_, n) => ({
          tenantId: team.id,
          ownerId: merchant.id,
          title: `${pagePrefix}-${String(n).padStart(2, "0")}`,
          content: `分页回复${n}`,
          category: "分页分类",
          shared: true,
        })),
      });
      const query = new URLSearchParams({
        query: pagePrefix,
        category: "分页分类",
        visibility: "shared",
      });
      await merchantPage.goto(`${APP}${ADMIN}/canned?${query}`);
      await merchantPage
        .getByText("共 56 条 · 第 1 / 3 页", { exact: true })
        .waitFor();
      assert.equal(await merchantPage.locator("tbody tr").count(), 20);
      await merchantPage
        .getByRole("link", { name: "下一页", exact: true })
        .click();
      await merchantPage
        .getByText("共 56 条 · 第 2 / 3 页", { exact: true })
        .waitFor();
      for (const [key, value] of query)
        assert.equal(new URL(merchantPage.url()).searchParams.get(key), value);
      const response = await context.request.get(
        `${APP}/api/agent/canned?${new URLSearchParams({ siteId: site.id, category: "分页分类" })}`,
      );
      const result = await response.json();
      assert.equal(result.items.length, 50);
      assert.equal(result.hasMore, true);
      const exact = await context.request.get(
        `${APP}/api/agent/canned?${new URLSearchParams({ siteId: site.id, query: `${pagePrefix}-55` })}`,
      );
      assert.equal((await exact.json()).items.length, 1);
    });
    await test("slash shortcuts insert into the draft without sending, preserve existing text and use current server content", async () => {
      await agentPage.goto(`${APP}/agent?c=${conversations[0].id}`);
      await composer.waitFor();
      await until(async () => !(await composer.isDisabled()), "composer ready");
      await composer.fill("");
      await composer.press("/");
      await popup.waitFor();
      assert.equal(await composer.inputValue(), "");
      await search.fill("/greeting");
      await replyButton(global.title).waitFor();
      await search.press("Enter");
      await until(
        async () => (await composer.inputValue()) === global.content,
        "slash reply inserted",
      );
      assert.equal(
        await db.message.count({
          where: { conversationId: conversations[0].id },
        }),
        1,
      );
      await composer.fill("已有草稿");
      await open(scoped.title);
      await replyButton(scoped.title).click();
      await until(
        async () =>
          (await composer.inputValue()) === `已有草稿\n${scoped.content}`,
        "existing draft retained",
      );
      await open(global.title);
      await replyButton(global.title).waitFor();
      await db.cannedResponse.update({
        where: { id: global.id },
        data: { content: "服务器最新内容" },
      });
      await replyButton(global.title).click();
      await until(
        async () => (await composer.inputValue()).endsWith("服务器最新内容"),
        "fresh content used",
      );
      await open(global.title);
      await replyButton(global.title).waitFor();
      const draft = await composer.inputValue();
      const count = (
        await db.cannedResponse.findUniqueOrThrow({ where: { id: global.id } })
      ).usageCount;
      await db.cannedResponse.update({
        where: { id: global.id },
        data: { shared: false },
      });
      await replyButton(global.title).click();
      await agentPage
        .getByText("话术已删除或不可用，请重新选择", { exact: true })
        .waitFor();
      assert.equal(await composer.inputValue(), draft);
      assert.equal(
        (
          await db.cannedResponse.findUniqueOrThrow({
            where: { id: global.id },
          })
        ).usageCount,
        count,
      );
      await agentPage.keyboard.press("Escape");
      await db.cannedResponse.update({
        where: { id: global.id },
        data: { shared: true },
      });
    });
    await test("a delayed insert stays with its original conversation after switching chats", async () => {
      await composer.fill("A的草稿");
      await open(scoped.title);
      await replyButton(scoped.title).waitFor();
      let release, captured;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const started = new Promise((resolve) => {
        captured = resolve;
      });
      await agentPage.route("**/api/agent/canned", async (route) => {
        if (route.request().method() === "POST") {
          captured();
          await gate;
        }
        await route.continue();
      });
      try {
        await replyButton(scoped.title).click();
        await started;
        await agentPage.keyboard.press("Escape");
        await agentPage
          .getByRole("button")
          .filter({ hasText: "访客B" })
          .first()
          .click();
        await until(
          async () =>
            new URL(agentPage.url()).searchParams.get("c") ===
            conversations[1].id,
          "switched to B",
        );
        await composer.fill("B的草稿");
        release();
        await until(
          async () =>
            await agentPage.evaluate(
              ({ key, text }) =>
                Object.keys(localStorage)
                  .filter((k) => k.includes(key))
                  .some((k) => (localStorage.getItem(k) ?? "").includes(text)),
              { key: conversations[0].id, text: "A的草稿" },
            ),
          "A draft persisted",
        );
        // Wait for the insertion request and its component state update before revisiting A.
        await until(
          async () =>
            (
              await db.cannedResponse.findUniqueOrThrow({
                where: { id: scoped.id },
              })
            ).usageCount >= 3,
          "delayed insert completed",
        );
        assert.equal(await composer.inputValue(), "B的草稿");
        await agentPage
          .getByRole("button")
          .filter({ hasText: "访客A" })
          .first()
          .click();
        await until(
          async () =>
            (await composer.inputValue()) === `A的草稿\n${scoped.content}`,
          "reply kept in A",
        );
      } finally {
        release();
        await agentPage.unroute("**/api/agent/canned");
      }
    });
    await test("admin and reply picker support mobile light and dark layouts with accessible forms", async () => {
      await merchantPage.setViewportSize({ width: 375, height: 812 });
      await agentPage.setViewportSize({ width: 375, height: 812 });
      for (const theme of ["light", "dark"]) {
        for (const p of [merchantPage, agentPage])
          await p.evaluate((value) => {
            localStorage.setItem("theme", value);
            document.documentElement.classList.toggle("dark", value === "dark");
          }, theme);
        await merchantPage.goto(`${APP}${ADMIN}/canned?query=${prefix}`);
        await merchantPage
          .getByRole("heading", { name: "快捷话术", exact: true })
          .waitFor();
        await axe(merchantPage);
        await merchantPage.screenshot({
          path: `${artifacts}/canned-admin-${theme}.png`,
          fullPage: true,
        });
        await agentPage.goto(`${APP}/agent?c=${conversations[0].id}`);
        await composer.waitFor();
        await open(scoped.title);
        await replyButton(scoped.title).waitFor();
        await axe(agentPage);
        await agentPage.screenshot({
          path: `${artifacts}/canned-picker-${theme}.png`,
          fullPage: true,
        });
        await agentPage.keyboard.press("Escape");
      }
      assert.deepEqual(errors, []);
    });
  } catch (error) {
    await agentPage
      .screenshot({
        path: `${artifacts}/canned-failure-agent.png`,
        fullPage: true,
      })
      .catch(() => {});
    await merchantPage
      .screenshot({
        path: `${artifacts}/canned-failure-admin.png`,
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
