import {
  retrieveKnowledge,
  type AiConfig,
  type AiToolCall,
  type OpenAiTool,
} from "../../lib/ai";
import { prisma } from "../../lib/db";
import { describeVisitor } from "../../lib/visitor-env";
import {
  broadcastConversation,
  broadcastMessage,
} from "./broadcast";

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

export type ToolContext = {
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
export const TOOL_DEFINITIONS: OpenAiTool[] = [
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
export const READ_ONLY_TOOLS = new Set([
  "search_knowledge",
  "get_visitor_context",
]);

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

export async function runTool(
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

