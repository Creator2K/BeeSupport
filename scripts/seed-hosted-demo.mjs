/** Persistent, explicitly requested LAN demo data. Re-runs create missing records only. */
import "dotenv/config";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import { useTestDatabase } from "./test-environment.mjs";

useTestDatabase();
const db = new PrismaClient();
const password = process.env.DEMO_PASSWORD || "Demo123456!";
if (password.length < 8 || Buffer.byteLength(password) > 72)
  throw new Error("DEMO_PASSWORD 必须为 8–72 字节");
const app = (
  process.env.TEST_APP_URL ||
  process.env.APP_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");
const prefix = "bs_demo_v1_";
const id = (name) => `${prefix}${name}`;
const days = (n, now) => new Date(now.getTime() + n * 86400000);
const added = {};

async function owned(tx, model, data, match = {}) {
  const current = await tx[model].findUnique({ where: { id: data.id } });
  if (current) {
    for (const [key, value] of Object.entries(match))
      if (current[key] !== value)
        throw new Error(`演示 ID 与其他数据冲突：${model}/${data.id}`);
    return { value: current, created: false };
  }
  const value = await tx[model].create({ data });
  added[model] = (added[model] || 0) + 1;
  return { value, created: true };
}

async function receipt() {
  const storageKey = `${id("site_shop_main")}/demo/receipt.png`;
  const filename = join(
    resolve(process.env.UPLOAD_DIR || "./data/uploads"),
    storageKey,
  );
  try {
    return { storageKey, size: (await stat(filename)).size };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:26px;background:#eff6ff;color:#172554;font:16px system-ui,sans-serif}.card{background:white;border:1px solid #dbeafe;border-radius:18px;padding:28px}.tag{float:right;background:#dbeafe;color:#1d4ed8;border-radius:20px;padding:6px 12px;font-size:12px}h1{margin:0 0 10px;font-size:25px}.muted{color:#64748b;font-size:13px}.line{display:flex;justify-content:space-between;padding:15px 0;border-bottom:1px solid #e2e8f0}.price{font-size:24px;font-weight:700}.footer{margin-top:20px;font-size:13px;color:#64748b}</style><div class="card"><span class="tag">演示数据</span><h1>云杉商城 · 订单凭证</h1><div class="muted">订单 DEMO-20261020-001</div><div class="line"><span>轻量旅行收纳包 × 1</span><span>¥129.00</span></div><div class="line"><span>配送方式</span><span>标准快递 · 待发货</span></div><div class="line"><span>订单合计</span><span class="price">¥129.00</span></div><div class="footer">仅用于客服图片预览与放行测试，不代表真实交易。</div></div></html>`,
    );
    const image = await page.screenshot({ type: "png" });
    await mkdir(dirname(filename), { recursive: true });
    try {
      await writeFile(filename, image, { flag: "wx", mode: 0o640 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return { storageKey, size: (await stat(filename)).size };
  } finally {
    await browser.close();
  }
}

try {
  const image = await receipt();
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const credentials = [];
  const summary = await db.$transaction(
    async (tx) => {
      const plans = {};
      for (const item of [
        {
          key: "trial",
          name: "体验版（演示）",
          priceCents: 0,
          durationDays: 7,
          maxAgents: 2,
          maxSites: 1,
          monthlyConversations: 300,
          storageMB: 128,
        },
        {
          key: "growth",
          name: "成长版（演示）",
          priceCents: 9900,
          durationDays: 30,
          maxAgents: 5,
          maxSites: 3,
          monthlyConversations: 3000,
          storageMB: 1024,
        },
        {
          key: "team",
          name: "团队版（演示）",
          priceCents: 29900,
          durationDays: 30,
          maxAgents: 15,
          maxSites: 10,
          monthlyConversations: 20000,
          storageMB: 5120,
        },
      ]) {
        const { key, ...data } = item;
        plans[key] = (
          await owned(tx, "subscriptionPlan", {
            id: id(`plan_${key}`),
            ...data,
            description: "局域网演示套餐，用于体验下单、续费和平台审核。",
            active: true,
            sortOrder: key === "trial" ? 100 : key === "growth" ? 101 : 102,
          })
        ).value;
      }
      const tenants = {},
        owners = {},
        agents = {},
        sites = {};
      const merchantSpecs = [
        {
          key: "shop",
          name: "云杉商城（演示）",
          slug: "demo-cloud-shop",
          status: "ACTIVE",
          term: 20,
          plan: "growth",
          color: "#2563eb",
          email: "shop@demo.beesupport.local",
        },
        {
          key: "tech",
          name: "栖木科技（演示）",
          slug: "demo-tech-studio",
          status: "ACTIVE",
          term: 3,
          plan: "growth",
          color: "#059669",
          email: "tech@demo.beesupport.local",
        },
        {
          key: "education",
          name: "映川教育（演示）",
          slug: "demo-learning",
          status: "ACTIVE",
          term: -2,
          plan: "growth",
          color: "#7c3aed",
          email: "education@demo.beesupport.local",
        },
        {
          key: "pending",
          name: "拾光设计（演示）",
          slug: "demo-pending-design",
          status: "PENDING",
          term: null,
          plan: "trial",
          color: "#d97706",
          email: "pending@demo.beesupport.local",
        },
        {
          key: "studio",
          name: "星河工作室（演示）",
          slug: "demo-paused-studio",
          status: "SUSPENDED",
          term: 18,
          plan: "growth",
          color: "#e11d48",
          email: "studio@demo.beesupport.local",
        },
      ];
      for (const item of merchantSpecs) {
        const selected = plans[item.plan];
        tenants[item.key] = (
          await owned(
            tx,
            "tenant",
            {
              id: id(`tenant_${item.key}`),
              name: item.name,
              slug: item.slug,
              status: item.status,
              planName: selected.name,
              expiresAt: item.term === null ? null : days(item.term, now),
              maxAgents: selected.maxAgents,
              maxSites: selected.maxSites,
              monthlyConversations: selected.monthlyConversations,
              storageMB: selected.storageMB,
              contactEmail: item.email,
              defaults: {
                title: `${item.name.replace("（演示）", "")}在线客服`,
                primaryColor: item.color,
                footerText: "BeeSupport · 演示客服",
                emojiEnabled: true,
                imagesEnabled: true,
                filesEnabled: true,
                ratingEnabled: true,
              },
              note: "由 demo:seed 创建的持久演示商家，可自由体验。重跑脚本不覆盖已有修改。",
            },
            { slug: item.slug },
          )
        ).value;
        owners[item.key] = (
          await owned(
            tx,
            "user",
            {
              id: id(`owner_${item.key}`),
              tenantId: tenants[item.key].id,
              email: item.email,
              name: `${item.name.replace("（演示）", "")}管理员`,
              passwordHash,
              role: "MERCHANT_ADMIN",
            },
            { tenantId: tenants[item.key].id, email: item.email },
          )
        ).value;
        credentials.push({
          merchant: item.name,
          role: "商家管理员",
          email: item.email,
          state:
            item.status === "SUSPENDED"
              ? "已停用，需平台启用后登录"
              : item.status === "PENDING"
                ? "待审核，需平台开通后登录"
                : item.term < 0
                  ? "已到期，可登录后台续费"
                  : "可直接登录",
        });
      }
      const siteSpecs = [
        {
          key: "shop_main",
          merchant: "shop",
          name: "云杉商城官网（演示）",
          slug: "demo-cloud-shop-web",
          review: true,
        },
        {
          key: "shop_mobile",
          merchant: "shop",
          name: "云杉移动商城（演示）",
          slug: "demo-cloud-shop-mobile",
          review: false,
        },
        {
          key: "tech_docs",
          merchant: "tech",
          name: "栖木产品文档（演示）",
          slug: "demo-tech-docs",
          review: false,
        },
        {
          key: "education_course",
          merchant: "education",
          name: "映川课程中心（演示）",
          slug: "demo-learning-courses",
          review: false,
        },
        {
          key: "studio_portfolio",
          merchant: "studio",
          name: "星河作品集（演示）",
          slug: "demo-studio-portfolio",
          review: false,
        },
      ];
      for (const item of siteSpecs) {
        sites[item.key] = (
          await owned(
            tx,
            "site",
            {
              id: id(`site_${item.key}`),
              tenantId: tenants[item.merchant].id,
              name: item.name,
              slug: item.slug,
              publicKey: `bs_demo_${item.key}_v1`,
              description: "局域网演示站点，可通过访客端预览测试真实聊天。",
              welcomeMessage:
                "你好，欢迎体验演示客服！可以咨询发货、售后或产品接入。",
              offlineMessage:
                "客服暂时离线，请留下你的问题，稍后在工作台查看。",
              requireEmail: false,
              autoAssign: true,
              imageReviewEnabled: item.review,
              allowedOrigins: [],
              notifyEmail: null,
            },
            { tenantId: tenants[item.merchant].id, slug: item.slug },
          )
        ).value;
      }
      for (const item of [
        {
          key: "shop_1",
          merchant: "shop",
          name: "小杉（演示客服）",
          email: "agent@demo.beesupport.local",
          sites: ["shop_main", "shop_mobile"],
        },
        {
          key: "shop_2",
          merchant: "shop",
          name: "小云（演示客服）",
          email: "agent2@demo.beesupport.local",
          sites: ["shop_main"],
        },
        {
          key: "tech_1",
          merchant: "tech",
          name: "小栖（演示客服）",
          email: "tech-agent@demo.beesupport.local",
          sites: ["tech_docs"],
        },
      ]) {
        const user = (
          await owned(
            tx,
            "user",
            {
              id: id(`agent_${item.key}`),
              tenantId: tenants[item.merchant].id,
              email: item.email,
              name: item.name,
              passwordHash,
              role: "AGENT",
              status: "OFFLINE",
            },
            { tenantId: tenants[item.merchant].id, email: item.email },
          )
        ).value;
        agents[item.key] = user;
        for (const key of item.sites)
          await tx.siteAgent.upsert({
            where: {
              userId_siteId: { userId: user.id, siteId: sites[key].id },
            },
            create: { userId: user.id, siteId: sites[key].id },
            update: {},
          });
        credentials.push({
          merchant: tenants[item.merchant].name,
          role: "客服",
          email: item.email,
          state: "可直接登录客服工作台",
        });
      }
      const topics = [
        "咨询商品发货时间",
        "申请售后换货",
        "想了解产品接入",
        "咨询课程试听",
      ];
      const merchantVisitors = { shop: 72, tech: 32, education: 16, studio: 8 };
      for (const [key, total] of Object.entries(merchantVisitors)) {
        for (let index = 0; index < total; index++) {
          const site =
            key === "shop"
              ? sites[
                  index !== 0 && index % 3 === 0 ? "shop_mobile" : "shop_main"
                ]
              : sites[
                  key === "tech"
                    ? "tech_docs"
                    : key === "education"
                      ? "education_course"
                      : "studio_portfolio"
                ];
          const mobile = index % 3 !== 0;
          const createdAt = days(-(index % 29), now);
          const visitor = (
            await owned(
              tx,
              "visitor",
              {
                id: id(`visitor_${key}_${index}`),
                siteId: site.id,
                localKey: `demo-local-${key}-${String(index).padStart(8, "0")}`,
                email: `visitor-${key}-${index}@example.test`,
                name: ["林同学", "周先生", "陈女士", "王同学", "吴先生"][
                  index % 5
                ],
                meta: {
                  device: mobile ? "手机" : "桌面端",
                  browser: mobile ? "Safari 18" : "Chrome 141",
                  os: mobile ? "iOS 18" : "Windows 11",
                  locale: index % 7 === 0 ? "en-US" : "zh-CN",
                  ip: `198.51.100.${index + 10}`,
                  screen: mobile ? "390x844" : "1920x1080",
                },
                visitCount: (index % 4) + 1,
                pageViews: (index % 8) + 2,
                firstSeenAt: createdAt,
                lastSeenAt: days(-(index % 7), now),
                landingPage: `${app}/preview?key=${site.publicKey}#products`,
                lastPage: `${app}/preview?key=${site.publicKey}#contact`,
                lastPageTitle: "演示商城 · 产品详情",
                referrer:
                  index % 4 === 0
                    ? null
                    : index % 4 === 1
                      ? "https://www.baidu.com/"
                      : index % 4 === 2
                        ? "https://www.google.com/"
                        : "https://demo.example.test/campaign",
                profileTags:
                  index % 3 === 0 ? ["演示访客", "高意向"] : ["演示访客"],
                profileNote: "自动生成的演示档案，不包含真实个人资料。",
              },
              { siteId: site.id },
            )
          ).value;
          if (index % 2 !== 0) continue;
          const status =
            index % 6 === 0 ? "PENDING" : index % 6 === 2 ? "OPEN" : "CLOSED";
          const agent =
            key === "shop"
              ? agents.shop_1
              : key === "tech"
                ? agents.tech_1
                : owners[key];
          const start = days(-(index % 6), now);
          const subject = topics[(index / 2) % topics.length];
          const convo = await owned(
            tx,
            "conversation",
            {
              id: id(`conversation_${key}_${index}`),
              siteId: site.id,
              visitorId: visitor.id,
              assignedAgentId: status === "PENDING" ? null : agent.id,
              status,
              source: index % 10 === 0 ? "OFFLINE_FORM" : "WIDGET",
              subject,
              tags:
                status === "CLOSED"
                  ? ["演示会话", "已解决"]
                  : ["演示会话", index % 4 === 0 ? "售前咨询" : "售后咨询"],
              note: "演示会话，可在工作台接入、转接、关闭或测试图片放行。",
              priority: index % 8 === 0 ? 1 : 0,
              unreadForAgent:
                status === "CLOSED" ? 0 : status === "PENDING" ? 2 : 1,
              unreadForVisitor: 0,
              firstResponseAt:
                status === "PENDING" ? null : new Date(start.getTime() + 90000),
              closedAt:
                status === "CLOSED" ? new Date(start.getTime() + 360000) : null,
              closedById: status === "CLOSED" ? agent.id : null,
              rating: status === "CLOSED" ? (index % 8 === 0 ? 4 : 5) : null,
              ratedAt:
                status === "CLOSED" ? new Date(start.getTime() + 420000) : null,
              ratingComment:
                status === "CLOSED"
                  ? "问题已解决，感谢耐心解答！（演示）"
                  : null,
              createdAt: start,
              lastMessageAt: new Date(start.getTime() + 300000),
              lastMessagePreview:
                status === "CLOSED"
                  ? "好的，感谢你的解答！"
                  : "还有一个问题，方便帮我看一下吗？",
            },
            { siteId: site.id, visitorId: visitor.id },
          );
          if (convo.created) {
            const messages =
              status === "PENDING"
                ? [
                    ["VISITOR", `你好，我想${subject}。`],
                    ["VISITOR", "方便的时候请帮我看一下，谢谢。"],
                  ]
                : [
                    ["VISITOR", `你好，我想${subject}。`],
                    [
                      "AGENT",
                      "你好！很高兴为你服务，请提供相关订单信息，我来帮你确认。",
                    ],
                    [
                      "VISITOR",
                      status === "CLOSED"
                        ? "好的，感谢你的解答！"
                        : "还有一个问题，方便帮我看一下吗？",
                    ],
                  ];
            added.message = (added.message || 0) + messages.length;
            await tx.message.createMany({
              data: messages.map(([sender, body], n) => ({
                id: id(`message_${key}_${index}_${n}`),
                conversationId: convo.value.id,
                sender,
                body,
                type: "TEXT",
                authorId: sender === "AGENT" ? agent.id : null,
                authorName: sender === "AGENT" ? agent.name : null,
                createdAt: new Date(start.getTime() + n * 90000),
                readByAgentAt:
                  status === "CLOSED" || sender === "AGENT" ? now : null,
                readByVisitorAt: now,
              })),
            });
          }
        }
      }
      const imageMessage = await owned(tx, "message", {
        id: id("image_message"),
        conversationId: id("conversation_shop_0"),
        sender: "VISITOR",
        type: "IMAGE",
        body: "这是我的演示订单凭证，可以帮我看看发货进度吗？",
        createdAt: now,
      });
      const attachment = await owned(
        tx,
        "attachment",
        {
          id: id("image_attachment"),
          siteId: sites.shop_main.id,
          messageId: imageMessage.value.id,
          uploader: "VISITOR",
          uploaderId: id("visitor_shop_0"),
          filename: "演示订单凭证.png",
          mimeType: "image/png",
          size: image.size,
          storageKey: image.storageKey,
          imageReviewState: "PENDING",
        },
        { siteId: sites.shop_main.id },
      );
      if (imageMessage.created && attachment.created) {
        await tx.visitor.update({
          where: { id: id("visitor_shop_0") },
          data: { pendingImageId: attachment.value.id },
        });
        await tx.conversation.update({
          where: { id: id("conversation_shop_0") },
          data: {
            lastMessageAt: now,
            lastMessagePreview: "访客发送了演示订单图片",
            unreadForAgent: 3,
          },
        });
      }
      for (const key of ["shop", "tech", "education"]) {
        for (const [n, title, content, shortcut] of [
          [
            0,
            "欢迎咨询（演示）",
            "你好，很高兴为你服务！请描述一下需要帮助的问题。",
            "hi",
          ],
          [
            1,
            "提供订单信息（演示）",
            "请提供订单号或订单截图，我帮你查询进度。",
            "order",
          ],
          [
            2,
            "暂时等待（演示）",
            "正在为你核实相关信息，请稍等 1–2 分钟。",
            "wait",
          ],
        ])
          await owned(
            tx,
            "cannedResponse",
            {
              id: id(`canned_${key}_${n}`),
              tenantId: tenants[key].id,
              title,
              content,
              shortcut,
              shared: true,
              ownerId: owners[key].id,
            },
            { tenantId: tenants[key].id },
          );
        await owned(
          tx,
          "aiKnowledge",
          {
            id: id(`knowledge_${key}`),
            tenantId: tenants[key].id,
            title: "演示站点服务说明",
            content:
              "这是客服系统的演示商家。订单、图片和访客资料均为测试内容，具体商品与业务信息请由人工客服确认。",
            keywords: ["演示", "客服", "测试"],
            enabled: true,
          },
          { tenantId: tenants[key].id },
        );
      }
      const rule = (
        await owned(
          tx,
          "riskRule",
          {
            id: id("risk_word"),
            tenantId: tenants.shop.id,
            kind: "WORD",
            value: "演示拦截词",
            note: "演示违禁词：在访客窗口发送此词可以体验拦截。",
            active: true,
          },
          { tenantId: tenants.shop.id },
        )
      ).value;
      await owned(
        tx,
        "riskRule",
        {
          id: id("risk_ip"),
          tenantId: tenants.shop.id,
          kind: "IP",
          value: "203.0.113.0/24",
          note: "演示保留网段，不影响局域网实际访问。",
          active: true,
        },
        { tenantId: tenants.shop.id },
      );
      for (let n = 0; n < 5; n++)
        await owned(
          tx,
          "riskEvent",
          {
            id: id(`risk_event_${n}`),
            siteId: sites.shop_main.id,
            visitorId: id(`visitor_shop_${[0, 1, 2, 4, 5][n]}`),
            kind: "WORD",
            ruleId: rule.id,
            ruleValue: rule.value,
            ip: `198.51.100.${n + 10}`,
            context: "demo-seed",
            createdAt: new Date(now.getTime() - n * 3600000),
          },
          { siteId: sites.shop_main.id },
        );
      const orderSpecs = [
        [
          "shop_paid",
          "shop",
          "growth",
          "CONFIRMED",
          -10,
          "演示：已确认成长版开通",
          "DEMO-V1-SHOP-RECEIPT",
        ],
        [
          "shop_pending",
          "shop",
          "team",
          "PENDING",
          -1,
          "演示：申请升级团队版，等待平台审核",
          "",
        ],
        [
          "tech_pending",
          "tech",
          "growth",
          "PENDING",
          0,
          "演示：服务即将到期，申请续费",
          "",
        ],
        [
          "tech_rejected",
          "tech",
          "team",
          "REJECTED",
          -5,
          "演示：请补充收款凭据后重新提交",
          "",
        ],
        [
          "tech_cancelled",
          "tech",
          "growth",
          "CANCELLED",
          -8,
          "演示：商家取消了这笔申请",
          "",
        ],
        [
          "education_expired",
          "education",
          "growth",
          "EXPIRED",
          -12,
          "演示：报价已过期，可重新下单续费",
          "",
        ],
        [
          "studio_paid",
          "studio",
          "growth",
          "CONFIRMED",
          -12,
          "演示：历史开通记录，该商家后来被停用",
          "DEMO-V1-STUDIO-RECEIPT",
        ],
      ];
      for (const [
        key,
        merchant,
        planKey,
        status,
        ago,
        note,
        reference,
      ] of orderSpecs) {
        const selected = plans[planKey];
        await owned(
          tx,
          "subscriptionOrder",
          {
            id: id(`order_${key}`),
            orderNo: `DEMO-V1-${key.replaceAll("_", "-").toUpperCase()}`,
            tenantId: tenants[merchant].id,
            planId: selected.id,
            clientRequestId: `demo-v1-${key}`,
            status,
            planName: selected.name,
            priceCents: selected.priceCents,
            durationDays: selected.durationDays,
            maxAgents: selected.maxAgents,
            maxSites: selected.maxSites,
            monthlyConversations: selected.monthlyConversations,
            storageMB: selected.storageMB,
            requestedById: owners[merchant].id,
            requestedByName: owners[merchant].name,
            merchantNote: "自动生成的演示订单，不代表真实付款。",
            reviewNote: status === "PENDING" ? "" : note,
            reviewedByName: status === "PENDING" ? null : "演示数据初始化",
            paymentReference: reference,
            validUntil: days(ago + 7, now),
            createdAt: days(ago, now),
            reviewedAt: ["PENDING", "EXPIRED"].includes(status)
              ? null
              : days(ago, now),
            periodStart: status === "CONFIRMED" ? days(ago, now) : null,
            periodEnd:
              status === "CONFIRMED"
                ? days(ago + selected.durationDays, now)
                : null,
          },
          { tenantId: tenants[merchant].id, planId: selected.id },
        );
      }
      for (const key of Object.keys(tenants))
        await owned(
          tx,
          "auditLog",
          {
            id: id(`audit_${key}`),
            tenantId: tenants[key].id,
            actorName: "演示数据初始化",
            action: "demo.seed",
            targetType: "Tenant",
            targetId: tenants[key].id,
            meta: { demo: true, version: 1 },
          },
          { tenantId: tenants[key].id },
        );
      return {
        tenants: Object.values(tenants).map((t) => ({
          id: t.id,
          name: t.name,
        })),
        plans: Object.values(plans).map((p) => ({ id: p.id, name: p.name })),
        previews: Object.values(sites).map((site) => ({
          name: site.name,
          url: `${app}/preview?key=${site.publicKey}`,
        })),
      };
    },
    { timeout: 45000, maxWait: 10000 },
  );
  const dataCounts = {};
  for (const model of [
    "tenant",
    "user",
    "site",
    "visitor",
    "conversation",
    "message",
    "attachment",
    "subscriptionPlan",
    "subscriptionOrder",
  ])
    dataCounts[model] = await db[model].count({
      where: { id: { startsWith: prefix } },
    });
  const manifest = {
    dataCounts,
    generatedAt: new Date().toISOString(),
    app,
    added,
    ...summary,
    accounts: credentials,
    initialPassword: password,
    passwordNote: "首次创建的演示账号使用此密码；重跑不会重置修改过的密码。",
  };
  const manifestPath = resolve("data/runtime/demo-accounts.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      added,
      dataCounts,
      merchants: summary.tenants.length,
      plans: summary.plans.length,
      accounts: credentials.length,
      manifest: manifestPath,
    }),
  );
} finally {
  await db.$disconnect();
}
