/**
 * 后台写入路径的数据层冒烟测试。
 *
 * Server Action 是「鉴权 + zod 校验 + 这段 Prisma 写入」的组合，
 * 浏览器里点击式的操作不好自动化，这里用与 Action 完全一致的写入形状
 * 验证数据层：字段名、JSON 结构、多对多关系、唯一约束。
 *
 *   node scripts/smoke-admin-data.mjs
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { useTestDatabase, restoreSetting } from "./test-environment.mjs";

useTestDatabase();

const prisma = new PrismaClient();
const stamp = Date.now();
const results = [];

function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? ` — ${extra}` : ""}`);
}

async function main() {
  console.log("\n▶ BeeSupport 后台写入路径数据层冒烟\n");

  // 1. 站点：创建（含 workHours JSON 与 allowedOrigins 数组）→ 更新 → 读取
  const slug = `smoke-${stamp}`;
  const site = await prisma.site.create({
    data: {
      name: "冒烟站点",
      slug,
      description: "smoke",
      primaryColor: "#18181b",
      position: "right",
      welcomeMessage: "你好",
      offlineMessage: "离线",
      requireEmail: true,
      autoAssign: false,
      notifyEmail: null,
      allowedOrigins: ["example.com", "*.example.com"],
      workHours: {
        enabled: true,
        timezone: "Asia/Shanghai",
        days: { 1: [["09:00", "18:00"]], 5: [["10:00", "19:00"]] },
      },
      active: true,
      publicKey: `bs_smoke_${stamp}`,
    },
    select: {
      id: true,
      publicKey: true,
      allowedOrigins: true,
      workHours: true,
    },
  });
  check(
    "创建站点（workHours JSON + 域名数组）",
    Array.isArray(site.allowedOrigins) &&
      site.allowedOrigins.length === 2 &&
      Boolean(site.workHours),
  );

  await prisma.site.update({
    where: { id: site.id },
    data: {
      name: "冒烟站点(改)",
      autoAssign: true,
      allowedOrigins: [],
      workHours: { enabled: false, timezone: "Asia/Shanghai", days: {} },
    },
  });
  const updatedSite = await prisma.site.findUnique({
    where: { id: site.id },
    select: { name: true, autoAssign: true, allowedOrigins: true },
  });
  check(
    "更新站点（改回不限制域名 + 关闭工作时间）",
    updatedSite?.name === "冒烟站点(改)" &&
      updatedSite.autoAssign === true &&
      updatedSite.allowedOrigins.length === 0,
  );

  // 2. 客服账号：创建 + 站点授权（SiteAgent 多对多）
  const agentEmail = `smoke-agent-${stamp}@example.com`;
  const passwordHash = await bcrypt.hash("SmokePass123!", 10);
  const agent = await prisma.user.create({
    data: {
      name: "冒烟客服",
      email: agentEmail,
      passwordHash,
      role: "AGENT",
      active: true,
      sites: { create: [{ siteId: site.id }] },
    },
    select: { id: true, sites: { select: { siteId: true } } },
  });
  check(
    "创建客服并绑定站点权限",
    agent.sites.length === 1 && agent.sites[0].siteId === site.id,
  );

  await prisma.$transaction([
    prisma.user.update({
      where: { id: agent.id },
      data: { name: "冒烟客服(改)", tokenVersion: { increment: 1 } },
    }),
    prisma.siteAgent.deleteMany({ where: { userId: agent.id } }),
    prisma.siteAgent.createMany({
      data: [{ userId: agent.id, siteId: site.id }],
      skipDuplicates: true,
    }),
  ]);
  const updatedAgent = await prisma.user.findUnique({
    where: { id: agent.id },
    select: {
      name: true,
      tokenVersion: true,
      sites: { select: { siteId: true } },
    },
  });
  check(
    "更新客服（事务内重建站点授权 + tokenVersion 自增）",
    updatedAgent?.name === "冒烟客服(改)" &&
      updatedAgent.tokenVersion === 1 &&
      updatedAgent.sites.length === 1,
  );

  // 3. 快捷话术：站点级 + 快捷码唯一性
  const canned = await prisma.cannedResponse.create({
    data: {
      title: "冒烟话术",
      content: "这是冒烟话术内容",
      shortcut: `smoke${stamp}`,
      siteId: site.id,
      shared: true,
      ownerId: agent.id,
    },
    select: { id: true, siteId: true },
  });
  check("创建站点级话术", canned.siteId === site.id);

  const duplicate = await prisma.cannedResponse.findFirst({
    where: { shortcut: `smoke${stamp}`, siteId: site.id },
    select: { id: true },
  });
  check("同站点快捷码可被唯一性校验检出", duplicate?.id === canned.id);

  // 4. 通知渠道：事件数组
  const webhook = await prisma.webhookEndpoint.create({
    data: {
      name: "冒烟渠道",
      type: "DINGTALK",
      url: "https://oapi.dingtalk.com/robot/send?access_token=smoke",
      secret: null,
      events: ["conversation.created", "conversation.offline"],
      siteId: site.id,
      active: true,
    },
    select: { id: true, events: true },
  });
  check("创建通知渠道（事件订阅数组）", webhook.events.length === 2);

  await prisma.webhookEndpoint.update({
    where: { id: webhook.id },
    data: { active: false, lastStatus: "error: smoke" },
  });
  const updatedWebhook = await prisma.webhookEndpoint.findUnique({
    where: { id: webhook.id },
    select: { active: true, lastStatus: true },
  });
  check(
    "更新渠道状态与最近推送结果",
    updatedWebhook?.active === false &&
      updatedWebhook.lastStatus === "error: smoke",
  );

  // 5. 系统设置：SMTP KV upsert（先 create 分支，再 update 分支）
  const savedSmtpSetting = await prisma.setting.findUnique({
    where: { key: "smtp" },
  });
  try {
    // Exercise create/update in isolation even if the test database already has settings.
    await prisma.setting.deleteMany({ where: { key: "smtp" } });
    await prisma.setting.upsert({
      where: { key: "smtp" },
      create: {
        key: "smtp",
        value: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "noreply@example.com",
          pass: "secret",
          from: "BeeSupport <noreply@example.com>",
        },
      },
      update: { value: { host: "unexpected.example.com" } },
    });
    const firstSetting = await prisma.setting.findUnique({
      where: { key: "smtp" },
    });
    const firstValue = firstSetting?.value;
    check(
      "系统设置 SMTP 首次写入（upsert create 分支）",
      typeof firstValue === "object" &&
        firstValue !== null &&
        firstValue.host === "smtp.example.com" &&
        firstValue.port === 465,
    );

    await prisma.setting.upsert({
      where: { key: "smtp" },
      create: { key: "smtp", value: { host: "unexpected.example.com" } },
      update: {
        value: { host: "smtp2.example.com", port: 587, secure: false },
      },
    });
    const secondSetting = await prisma.setting.findUnique({
      where: { key: "smtp" },
    });
    const secondValue = secondSetting?.value;
    check(
      "系统设置 SMTP 覆盖写入（upsert update 分支）",
      typeof secondValue === "object" &&
        secondValue !== null &&
        secondValue.host === "smtp2.example.com" &&
        secondValue.port === 587,
    );
  } finally {
    await restoreSetting(prisma, "smtp", savedSmtpSetting);
  }

  // 6. 审计日志写入
  const audit = await prisma.auditLog.create({
    data: {
      actorId: agent.id,
      actorName: "冒烟客服",
      action: "site.create",
      targetType: "Site",
      targetId: site.id,
      meta: { name: "冒烟站点" },
      ip: "127.0.0.1",
    },
    select: { id: true },
  });
  check("写入审计日志", Boolean(audit.id));

  // 清理
  await prisma.auditLog.deleteMany({ where: { targetId: site.id } });
  await prisma.webhookEndpoint.delete({ where: { id: webhook.id } });
  await prisma.cannedResponse.delete({ where: { id: canned.id } });
  await prisma.user.delete({ where: { id: agent.id } });
  await prisma.site.delete({ where: { id: site.id } });
  check("清理冒烟数据", true);

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n${failed.length === 0 ? "🎉 全部通过" : `⚠️ ${failed.length} 项失败`}（${results.length - failed.length}/${results.length}）\n`,
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("\n冒烟测试失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
