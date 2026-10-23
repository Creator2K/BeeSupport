import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadModule } from "../load-module.mjs";
import { useTestDatabase } from "../../scripts/test-environment.mjs";

useTestDatabase();
const { PrismaClient } = await import("@prisma/client");

test("PostgreSQL overview covers all responses, report time zones and DST regardless of connection time zone", async () => {
  const prisma = new PrismaClient();
  const stamp = randomUUID();
  let site;
  const now = new Date("2010-04-15T16:30:00Z");
  const statsFor = (zone, sessionZone, moment = now) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${sessionZone}, true)`;
      const { getOverviewStats } = loadModule(
        "src/server/services/overview.ts",
        {
          "../../lib/db": { prisma: tx },
          "../../lib/env": { env: { REPORT_TIMEZONE: zone } },
        },
      );
      return getOverviewStats(moment);
    });
  try {
    const pendingBefore = await prisma.conversation.count({
      where: { status: "PENDING" },
    });
    const openBefore = await prisma.conversation.count({
      where: { status: "OPEN" },
    });
    site = await prisma.site.create({
      data: {
        name: "Overview regression",
        slug: `overview-${stamp}`,
        visitors: {
          create: { email: "overview@example.com", localKey: stamp },
        },
      },
      include: { visitors: { select: { id: true } } },
    });
    const base = {
      siteId: site.id,
      visitorId: site.visitors[0].id,
      status: "CLOSED",
      createdAt: new Date("2010-04-15T12:00:00Z"),
    };
    const rows = Array.from({ length: 240 }, (_, index) => ({
      ...base,
      firstResponseAt: new Date(base.createdAt.getTime() + (index + 1) * 1000),
      closedAt: new Date("2010-04-15T16:05:00Z"),
      rating: (index % 5) + 1,
    }));
    await prisma.conversation.createMany({
      data: [
        ...rows,
        { ...base, closedAt: new Date("2010-04-15T15:59:59.999Z") },
        { ...base, closedAt: new Date("2010-04-15T16:00:00Z") },
        {
          ...base,
          createdAt: new Date(now.getTime() + 60_000),
          firstResponseAt: new Date(now.getTime() + 90_000),
          closedAt: new Date(now.getTime() + 120_000),
          rating: 5,
        },
        {
          ...base,
          createdAt: new Date(now.getTime() - 8 * 86_400_000),
          firstResponseAt: new Date(now.getTime() - 8 * 86_400_000 + 1000),
        },
        { ...base, status: "PENDING" },
        {
          ...base,
          status: "OPEN",
          firstResponseAt: new Date(now.getTime() + 1000),
        },
        { ...base, createdAt: new Date(now.getTime() - 7 * 86_400_000) },
        { ...base, createdAt: new Date(now.getTime() - 7 * 86_400_000 - 1) },
      ],
    });
    for (const sessionZone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      const result = await statsFor("Asia/Shanghai", sessionZone);
      assert.equal(result.totalConversations, 245);
      assert.equal(result.avgFirstResponseSeconds, 120.5);
      assert.equal(result.averageRating, 3);
      assert.equal(result.ratingCount, 240);
      assert.equal(result.closedToday, 241);
      assert.equal(result.pending, pendingBefore + 1);
      assert.equal(result.open, openBefore + 1);
    }
    assert.equal((await statsFor("UTC", "Asia/Tokyo")).closedToday, 242);
    await prisma.conversation.createMany({
      data: [
        "2010-11-07T03:59:59.999Z",
        "2010-11-07T04:00:00Z",
        "2010-11-07T17:00:00Z",
      ].map((closedAt) => ({
        ...base,
        createdAt: new Date("2010-11-07T03:00:00Z"),
        closedAt: new Date(closedAt),
      })),
    });
    const dst = await statsFor(
      "America/New_York",
      "Asia/Tokyo",
      new Date("2010-11-07T17:00:00Z"),
    );
    assert.equal(dst.closedToday, 2);
    assert.equal(dst.avgFirstResponseSeconds, null);
    const empty = await statsFor(
      "Asia/Shanghai",
      "UTC",
      new Date("1899-01-01T12:00:00Z"),
    );
    assert.equal(empty.totalConversations, 0);
    assert.equal(empty.averageRating, null);
    assert.equal(empty.avgFirstResponseSeconds, null);
  } finally {
    try {
      if (site) await prisma.site.delete({ where: { id: site.id } });
    } finally {
      await prisma.$disconnect();
    }
  }
});
