import assert from "node:assert/strict";
import {
  efficiencyService,
  efficiencyPolicy as policy,
} from "../tests/efficiency-fixtures.mjs";
import { reporting } from "../tests/reporting-fixtures.mjs";

export async function runEfficiencyChecks({
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
    service = efficiencyService(db),
    prefix = `efficiency-${stamp}`;
  const day = reporting.beijingDay(new Date(Date.now() - 86400000)),
    at = new Date(`${day}T00:00:00+08:00`),
    end = new Date(at.getTime() + 86400000);
  const time = (seconds) => new Date(at.getTime() + seconds * 1000),
    now = new Date(),
    future = new Date(now.getTime() + 86400000);
  const actor = { ...merchant, siteIds: [site.id] },
    platformActor = { ...platform, siteIds: null };
  const filters = { from: day, to: day, siteId: site.id, agentId: "" },
    privateText = `private-message-note-${stamp}`;
  const agentA = await db.user.create({
    data: {
      tenantId: team.id,
      name: `${prefix}-客服甲`,
      email: `${prefix}-a@test.local`,
      role: "AGENT",
      passwordHash: merchant.passwordHash,
      sites: { create: { siteId: site.id } },
    },
  });
  const agentB = await db.user.create({
    data: {
      tenantId: team.id,
      name: `${prefix}-停用客服乙`,
      email: `${prefix}-b@test.local`,
      active: false,
      role: "AGENT",
      passwordHash: merchant.passwordHash,
    },
  });
  const deleted = await db.user.create({
    data: {
      tenantId: team.id,
      name: `${prefix}-已删除客服`,
      email: `${prefix}-deleted@test.local`,
      role: "AGENT",
      passwordHash: merchant.passwordHash,
    },
  });
  const otherSite = await db.site.create({
    data: {
      tenantId: team.id,
      name: `${prefix}-第二站点`,
      slug: `${prefix}-second`,
    },
  });
  const foreign = await db.tenant.create({
    data: {
      name: `${prefix}-外部商家`,
      slug: `${prefix}-foreign`,
      sites: {
        create: { name: `${prefix}-外部站点`, slug: `${prefix}-foreign` },
      },
      users: {
        create: {
          name: `${prefix}-外部客服`,
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
      localKey: prefix,
      email: `${prefix}@test.local`,
      name: "效率统计验收访客",
      profileNote: privateText,
    },
  });
  const create = async (
    suffix,
    data = {},
    messages = [
      {
        sender: "VISITOR",
        type: "TEXT",
        createdAt: time(1),
        body: privateText,
      },
    ],
    currentSite = site,
    currentVisitor = visitor,
  ) =>
    db.conversation.create({
      data: {
        id: `${prefix}-${suffix}`,
        siteId: currentSite.id,
        visitorId: currentVisitor.id,
        createdAt: at,
        lastMessageAt: at,
        subject: `${prefix}-${suffix}`,
        note: privateText,
        ratingComment: privateText,
        ...data,
        messages: { create: messages },
      },
    });
  const reply = (seconds, type = "TEXT") => ({
    sender: "AGENT",
    type,
    createdAt: time(seconds),
    body: privateText,
  });
  const initial = {
    sender: "VISITOR",
    type: "TEXT",
    createdAt: time(1),
    body: privateText,
  };
  const one = await create(
    "closed",
    {
      assignedAgentId: agentA.id,
      status: "CLOSED",
      firstResponseAt: time(60),
      closedAt: time(600),
      rating: 5,
      ratedAt: time(900),
    },
    [initial, reply(60)],
  );
  const two = await create(
    "waiting",
    {
      assignedAgentId: agentA.id,
      status: "OPEN",
      firstResponseAt: time(180),
      waitingSince: time(300),
      waitingMessageId: `${prefix}-wait-message`,
      rating: 3,
      ratedAt: time(400),
    },
    [
      initial,
      reply(180),
      { ...initial, id: `${prefix}-wait-message`, createdAt: time(300) },
    ],
  );
  await create("legacy-pending");
  await create(
    "ai-only-closed",
    {
      assignedAgentId: agentB.id,
      status: "CLOSED",
      closedAt: time(1200),
      rating: 4,
      ratedAt: time(1300),
    },
    [
      initial,
      { ...reply(20), sender: "AI" },
      reply(30, "NOTE"),
      { ...reply(40), sender: "SYSTEM", type: "SYSTEM" },
    ],
  );
  await create(
    "legacy-image",
    {
      assignedAgentId: agentB.id,
      status: "OPEN",
      firstResponseAt: new Date(at.getTime() - 1000),
      rating: 0,
    },
    [initial, reply(300, "IMAGE"), { ...initial, createdAt: time(400) }],
  );
  await create(
    "file-invalid-close",
    {
      assignedAgentId: agentA.id,
      status: "CLOSED",
      closedAt: new Date(at.getTime() - 1000),
      rating: 6,
    },
    [initial, reply(60, "FILE")],
  );
  await create(
    "no-public",
    {
      assignedAgentId: deleted.id,
      status: "OPEN",
      firstResponseAt: future,
      rating: 5,
      ratedAt: future,
    },
    [
      {
        sender: "SYSTEM",
        type: "SYSTEM",
        createdAt: time(1),
        body: privateText,
      },
    ],
  );
  await create(
    "ai-only-open",
    {
      assignedAgentId: agentA.id,
      status: "OPEN",
      waitingSince: time(1),
      waitingMessageId: `${prefix}-ai-visitor`,
    },
    [
      { ...initial, id: `${prefix}-ai-visitor` },
      { ...reply(30), sender: "AI" },
      reply(40, "NOTE"),
    ],
  );
  await db.user.delete({ where: { id: deleted.id } });
  await create("before", { createdAt: new Date(at.getTime() - 1) }, []);
  await create("end", { createdAt: end }, []);
  await create("future", { createdAt: future }, []);
  const otherVisitor = await db.visitor.create({
    data: {
      siteId: otherSite.id,
      localKey: prefix,
      email: `${prefix}-other@test.local`,
    },
  });
  await create("other-1", {}, [initial], otherSite, otherVisitor);
  await create("other-2", {}, [initial], otherSite, otherVisitor);
  const foreignVisitor = await db.visitor.create({
    data: {
      siteId: foreign.sites[0].id,
      localKey: prefix,
      email: `${prefix}-foreign-visitor@test.local`,
    },
  });
  await create(
    "foreign",
    { assignedAgentId: foreign.users[0].id },
    [initial],
    foreign.sites[0],
    foreignVisitor,
  );
  const allActor = { ...actor, siteIds: [site.id, otherSite.id] };
  const target = (changes = {}) =>
    `${APP}${ADMIN}/efficiency?${new URLSearchParams({ ...filters, ...changes })}`;
  const expected = {
    total: 8,
    pending: 1,
    open: 4,
    closed: 3,
    waiting: 4,
    responseSamples: 4,
    avgResponseSeconds: 150,
    p90ResponseSeconds: 264,
    closeSamples: 2,
    avgCloseSeconds: 900,
    ratingSamples: 3,
    avgRating: 4,
    satisfied: 2,
  };
  const near = (value, wanted) =>
    assert.ok(Math.abs(value - wanted) < 1e-7, `${value} != ${wanted}`);
  try {
    await test("real SQL aggregates an exact cohort, valid timing samples, P90, legacy waiting states and ratings", async () => {
      const data = await service.getEfficiency(actor, filters, now);
      for (const [key, value] of Object.entries(expected))
        near(data.summary[key], value);
      assert.equal(data.siteGroups, 1);
      assert.equal(data.agentGroups, 3);
      assert.equal(data.trend.length, 1);
      assert.deepEqual(data.trend[0], { day, total: 8, waiting: 4, closed: 3 });
      assert.equal(data.sites[0].total, 8);
      assert.equal(data.agents.find((row) => row.id === agentA.id).total, 4);
      assert.equal(
        data.agents.find((row) => row.id === agentB.id).active,
        false,
      );
      assert.equal(data.agents.find((row) => row.id === null).total, 2);
      const serialized = JSON.stringify(data);
      assert.equal(serialized.includes(privateText), false);
      assert.equal(serialized.includes(visitor.email), false);
      const unchanged = await db.conversation.findUniqueOrThrow({
        where: { id: two.id },
      });
      assert.equal(unchanged.waitingMessageId, `${prefix}-wait-message`);
    });
    await test("date boundaries are Beijing-based and independent of database session timezone", async () => {
      for (const zone of ["Pacific/Honolulu", "Pacific/Kiritimati"]) {
        const data = await db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
          return efficiencyService(tx).getEfficiency(actor, filters, now);
        });
        assert.equal(data.summary.total, 8);
        near(data.summary.avgResponseSeconds, 150);
      }
      const extended = await service.getEfficiency(
        actor,
        {
          ...filters,
          from: reporting.beijingDay(new Date(at.getTime() - 86400000)),
        },
        now,
      );
      assert.equal(extended.summary.total, 9);
      assert.equal(extended.trend.length, 2);
      const withZero = await service.getEfficiency(
        actor,
        {
          ...filters,
          from: reporting.beijingDay(new Date(at.getTime() - 2 * 86400000)),
        },
        now,
      );
      assert.equal(withZero.trend[0].total, 0);
    });
    await test("merchant, site and staff scopes protect aggregates, options and direct page requests", async () => {
      assert.equal(
        (await service.getEfficiency(allActor, { ...filters, siteId: "" }, now))
          .summary.total,
        10,
      );
      assert.equal(
        (await service.getEfficiency(actor, { ...filters, siteId: "" }, now))
          .summary.total,
        8,
      );
      assert.equal(
        (
          await service.getEfficiency(
            { ...actor, siteIds: [] },
            { ...filters, siteId: "" },
            now,
          )
        ).summary.total,
        0,
      );
      assert.equal(
        (
          await service.getEfficiency(
            platformActor,
            { ...filters, siteId: "" },
            now,
          )
        ).summary.total,
        11,
      );
      for (const bad of [
        { ...filters, siteId: foreign.sites[0].id },
        { ...filters, agentId: foreign.users[0].id },
        { ...filters, siteId: "x' OR TRUE --" },
      ])
        await assert.rejects(service.getEfficiency(allActor, bad, now), {
          status: 404,
        });
      const options = await service.getEfficiencyOptions(allActor);
      assert.equal(JSON.stringify(options).includes(foreign.name), false);
      assert.ok(
        options.agents.some(
          (row) => row.id === agentB.id && row.active === false,
        ),
      );
      await merchantPage.goto(target());
      assert.equal(
        await merchantPage
          .locator(`option[value="${foreign.sites[0].id}"]`)
          .count(),
        0,
      );
      assert.equal(
        await merchantPage
          .locator(`option[value="${foreign.users[0].id}"]`)
          .count(),
        0,
      );
      await page.goto(target());
      assert.ok(new URL(page.url()).pathname.startsWith("/login"));
      const agentContext = await browser.newContext();
      try {
        assert.equal(
          (
            await agentContext.request.post(`${APP}/api/auth/login`, {
              data: { email: agentA.email, password: `Test-${stamp}!` },
            })
          ).status(),
          200,
        );
        const agentPage = await agentContext.newPage();
        await agentPage.goto(target());
        assert.equal(
          await agentPage
            .getByRole("heading", { name: "客服效率看板", exact: true })
            .count(),
          0,
        );
        await assert.rejects(
          service.getEfficiency(
            { ...agentA, siteIds: [site.id] },
            filters,
            now,
          ),
          { status: 403 },
        );
      } finally {
        await agentContext.close();
      }
    });
    await test("real filters, table samples and navigation show reconcilable metrics without exposing message content", async () => {
      await merchantPage.goto(target());
      await merchantPage
        .getByRole("heading", { name: "客服效率看板", exact: true })
        .waitFor();
      const summary = merchantPage.getByRole("region", {
        name: "客服效率汇总",
      });
      await summary.getByText("2.5 分钟", { exact: true }).waitFor();
      await summary.getByText("4.4 分钟", { exact: true }).waitFor();
      await summary.getByText("15.0 分钟", { exact: true }).waitFor();
      await summary.getByText("66.7%", { exact: true }).waitFor();
      assert.equal((await merchantPage.content()).includes(privateText), false);
      await merchantPage
        .getByRole("button", { name: "查看效率数据", exact: true })
        .click();
      await merchantPage
        .getByRole("combobox", { name: "当前／最后接待客服", exact: true })
        .selectOption(agentA.id);
      await merchantPage
        .getByRole("button", { name: "查看效率数据", exact: true })
        .click();
      await until(
        async () =>
          new URL(merchantPage.url()).searchParams.get("agentId") === agentA.id,
        "Agent filter submitted",
      );
      const group = merchantPage.getByRole("region", {
        name: "客服分组",
        exact: true,
      });
      await group
        .getByRole("rowheader", { name: agentA.name, exact: true })
        .waitFor();
      const filtered = await service.getEfficiency(
        actor,
        { ...filters, agentId: agentA.id },
        now,
      );
      assert.equal(filtered.summary.total, 4);
      near(filtered.summary.avgResponseSeconds, 100);
      await merchantPage
        .getByRole("combobox", { name: "站点", exact: true })
        .selectOption(otherSite.id);
      assert.equal(
        await merchantPage
          .getByRole("combobox", { name: "当前／最后接待客服", exact: true })
          .inputValue(),
        "",
      );
      await merchantPage
        .getByRole("button", { name: "查看效率数据", exact: true })
        .click();
      await until(
        async () =>
          new URL(merchantPage.url()).searchParams.get("siteId") ===
          otherSite.id,
        "Site filter submitted",
      );
      await merchantPage
        .getByRole("link", { name: "近 7 天", exact: true })
        .click();
      assert.equal(
        new URL(merchantPage.url()).searchParams.get("siteId"),
        otherSite.id,
      );
      await merchantPage
        .getByRole("link", { name: "重置筛选", exact: true })
        .click();
      assert.equal(new URL(merchantPage.url()).search, "");
      await merchantPage
        .getByRole("link", { name: "客服效率看板", exact: true })
        .first()
        .click();
      await merchantPage
        .getByRole("heading", { name: "客服效率看板", exact: true })
        .waitFor();
    });
    await test("empty and malformed ranges show clear states and no fabricated performance", async () => {
      const empty = await service.getEfficiency(
        allActor,
        { ...filters, siteId: otherSite.id, agentId: agentA.id },
        now,
      );
      assert.equal(empty.summary.total, 0);
      assert.equal(empty.summary.avgResponseSeconds, null);
      assert.equal(empty.summary.avgRating, null);
      await merchantPage.goto(
        target({ siteId: otherSite.id, agentId: agentA.id }),
      );
      await merchantPage
        .getByText("所选范围暂无会话", { exact: true })
        .waitFor();
      await merchantPage.goto(target({ from: "2026-02-30" }));
      await merchantPage
        .getByRole("alert")
        .filter({ hasText: "筛选条件无效" })
        .waitFor();
      assert.equal(
        await merchantPage
          .getByRole("region", { name: "客服效率汇总" })
          .count(),
        0,
      );
      await merchantPage.goto(target({ from: "2020-01-01" }));
      await merchantPage
        .getByRole("alert")
        .filter({ hasText: "90 天" })
        .waitFor();
      await merchantPage.goto(target({ siteId: foreign.sites[0].id }));
      await merchantPage
        .getByRole("alert")
        .filter({ hasText: "站点不存在或无权访问" })
        .waitFor();
      assert.equal(
        (await merchantPage.content()).includes(foreign.name),
        false,
      );
    });
    await test("real transfers change current ownership grouping while preserving cohort timing and totals", async () => {
      const transfer = (id) =>
        merchantPage.request.post(
          `${APP}/api/agent/conversations/${two.id}/actions`,
          { data: { action: "transfer", targetAgentId: id } },
        );
      const result = await transfer(merchant.id);
      assert.equal(result.status(), 200, await result.text());
      const moved = await service.getEfficiency(
        actor,
        { ...filters, agentId: merchant.id },
        now,
      );
      assert.equal(moved.summary.total, 1);
      near(moved.summary.avgResponseSeconds, 180);
      assert.equal(moved.summary.waiting, 1);
      const after = await service.getEfficiency(actor, filters, now);
      assert.equal(after.summary.total, 8);
      near(after.summary.avgResponseSeconds, 150);
      assert.equal((await transfer(agentA.id)).status(), 200);
    });
    await test("top-20 breakdowns do not truncate the summary or trend", async () => {
      const sites = await Promise.all(
        Array.from({ length: 22 }, (_, i) =>
          db.site.create({
            data: {
              tenantId: team.id,
              name: `extra-${stamp}-${i}`,
              slug: `extra-${stamp}-${i}`,
            },
          }),
        ),
      );
      for (const [i, extra] of sites.entries()) {
        const v = await db.visitor.create({
          data: {
            siteId: extra.id,
            localKey: prefix,
            email: `${prefix}-extra-${i}@test.local`,
          },
        });
        await create(`extra-${i}`, {}, [initial], extra, v);
      }
      const all = await service.getEfficiency(
        { ...actor, siteIds: [...allActor.siteIds, ...sites.map((s) => s.id)] },
        { ...filters, siteId: "" },
        now,
      );
      assert.equal(all.summary.total, 32);
      assert.equal(all.sites.length, 20);
      assert.equal(all.siteGroups, 24);
      assert.equal(all.trend[0].total, 32);
      assert.ok(
        all.sites.reduce((sum, row) => sum + row.total, 0) < all.summary.total,
      );
      await platformPage.goto(target());
      await platformPage
        .getByRole("heading", { name: "客服效率看板", exact: true })
        .waitFor();
      const platformData = await service.getEfficiency(
        platformActor,
        { ...filters, siteId: foreign.sites[0].id },
        now,
      );
      assert.equal(platformData.summary.total, 1);
      assert.equal(platformData.sites[0].tenantName, foreign.name);
    });
    await test("desktop and mobile charts, details and scrollable group tables pass light and dark accessibility checks", async () => {
      await merchantPage.goto(target());
      await merchantPage
        .getByRole("heading", { name: "客服效率看板", exact: true })
        .waitFor();
      await merchantPage.getByText("查看每日数据", { exact: true }).click();
      await merchantPage
        .getByRole("region", { name: "每日客服效率数据表", exact: true })
        .waitFor();
      for (const [device, viewport] of [
        ["desktop", { width: 1280, height: 900 }],
        ["mobile", { width: 390, height: 844 }],
      ]) {
        await merchantPage.setViewportSize(viewport);
        for (const theme of ["light", "dark"]) {
          await merchantPage.evaluate((value) => {
            document.documentElement.classList.toggle("dark", value === "dark");
            document.documentElement.style.colorScheme = value;
            window.scrollTo({ top: 0, behavior: "instant" });
          }, theme);
          await axe(merchantPage);
          await merchantPage.screenshot({
            path: `${artifacts}/efficiency-${device}-${theme}.png`,
            fullPage: true,
          });
        }
      }
      assert.equal(await db.conversation.count({ where: { id: one.id } }), 1);
    });
  } catch (error) {
    await merchantPage
      .screenshot({
        path: `${artifacts}/efficiency-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  }
}
