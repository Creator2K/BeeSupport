/** Scoped database checks; TEST_DATABASE_URL must be explicitly selected by the operator. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./test-environment.mjs";

useTestDatabase();
const { prisma } = await import("../src/lib/db.ts");
const { getVisitorAnalytics } =
  await import("../src/server/services/visitor-analytics.ts");
const { assertImageUploadSlot, approveImage, getImageGate, cancelUnsentImage } =
  await import("../src/server/services/image-review.ts");
const stamp = randomUUID().replaceAll("-", "");
const ids = [];
try {
  const site = await prisma.site.create({
    data: {
      name: `画像验收 ${stamp.slice(0, 8)}`,
      slug: `insight-${stamp}`,
      publicKey: `insight-${stamp}`,
      imageReviewEnabled: true,
    },
  });
  ids.push(site.id);
  const other = await prisma.site.create({
    data: {
      name: "画像隔离站点",
      slug: `other-${stamp}`,
      publicKey: `other-${stamp}`,
    },
  });
  ids.push(other.id);
  const now = new Date("2026-10-19T04:00:00Z");
  const one = await prisma.visitor.create({
    data: {
      siteId: site.id,
      localKey: "visitor-one",
      email: "one@example.test",
      visitCount: 3,
      pageViews: 8,
      firstSeenAt: new Date("2026-10-18T16:00:01Z"),
      lastSeenAt: now,
      meta: {
        device: "手机",
        browser: "Chrome 141",
        os: "Android 14",
        locale: "zh-CN",
      },
      profileTags: ["意向客户"],
      referrer: "https://google.example/search?a=1",
    },
  });
  await prisma.visitor.create({
    data: {
      siteId: site.id,
      localKey: "visitor-two",
      email: "two@example.test",
      visitCount: 1,
      pageViews: 2,
      firstSeenAt: new Date("2026-10-18T15:59:59Z"),
      lastSeenAt: new Date("2026-10-10T04:00:00Z"),
      meta: {
        device: "桌面端",
        browser: "Chrome 140",
        os: "Windows 10/11",
        locale: "en-US",
      },
      profileTags: ["意向客户", "意向客户"],
    },
  });
  await prisma.visitor.create({
    data: {
      siteId: site.id,
      localKey: "visitor-three",
      email: "",
      visitCount: 1,
      pageViews: 1,
      firstSeenAt: new Date("2026-01-01T00:00:00Z"),
      lastSeenAt: new Date("2026-01-01T00:00:00Z"),
      blocked: true,
    },
  });
  await prisma.visitor.create({
    data: {
      siteId: other.id,
      localKey: "visitor-other",
      email: "",
      visitCount: 99,
      pageViews: 999,
    },
  });
  const conversation = await prisma.conversation.create({
    data: { siteId: site.id, visitorId: one.id },
  });
  await prisma.conversation.create({
    data: { siteId: site.id, visitorId: one.id, status: "CLOSED" },
  });
  const data = await getVisitorAnalytics(site.id, 7, now);
  assert.deepEqual(data.totals, {
    visitors: 3,
    visits: 5,
    views: 11,
    returning: 1,
    consulted: 1,
    active7: 1,
    blocked: 1,
  });
  assert.equal(data.trend.length, 7);
  assert.equal(data.trend.find((row) => row.day === "2026-10-19").count, 1);
  assert.equal(data.trend.find((row) => row.day === "2026-10-18").count, 1);
  assert.equal(
    data.trend.reduce((sum, row) => sum + row.count, 0),
    2,
  );
  assert.deepEqual(data.browsers, [
    { label: "Chrome", count: 2 },
    { label: "未知浏览器", count: 1 },
  ]);
  assert.deepEqual(data.tags, [{ label: "意向客户", count: 2 }]);
  assert.equal(data.sites.length, 1);
  assert.equal(data.sites[0].consulted, 1);
  assert.equal(
    (await getVisitorAnalytics(`missing-${stamp}`, 7, now)).totals.visitors,
    0,
  );
  console.log(
    "✅ 整体画像：完整聚合、转化去重、站点隔离、空数据和 UTC+8 日期边界正确",
  );

  const visitor = {
    visitorId: one.id,
    siteId: site.id,
    localKey: one.localKey,
    email: one.email,
  };
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      prisma.$transaction(async (tx) => {
        assert.equal(await assertImageUploadSlot(tx, visitor), true);
        const image = await tx.attachment.create({
          data: {
            siteId: site.id,
            uploader: "VISITOR",
            uploaderId: one.id,
            filename: `${index}.png`,
            mimeType: "image/png",
            size: 1,
            storageKey: `${site.id}/test-${index}.png`,
            imageReviewState: "PENDING",
          },
        });
        await tx.visitor.update({
          where: { id: one.id },
          data: { pendingImageId: image.id },
        });
        return image;
      }),
    ),
  );
  assert.equal(
    outcomes.filter((item) => item.status === "fulfilled").length,
    1,
  );
  for (const result of outcomes.filter((item) => item.status === "rejected"))
    assert.equal(result.reason.status, 409);
  const image = outcomes.find((item) => item.status === "fulfilled").value;
  assert.equal((await getImageGate(visitor)).pending.sent, false);
  const admin = {
    id: "test-operator",
    name: "Test",
    role: "ADMIN",
    siteIds: null,
  };
  await assert.rejects(approveImage(admin, image.id), { status: 404 });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, sender: "VISITOR", type: "IMAGE" },
  });
  await prisma.attachment.update({
    where: { id: image.id },
    data: { messageId: message.id },
  });
  await assert.rejects(cancelUnsentImage(visitor, image.id), { status: 409 });
  await assert.rejects(
    approveImage({ ...admin, role: "AGENT", siteIds: [other.id] }, image.id),
    { status: 403 },
  );
  assert.equal((await approveImage(admin, image.id)).changed, true);
  assert.equal((await getImageGate(visitor)).pending, null);
  const newer = await prisma.attachment.create({
    data: {
      siteId: site.id,
      uploader: "VISITOR",
      uploaderId: one.id,
      filename: "new.png",
      mimeType: "image/png",
      size: 1,
      storageKey: `${site.id}/new.png`,
      imageReviewState: "PENDING",
    },
  });
  await prisma.visitor.update({
    where: { id: one.id },
    data: { pendingImageId: newer.id },
  });
  assert.equal((await approveImage(admin, image.id)).changed, false);
  assert.equal((await getImageGate(visitor)).pending.id, newer.id);
  await cancelUnsentImage(visitor, newer.id);
  assert.equal((await getImageGate(visitor)).pending, null);
  console.log(
    "✅ 图片名额：并发只能占一张、权限隔离、已发送不可取消、旧批准不能释放新图、未发送可恢复",
  );
} finally {
  if (ids.length) await prisma.site.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
