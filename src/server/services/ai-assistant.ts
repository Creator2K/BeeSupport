import {
  AiError,
  chatComplete,
  getAiConfig,
  resolveModel,
  type AiConfig,
  type AiMessage,
} from "../../lib/ai";
import { HttpError, canAccessSite, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { readAiContext } from "./ai-context";
import { resolveAiPolicyForSite } from "./ai-policy";
import {
  buildConversationMessages,
  runConversation,
  type AiRunResult,
} from "./ai-runner";
import { checkAiQuota, recordAiUsage } from "./ai-usage";

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
  const resolved = await resolveAiPolicyForSite(conversation.siteId);
  if (!resolved?.policy.enabled)
    throw new HttpError(403, "当前商家或站点未启用 AI 功能");
  const config = resolved.policy.config;
  if (!(await readAiContext(prisma, input, true)))
    throw new HttpError(403, "当前会话不可使用 AI 功能");
  const quota = await checkAiQuota(resolved.tenantId, conversation.siteId, resolved.policy);
  if (!quota.ok)
    throw new AiError(
      quota.reason === "request_limit"
        ? "AI 本月调用次数已达上限，请联系商家管理员调整策略"
        : "AI 本月用量已达上限，请联系商家管理员调整策略",
    );

  const { messages, context } = await buildConversationMessages({
    conversationId: input.conversationId,
    siteId: conversation.siteId,
    siteName: conversation.site.name,
    query: conversation.messages[0]?.body ?? "",
    config,
    policy: resolved.policy,
    allowMutations: false,
    extraSystemHint: [
      "现在你是给「人工客服」提供草稿，不是直接回复访客。",
      "请输出一条客服可以直接发送的中文回复：口语化、先回应对方的问题、必要时给出下一步；",
      "只输出回复正文本身，不要加引号、不要解释你的思路。",
    ].join("\n"),
  });

  try {
    const result = await runConversation({
      config,
      messages,
      model: input.model,
      context,
    });
    if (!result.text.trim()) throw new AiError("模型没有返回内容");
    await recordAiUsage({
      tenantId: resolved.tenantId,
      siteId: conversation.siteId,
      requests: result.requests,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
    });
    if (
      !(await readAiContext(prisma, input, true)) ||
      !(await resolveAiPolicyForSite(conversation.siteId))?.policy.enabled
    )
      throw new HttpError(403, "当前会话不可使用 AI 功能");
    return result;
  } catch (error) {
    await recordAiUsage({
      tenantId: resolved.tenantId,
      siteId: conversation.siteId,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      failed: true,
    }).catch(() => undefined);
    throw error;
  }
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
