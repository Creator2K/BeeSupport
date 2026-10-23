import {
  AiError,
  buildSystemPrompt,
  chatComplete,
  chatCompletion,
  getAiConfig,
  isAiReady,
  resolveModel,
  retrieveKnowledge,
  toAiMessages,
  type AiChatMessage,
  type AiConfig,
  type AiMessage,
  type AiToolCall,
  type KnowledgeHit,
  type OpenAiTool,
} from "../../lib/ai";
import {
  HttpError,
  countOnlineAgents,
  canAccessSite,
  type SessionUser,
} from "../../lib/auth";
import { prisma } from "../../lib/db";
import { describeVisitor } from "../../lib/visitor-env";
import { broadcastConversation, broadcastMessage } from "./broadcast";
import { randomUUID } from "node:crypto";
import { lockConversation } from "../transactions";
import { getSiteFeatures } from "./entitlements";

/** 人工刚回复过的这段时间里，即使 always 模式也不抢先插话 */
const HUMAN_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

const MAX_AI_BODY_LENGTH = 5000;

/* ---------------- 工具调用 ---------------- */

export type AiToolTrace = {
  name: string;
  arguments: Record<string, unknown>;
  /** 给客服看的执行摘要 */
  summary: string;
  ok: boolean;
  ms: number;
};

export type AiKnowledgeTrace = {
  title: string;
  score: number;
  via: string;
};

/** AI 消息附带的过程信息，存在 Message.meta 里，工作台可展开查看 */
export type AiMessageMeta = {
  ai: {
    model: string;
    tools: AiToolTrace[];
    knowledge: AiKnowledgeTrace[];
    rounds: number;
    usage: { promptTokens: number; completionTokens: number } | null;
  };
};

export type AiRunResult = {
  text: string;
  model: string;
  trace: AiToolTrace[];
  knowledge: AiKnowledgeTrace[];
  rounds: number;
  usage: { promptTokens: number; completionTokens: number } | null;
};

type ToolContext = {
  conversationId: string;
  siteId: string;
  visitorId: string;
  config: AiConfig;
  /** 建议草稿场景下不允许改会话（只读工具） */
  allowMutations: boolean;
  query: string;
  trace: AiToolTrace[];
  knowledge: Map<string, AiKnowledgeTrace>;
};

const TOOL_DEFINITIONS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "在客服知识库里检索资料。回答政策、价格、流程等具体问题前先调用它，再用检索结果作答。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词或访客的原话" },
          top_k: { type: "integer", description: "返回条数，默认 4，最多 8" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_visitor_context",
      description:
        "获取当前访客的资料：邮箱、访问次数、所在页面、语言、设备等，用于判断语境。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "当问题超出知识库范围、涉及退款投诉、或访客明确要求人工时调用，转交人工客服跟进。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "转人工的原因，用中文简短描述",
          },
          priority: {
            type: "integer",
            description: "优先级 1-3，1 最高；投诉或紧急问题用 1",
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_conversation",
      description: "给会话打标签，便于后续统计与筛选，例如「退款」「发票」。",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            description: "1-3 个中文短标签",
          },
        },
        required: ["tags"],
      },
    },
  },
];

const READ_ONLY_TOOLS = new Set(["search_knowledge", "get_visitor_context"]);

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function createInternalNote(
  conversationId: string,
  body: string,
): Promise<void> {
  const message = await prisma.message.create({
    data: {
      conversationId,
      sender: "SYSTEM",
      type: "NOTE",
      body: body.slice(0, 2000),
      readByAgentAt: new Date(),
    },
  });
  await broadcastMessage(message.id);
}

async function runTool(
  context: ToolContext,
  call: AiToolCall,
): Promise<string> {
  const startedAt = Date.now();
  const args = parseArguments(call.arguments);

  try {
    switch (call.name) {
      case "search_knowledge": {
        const query = String(args.query ?? context.query).slice(0, 300);
        const topK = Math.min(
          8,
          Math.max(1, Number(args.top_k ?? context.config.topK) || 4),
        );
        const hits = await retrieveKnowledge({
          siteId: context.siteId,
          query,
          topK,
          config: context.config,
        });

        for (const hit of hits) {
          context.knowledge.set(hit.id, {
            title: hit.title,
            score: hit.score,
            via: hit.via,
          });
        }

        const text =
          hits.length === 0
            ? "知识库没有找到相关内容。"
            : hits
                .map(
                  (hit, index) =>
                    `【${index + 1}】${hit.title}\n${hit.content}`,
                )
                .join("\n\n");

        context.trace.push({
          name: call.name,
          arguments: { query, top_k: topK },
          summary:
            hits.length === 0
              ? `未命中知识库（${query}）`
              : `命中 ${hits.length} 条：${hits.map((hit) => hit.title).join("、")}`,
          ok: true,
          ms: Date.now() - startedAt,
        });
        return text;
      }

      case "get_visitor_context": {
        const [visitor, conversationCount] = await Promise.all([
          prisma.visitor.findUnique({
            where: { id: context.visitorId },
            select: {
              email: true,
              name: true,
              visitCount: true,
              pageViews: true,
              lastPage: true,
              lastPageTitle: true,
              landingPage: true,
              lastSeenAt: true,
              meta: true,
              _count: { select: { conversations: true } },
            },
          }),
          prisma.conversation.count({
            where: { visitorId: context.visitorId },
          }),
        ]);

        if (!visitor) return "访客资料不可用。";

        const meta = (visitor.meta ?? {}) as Record<string, unknown>;
        const identity = describeVisitor(meta);
        const lines = [
          `邮箱：${visitor.email || "未提供"}`,
          visitor.name ? `称呼：${visitor.name}` : "",
          `历史会话：${conversationCount} 次`,
          `访问次数：${visitor.visitCount}，浏览页数：${visitor.pageViews}`,
          visitor.lastPage ? `当前页面：${visitor.lastPage}` : "",
          visitor.lastPageTitle ? `页面标题：${visitor.lastPageTitle}` : "",
          visitor.landingPage ? `落地页：${visitor.landingPage}` : "",
          identity.device ? `设备：${identity.device}` : "",
          identity.os ? `系统：${identity.os}` : "",
          identity.browser ? `浏览器：${identity.browser}` : "",
          meta.locale ? `语言：${String(meta.locale)}` : "",
          meta.timezone ? `时区：${String(meta.timezone)}` : "",
        ].filter(Boolean);

        context.trace.push({
          name: call.name,
          arguments: {},
          summary: `读取访客资料（${visitor.email || "匿名"}）`,
          ok: true,
          ms: Date.now() - startedAt,
        });
        return lines.join("\n");
      }

      case "escalate_to_human": {
        if (!context.allowMutations) {
          context.trace.push({
            name: call.name,
            arguments: args,
            summary: "草稿模式下忽略转人工",
            ok: false,
            ms: Date.now() - startedAt,
          });
          return "当前是草稿模式，未真正转人工。";
        }

        const reason = String(args.reason ?? "需要人工协助").slice(0, 200);
        const priority = Math.min(
          3,
          Math.max(1, Number(args.priority ?? 2) || 2),
        );

        await prisma.conversation.update({
          where: { id: context.conversationId },
          data: { priority },
        });
        await createInternalNote(
          context.conversationId,
          `AI 建议转人工：${reason}（优先级 P${priority}）`,
        );
        await broadcastConversation(context.conversationId);

        context.trace.push({
          name: call.name,
          arguments: { reason, priority },
          summary: `已标记转人工：${reason}`,
          ok: true,
          ms: Date.now() - startedAt,
        });
        return "已把会话标记为需要人工跟进，并写入内部备注。";
      }

      case "tag_conversation": {
        const tags = Array.isArray(args.tags)
          ? args.tags
              .map((tag) => String(tag).trim().slice(0, 24))
              .filter(Boolean)
              .slice(0, 3)
          : [];

        if (tags.length === 0) return "没有解析到有效标签。";

        if (!context.allowMutations) {
          context.trace.push({
            name: call.name,
            arguments: { tags },
            summary: "草稿模式下忽略打标签",
            ok: false,
            ms: Date.now() - startedAt,
          });
          return "当前是草稿模式，未写入标签。";
        }

        const conversation = await prisma.conversation.findUnique({
          where: { id: context.conversationId },
          select: { tags: true },
        });
        const merged = Array.from(
          new Set([...(conversation?.tags ?? []), ...tags]),
        ).slice(0, 12);

        await prisma.conversation.update({
          where: { id: context.conversationId },
          data: { tags: merged },
        });
        await broadcastConversation(context.conversationId);

        context.trace.push({
          name: call.name,
          arguments: { tags },
          summary: `新增标签：${tags.join("、")}`,
          ok: true,
          ms: Date.now() - startedAt,
        });
        return `已为会话添加标签：${tags.join("、")}`;
      }

      default: {
        context.trace.push({
          name: call.name,
          arguments: args,
          summary: "未知工具",
          ok: false,
          ms: Date.now() - startedAt,
        });
        return `未知工具 ${call.name}`;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.trace.push({
      name: call.name,
      arguments: args,
      summary: `执行失败：${message}`,
      ok: false,
      ms: Date.now() - startedAt,
    });
    return `工具执行失败：${message}`;
  }
}

/**
 * 一轮完整的「模型 + 工具」对话：模型可以连续调用工具，直到给出最终回答。
 * 关闭工具时退化为一次普通补全。
 */
async function runConversation(input: {
  config: AiConfig;
  messages: AiChatMessage[];
  model?: string;
  context: ToolContext;
}): Promise<AiRunResult> {
  const model = resolveModel(input.config, input.model);
  const messages: AiChatMessage[] = [...input.messages];

  const usageTotal = { promptTokens: 0, completionTokens: 0 };
  let rounds = 0;

  const toolsEnabled = input.config.enableTools;
  const tools = toolsEnabled
    ? input.context.allowMutations
      ? TOOL_DEFINITIONS
      : TOOL_DEFINITIONS.filter((tool) =>
          READ_ONLY_TOOLS.has(tool.function.name),
        )
    : [];

  while (rounds < (toolsEnabled ? input.config.maxToolRounds : 1)) {
    rounds += 1;
    const result = await chatCompletion(input.config, messages, {
      model,
      tools: tools.length > 0 ? tools : undefined,
      toolChoice: "auto",
    });

    if (result.usage) {
      usageTotal.promptTokens += result.usage.promptTokens;
      usageTotal.completionTokens += result.usage.completionTokens;
    }

    if (result.toolCalls.length === 0) {
      return {
        text: result.content,
        model,
        trace: input.context.trace,
        knowledge: [...input.context.knowledge.values()],
        rounds,
        usage: toUsageOrNull(usageTotal),
      };
    }

    // 把 assistant 的 tool_calls 原样回填，再逐个执行工具
    messages.push({
      role: "assistant",
      content: result.raw.content,
      tool_calls: result.raw.tool_calls,
    });

    for (const call of result.toolCalls) {
      const output = await runTool(input.context, call);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: output.slice(0, 4000),
      });
    }
  }

  // 工具轮次用尽：强制模型不带工具地给出结论
  const final = await chatCompletion(
    input.config,
    [
      ...messages,
      {
        role: "system",
        content: "工具调用次数已达上限，请基于已有信息直接给出最终回答。",
      },
    ],
    { model },
  );

  if (final.usage) {
    usageTotal.promptTokens += final.usage.promptTokens;
    usageTotal.completionTokens += final.usage.completionTokens;
  }

  return {
    text: final.content,
    model,
    trace: input.context.trace,
    knowledge: [...input.context.knowledge.values()],
    rounds,
    usage: toUsageOrNull(usageTotal),
  };
}

function toUsageOrNull(total: {
  promptTokens: number;
  completionTokens: number;
}): { promptTokens: number; completionTokens: number } | null {
  return total.promptTokens > 0 || total.completionTokens > 0
    ? { ...total }
    : null;
}

/* ---------------- 消息落库 ---------------- */

/**
 * AI 回复落库。
 * 会话状态刻意保持不变：AI 回复不等于人工接入，会话仍在排队/进行中，
 * 只是访客侧立刻拿到了回答。
 *
 * 放在这里（而不是 messages.ts）是为了避免 messages ↔ ai 的循环依赖。
 */
export async function insertAiMessage(input: {
  conversationId: string;
  siteId: string;
  body: string;
  authorName: string | null;
  meta?: AiMessageMeta;
  expectedMessageId?: string;
  leaseToken?: string;
}): Promise<string | null> {
  const body = input.body.trim().slice(0, MAX_AI_BODY_LENGTH);
  if (!body) throw new HttpError(400, "AI 回复内容为空");

  const message = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, input.conversationId);
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      select: { status: true, aiReplyToken: true },
    });
    if (
      !conversation ||
      conversation.status === "CLOSED" ||
      (input.leaseToken && conversation.aiReplyToken !== input.leaseToken)
    )
      return null;
    if (input.expectedMessageId) {
      const latest = await tx.message.findFirst({
        where: {
          conversationId: input.conversationId,
          sender: { not: "SYSTEM" },
          type: { notIn: ["SYSTEM", "NOTE"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, sender: true },
      });
      if (latest?.id !== input.expectedMessageId || latest.sender !== "VISITOR")
        return null;
    }
    const message = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        sender: "AI",
        type: "TEXT",
        body,
        authorName: input.authorName,
        meta: input.meta ? (input.meta as object) : undefined,
        readByAgentAt: new Date(),
      },
    });

    const now = new Date();
    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: now,
        lastMessagePreview: body.slice(0, 120),
        unreadForVisitor: { increment: 1 },
      },
    });
    return message;
  });
  if (!message) return null;

  await broadcastMessage(message.id);
  await broadcastConversation(input.conversationId);
  return message.id;
}

/* ---------------- 自动回复 ---------------- */

export type AutoReplyDecision =
  { reply: true; config: AiConfig } | { reply: false; reason: string };

/**
 * 是否应该让 AI 自动回复这条会话。
 * 只做判定，不产生副作用，方便单独测试。
 */
export async function decideAutoReply(
  conversationId: string,
): Promise<AutoReplyDecision> {
  const config = await getAiConfig();
  if (!isAiReady(config)) return { reply: false, reason: "ai_not_configured" };
  if (config.autoReply === "off")
    return { reply: false, reason: "auto_reply_off" };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      siteId: true,
      status: true,
      messages: {
        where: {
          sender: { not: "SYSTEM" },
          type: { notIn: ["SYSTEM", "NOTE"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { sender: true, type: true, body: true },
      },
    },
  });

  if (!conversation) return { reply: false, reason: "conversation_missing" };
  if (!(await getSiteFeatures(conversation.siteId)).ai)
    return { reply: false, reason: "plan_ai_disabled" };
  if (conversation.status === "CLOSED")
    return { reply: false, reason: "closed" };

  // 忽略系统消息（例如「已为你接入客服 X」），只看最后一条真实对话
  const lastMeaningful =
    conversation.messages.find(
      (message) =>
        message.sender !== "SYSTEM" &&
        message.type !== "SYSTEM" &&
        message.type !== "NOTE",
    ) ?? null;

  if (!lastMeaningful || lastMeaningful.sender !== "VISITOR") {
    return { reply: false, reason: "last_message_not_visitor" };
  }

  if (config.autoReply === "no_agent") {
    const online = await countOnlineAgents(conversation.siteId);
    if (online > 0) return { reply: false, reason: "agent_online" };
    return { reply: true, config };
  }

  // always：除非人工刚刚还在回复
  const recentAgentMessage = await prisma.message.findFirst({
    where: {
      conversationId,
      sender: "AGENT",
      type: { not: "NOTE" },
      createdAt: { gte: new Date(Date.now() - HUMAN_ACTIVE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recentAgentMessage) return { reply: false, reason: "human_active" };

  return { reply: true, config };
}

async function buildConversationMessages(input: {
  conversationId: string;
  siteId: string;
  siteName: string;
  query: string;
  config: AiConfig;
  allowMutations: boolean;
  extraSystemHint?: string;
}): Promise<{
  messages: AiChatMessage[];
  context: ToolContext;
}> {
  const [history, knowledge] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversationId: input.conversationId,
        sender: { not: "SYSTEM" },
        type: { notIn: ["SYSTEM", "NOTE"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.config.historyLimit,
      select: {
        sender: true,
        type: true,
        body: true,
        authorName: true,
      },
    }),
    retrieveKnowledge({
      siteId: input.siteId,
      query: input.query,
      topK: input.config.topK,
      config: input.config,
    }),
  ]);

  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { visitorId: true },
  });

  const systemPrompt = buildSystemPrompt({
    config: input.config,
    siteName: input.siteName,
    knowledge,
  });

  const toolHint = input.config.enableTools
    ? "\n\n可以调用工具：search_knowledge（查知识库）、get_visitor_context（看访客资料）" +
      (input.allowMutations
        ? "、escalate_to_human（转人工）、tag_conversation（打标签）。信息不足时先用工具查，再回答。"
        : "。")
    : "";

  const messages: AiChatMessage[] = [
    {
      role: "system",
      content: [systemPrompt + toolHint, input.extraSystemHint]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...toAiMessages(history.reverse(), input.config.historyLimit),
  ];

  const context: ToolContext = {
    conversationId: input.conversationId,
    siteId: input.siteId,
    visitorId: conversation?.visitorId ?? "",
    config: input.config,
    allowMutations: input.allowMutations,
    query: input.query,
    trace: [],
    knowledge: new Map(
      knowledge.map((hit: KnowledgeHit) => [
        hit.id,
        { title: hit.title, score: hit.score, via: hit.via },
      ]),
    ),
  };

  return { messages, context };
}

/**
 * 生成访客侧的自动回复文本。返回 null 表示当前不该回复。
 */
export async function generateAutoReply(
  conversationId: string,
): Promise<
  (AiRunResult & { assistantName: string; targetMessageId: string }) | null
> {
  const decision = await decideAutoReply(conversationId);
  if (!decision.reply) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ai] 跳过自动回复：${decision.reason}`);
    }
    return null;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      siteId: true,
      site: { select: { name: true } },
      messages: {
        where: {
          sender: { not: "SYSTEM" },
          type: { notIn: ["SYSTEM", "NOTE"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, sender: true, type: true, body: true },
      },
    },
  });
  if (!conversation) return null;

  const lastMeaningful =
    conversation.messages.find(
      (message) =>
        message.sender !== "SYSTEM" &&
        message.type !== "SYSTEM" &&
        message.type !== "NOTE",
    ) ?? null;
  const query = lastMeaningful?.body ?? "";
  if (!lastMeaningful || lastMeaningful.sender !== "VISITOR") return null;

  const { messages, context } = await buildConversationMessages({
    conversationId,
    siteId: conversation.siteId,
    siteName: conversation.site.name,
    query,
    config: decision.config,
    allowMutations: true,
  });

  const result = await runConversation({
    config: decision.config,
    messages,
    context,
  });

  if (!result.text.trim()) throw new AiError("模型没有返回内容");
  return {
    ...result,
    assistantName: decision.config.assistantName,
    targetMessageId: lastMeaningful.id,
  };
}

/** 访客消息入库后调用：满足条件就让 AI 回复，失败只记日志，不影响主流程 */
export async function maybeAutoReply(conversationId: string): Promise<void> {
  const active = autoReplies.get(conversationId);
  if (active) {
    active.dirty = true;
    return active.promise;
  }
  const state = { dirty: true, promise: Promise.resolve() };
  autoReplies.set(conversationId, state);
  state.promise = (async () => {
    for (let attempt = 0; state.dirty && attempt < 3; attempt += 1) {
      state.dirty = false;
      if (await runAutoReply(conversationId)) state.dirty = true;
    }
  })().finally(() => autoReplies.delete(conversationId));
  return state.promise;
}

const autoReplies = new Map<
  string,
  { dirty: boolean; promise: Promise<void> }
>();

/** A database lease coalesces triggers across instances without holding a transaction during inference. */
async function runAutoReply(conversationId: string): Promise<boolean> {
  const token = randomUUID();
  const claimed = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      status: { not: "CLOSED" },
      OR: [
        { aiReplyExpiresAt: null },
        { aiReplyExpiresAt: { lte: new Date() } },
      ],
    },
    data: {
      aiReplyToken: token,
      aiReplyExpiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  if (!claimed.count) return false;
  try {
    const generated = await generateAutoReply(conversationId);
    if (!generated) return false;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { siteId: true, status: true },
    });
    if (!conversation || conversation.status === "CLOSED") return false;
    if (!(await getSiteFeatures(conversation.siteId)).ai) return false;
    const config = await getAiConfig();
    if (!isAiReady(config) || config.autoReply === "off") return false;

    const inserted = await insertAiMessage({
      conversationId,
      siteId: conversation.siteId,
      body: generated.text,
      authorName: generated.assistantName,
      expectedMessageId: generated.targetMessageId,
      leaseToken: token,
      meta: {
        ai: {
          model: generated.model,
          tools: generated.trace,
          knowledge: generated.knowledge,
          rounds: generated.rounds,
          usage: generated.usage,
        },
      },
    });
    return inserted === null;
  } catch (error) {
    const message = error instanceof AiError ? error.message : String(error);
    console.error("[ai] 自动回复失败:", message);
    return false;
  } finally {
    await prisma.conversation.updateMany({
      where: { id: conversationId, aiReplyToken: token },
      data: { aiReplyToken: null, aiReplyExpiresAt: null },
    });
  }
}

/** 客服工作台：为当前会话生成一条可直接发送的建议回复 */
export async function suggestAgentReply(input: {
  user: SessionUser;
  conversationId: string;
  model?: string;
}): Promise<AiRunResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      siteId: true,
      status: true,
      site: { select: { name: true } },
      visitor: { select: { email: true, name: true } },
      messages: {
        where: {
          sender: { not: "SYSTEM" },
          type: { notIn: ["SYSTEM", "NOTE"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { body: true },
      },
    },
  });

  if (!conversation) throw new AiError("会话不存在");
  if (!canAccessSite(input.user, conversation.siteId)) {
    throw new AiError("无权访问该站点");
  }
  if (!(await getSiteFeatures(conversation.siteId)).ai)
    throw new HttpError(403, "当前套餐未开通 AI 功能");
  const config = await getAiConfig();
  if (!config.baseUrl || !config.apiKey || !config.model)
    throw new AiError("请先在后台「AI 助手」里配置接口、密钥与模型");

  const { messages, context } = await buildConversationMessages({
    conversationId: input.conversationId,
    siteId: conversation.siteId,
    siteName: conversation.site.name,
    query: conversation.messages[0]?.body ?? "",
    config,
    allowMutations: false,
    extraSystemHint: [
      "现在你是给「人工客服」提供草稿，不是直接回复访客。",
      "请输出一条客服可以直接发送的中文回复：口语化、先回应对方的问题、必要时给出下一步；",
      "只输出回复正文本身，不要加引号、不要解释你的思路。",
    ].join("\n"),
  });

  const result = await runConversation({
    config,
    messages,
    model: input.model,
    context,
  });

  if (!result.text.trim()) throw new AiError("模型没有返回内容");
  return result;
}

/** 后台「测试连接」用：直接问一句，看模型是否可用 */
export async function testAiConnection(input: {
  config?: AiConfig;
  prompt: string;
  model?: string;
}): Promise<{ text: string; model: string }> {
  const config = input.config ?? (await getAiConfig());
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new AiError("请先填写接口地址、API 密钥与模型");
  }

  const model = resolveModel(config, input.model);
  const text = await chatComplete(
    config,
    [
      { role: "system", content: "你是一个健康检查用的助手，回答保持一句话。" },
      { role: "user", content: input.prompt },
    ] satisfies AiMessage[],
    model,
  );
  return { text, model };
}
