/**
 * 演示 / 初始化数据。
 * 幂等：可以反复执行（pnpm db:seed）。
 *
 *   - 管理员：SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *   - 演示客服与站点、话术、一个进行中的会话
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "ChangeMe123!";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@beesupport.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? DEMO_PASSWORD;
const AGENT_EMAIL = process.env.SEED_AGENT_EMAIL ?? "agent@beesupport.local";
const AGENT_PASSWORD = process.env.SEED_AGENT_PASSWORD ?? DEMO_PASSWORD;
const AGENT2_EMAIL = process.env.SEED_AGENT2_EMAIL ?? "agent2@beesupport.local";

/** 自己设置的密码不回显到终端，只有公开的演示密码才打印。 */
const shownPassword = (password: string) =>
  password === DEMO_PASSWORD ? password : "（环境变量中设置的密码）";

async function main() {
  // 演示密码写在公开仓库里，生产环境用它等于管理员账号不设防
  if (
    process.env.NODE_ENV === "production" &&
    (ADMIN_PASSWORD === DEMO_PASSWORD || AGENT_PASSWORD === DEMO_PASSWORD)
  ) {
    throw new Error(
      "生产环境不能使用默认演示密码，请先设置 SEED_ADMIN_PASSWORD 和 SEED_AGENT_PASSWORD",
    );
  }
  await prisma.tenant.upsert({
    where: { id: "legacy" },
    create: {
      id: "legacy",
      name: "默认商家",
      slug: "default",
      planName: "原有数据保留套餐",
      maxAgents: 100000,
      maxSites: 100000,
      monthlyConversations: 100000000,
      storageMB: 100000000,
    },
    update: {},
  });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const agentHash = await bcrypt.hash(AGENT_PASSWORD, 10);

  // ---------- 管理员 ----------
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      name: "管理员",
      passwordHash,
      role: "ADMIN",
      active: true,
    },
    update: { role: "ADMIN", active: true },
  });

  // ---------- 演示站点 ----------
  const site = await prisma.site.upsert({
    where: { slug: "demo" },
    create: {
      name: "示例站点",
      slug: "demo",
      publicKey: "demo-site-key",
      description: "用于演示与自测的站点，可直接用嵌入代码接入任意页面",
      primaryColor: "#18181b",
      welcomeMessage: "你好！这里是示例站点在线客服，有什么可以帮你的吗？",
      offlineMessage:
        "当前客服不在线，请留下你的邮箱和问题，我们会尽快回复你。",
      requireEmail: true,
      autoAssign: true,
      allowedOrigins: [],
    },
    update: {},
  });

  const secondSite = await prisma.site.upsert({
    where: { slug: "docs" },
    create: {
      name: "文档站",
      slug: "docs",
      publicKey: "docs-site-key",
      description:
        "第二个站点示例，展示多站点共用客服池（关闭自动分配以便演示排队）",
      primaryColor: "#18181b",
      autoAssign: false,
      allowedOrigins: [],
    },
    update: { autoAssign: false },
  });

  // ---------- 演示客服 ----------
  const agent = await prisma.user.upsert({
    where: { email: AGENT_EMAIL },
    create: {
      email: AGENT_EMAIL,
      name: "小蜜",
      passwordHash: agentHash,
      role: "AGENT",
      active: true,
      status: "OFFLINE",
    },
    update: { role: "AGENT", active: true },
  });

  await prisma.siteAgent.upsert({
    where: { userId_siteId: { userId: agent.id, siteId: site.id } },
    create: { userId: agent.id, siteId: site.id },
    update: {},
  });
  await prisma.siteAgent.upsert({
    where: { userId_siteId: { userId: agent.id, siteId: secondSite.id } },
    create: { userId: agent.id, siteId: secondSite.id },
    update: {},
  });

  // 第二位客服：用于演示转接功能
  const agent2 = await prisma.user.upsert({
    where: { email: AGENT2_EMAIL },
    create: {
      email: AGENT2_EMAIL,
      name: "小助手",
      passwordHash: agentHash,
      role: "AGENT",
      active: true,
      status: "OFFLINE",
    },
    update: { role: "AGENT", active: true },
  });

  await prisma.siteAgent.upsert({
    where: { userId_siteId: { userId: agent2.id, siteId: site.id } },
    create: { userId: agent2.id, siteId: site.id },
    update: {},
  });

  // ---------- 快捷话术 ----------
  const canned = [
    {
      title: "欢迎语",
      shortcut: "hi",
      content: "你好，很高兴为你服务！请问遇到什么问题了？",
      siteId: null,
    },
    {
      title: "稍等片刻",
      shortcut: "wait",
      content: "稍等，我帮你确认一下，大概 1-2 分钟。",
      siteId: null,
    },
    {
      title: "价格说明",
      shortcut: "price",
      content:
        "我们的套餐分为基础版与专业版，可以告诉我你的使用规模吗？我帮你推荐更合适的方案。",
      siteId: null,
    },
    {
      title: "服务时间",
      shortcut: "hours",
      content:
        "人工客服的服务时间是工作日 09:00-18:00，其余时间留言我们会在下一个工作日回复。",
      siteId: null,
    },
    {
      title: "示例站点专属",
      shortcut: "demo",
      content: "这是示例站点专用的快捷回复。",
      siteId: site.id,
    },
  ];

  for (const item of canned) {
    const existing = await prisma.cannedResponse.findFirst({
      where: { shortcut: item.shortcut, siteId: item.siteId },
      select: { id: true },
    });
    if (existing) {
      await prisma.cannedResponse.update({
        where: { id: existing.id },
        data: { title: item.title, content: item.content },
      });
    } else {
      await prisma.cannedResponse.create({
        data: {
          title: item.title,
          shortcut: item.shortcut,
          content: item.content,
          siteId: item.siteId,
          shared: true,
        },
      });
    }
  }

  // ---------- AI 知识库（演示内容，AI 开关与密钥请到后台「AI 助手」里填）----------
  const knowledge = [
    {
      title: "退款政策",
      keywords: ["退款", "退货", "refund"],
      content:
        "购买后 7 天内支持无理由退款：在订单页面点「申请退款」，或把订单号发给客服代为处理，1-3 个工作日到账。",
    },
    {
      title: "服务时间",
      keywords: ["服务时间", "工作时间", "几点", "在线时间"],
      content:
        "人工客服时间为工作日 09:00-18:00；其余时间的留言会在下一个工作日优先处理。",
    },
    {
      title: "价格与套餐",
      keywords: ["价格", "多少钱", "套餐", "收费"],
      content:
        "基础版免费，专业版 ￥299/月（含 5 个客服席位与不限量会话），年付 9 折。具体以官网价格页为准。",
    },
    {
      title: "多站点接入",
      keywords: ["接入", "嵌入", "多个网站", "代码"],
      content:
        '每个站点会生成一个独立的接入密钥，把 <script src=".../widget.js?key=..." async></script> 放到网站 </body> 之前即可；多个网站共用同一套客服工作台。',
    },
  ];

  for (const item of knowledge) {
    const existing = await prisma.aiKnowledge.findFirst({
      where: { title: item.title, siteId: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.aiKnowledge.update({
        where: { id: existing.id },
        data: { content: item.content, keywords: item.keywords, enabled: true },
      });
    } else {
      await prisma.aiKnowledge.create({
        data: {
          title: item.title,
          content: item.content,
          keywords: item.keywords,
          siteId: null,
          enabled: true,
        },
      });
    }
  }

  // 知识库切片索引（关键词检索的最小单位），有向量配置时顺带写向量
  try {
    const { requestKnowledgeIndex } =
      await import("../src/server/services/knowledge");
    const index = await requestKnowledgeIndex();
    console.log(`✓ 已安排 ${index.queued} 条知识索引任务，启动服务后处理`);
  } catch (error) {
    console.warn(
      "! 知识库索引重建失败（可稍后在后台点「重建向量索引」）:",
      error,
    );
  }

  // ---------- 一个演示会话（含历史消息） ----------
  const demoLocalKey = "seed-demo-visitor-0001";
  const visitor = await prisma.visitor.upsert({
    where: { siteId_localKey: { siteId: site.id, localKey: demoLocalKey } },
    create: {
      siteId: site.id,
      localKey: demoLocalKey,
      email: "visitor@example.com",
      name: "小王",
      meta: {
        pageUrl: "https://example.com/pricing",
        referrer: "https://www.google.com/",
        locale: "zh-CN",
        userAgent: "Mozilla/5.0 (seed data)",
        ip: "203.0.113.10",
      },
    },
    update: {},
  });

  const existingConversation = await prisma.conversation.findFirst({
    where: { siteId: site.id, visitorId: visitor.id },
    select: { id: true },
  });

  if (!existingConversation) {
    const now = Date.now();
    const conversation = await prisma.conversation.create({
      data: {
        siteId: site.id,
        visitorId: visitor.id,
        assignedAgentId: agent.id,
        status: "OPEN",
        source: "WIDGET",
        subject: "想了解一下专业版的价格",
        tags: ["售前咨询"],
        lastMessageAt: new Date(now),
        lastMessagePreview: "好的，我看看专业版的额度够不够用。",
        unreadForAgent: 1,
        firstResponseAt: new Date(now - 60_000),
      },
    });

    const messages = [
      {
        sender: "VISITOR" as const,
        body: "你好，我想了解一下专业版的价格",
        minutesAgo: 8,
      },
      {
        sender: "AGENT" as const,
        body: "你好！专业版是 ￥299/月，包含 5 个客服席位和不限量会话。",
        minutesAgo: 6,
      },
      {
        sender: "VISITOR" as const,
        body: "好的，我看看专业版的额度够不够用。",
        minutesAgo: 1,
      },
    ];

    for (const item of messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: item.sender,
          type: "TEXT",
          body: item.body,
          authorId: item.sender === "AGENT" ? agent.id : null,
          authorName: item.sender === "AGENT" ? agent.name : null,
          createdAt: new Date(now - item.minutesAgo * 60_000),
          readByAgentAt: item.sender === "VISITOR" ? new Date() : null,
          readByVisitorAt: null,
        },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(now - 60_000) },
    });
  }

  console.log("✅ 初始化完成，登录信息：");
  console.log(`   管理员：${ADMIN_EMAIL} / ${shownPassword(ADMIN_PASSWORD)}`);
  console.log(`   客服：  ${AGENT_EMAIL} / ${shownPassword(AGENT_PASSWORD)}`);
  console.log(
    `   客服2： ${AGENT2_EMAIL} / ${shownPassword(AGENT_PASSWORD)}（用于转接演示）`,
  );
  console.log(
    `   管理后台入口：${process.env.ADMIN_PATH ?? "/admin"}（可用 ADMIN_PATH 改成随机路径）`,
  );
  console.log(
    `   站点接入密钥：${site.slug} = ${site.publicKey}，${secondSite.slug} = ${secondSite.publicKey}`,
  );
}

main()
  .catch((error) => {
    console.error("❌ 初始化失败:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
