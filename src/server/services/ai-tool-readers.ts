import { retrieveKnowledge } from "../../lib/ai";
import { prisma } from "../../lib/db";
import { describeVisitor } from "../../lib/visitor-env";
import type { ToolContext } from "./ai-tool-types";

export async function searchKnowledge(
  context: ToolContext,
  args: Record<string, unknown>,
  name: string,
  startedAt: number,
): Promise<string> {

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
    name: name,
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

export async function getVisitorContext(
  context: ToolContext,
  args: Record<string, unknown>,
  name: string,
  startedAt: number,
): Promise<string> {

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
    name: name,
    arguments: {},
    summary: `读取访客资料（${visitor.email || "匿名"}）`,
    ok: true,
    ms: Date.now() - startedAt,
  });
  return lines.join("\n");
}
