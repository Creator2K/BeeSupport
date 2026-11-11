import { prisma } from "../../lib/db";
import {
  buildSystemPrompt,
  chatCompletion,
  resolveModel,
  retrieveKnowledge,
  toAiMessages,
  type AiChatMessage,
  type AiConfig,
  type KnowledgeHit,
} from "../../lib/ai";
import {
  READ_ONLY_TOOLS,
  TOOL_DEFINITIONS,
  runTool,
  type AiKnowledgeTrace,
  type AiToolTrace,
  type ToolContext,
} from "./ai-tools";

export type AiRunResult = {
  text: string;
  model: string;
  trace: AiToolTrace[];
  knowledge: AiKnowledgeTrace[];
  rounds: number;
  requests: number;
  usage: { promptTokens: number; completionTokens: number } | null;
};

export async function runConversation(input: {
  config: AiConfig;
  messages: AiChatMessage[];
  model?: string;
  context: ToolContext;
}): Promise<AiRunResult> {
  const model = resolveModel(input.config, input.model);
  const messages: AiChatMessage[] = [...input.messages];

  const usageTotal = { promptTokens: 0, completionTokens: 0 };
  let requests = 0;
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
    requests += 1;
    const result = await chatCompletion(input.config, messages, {
      model,
      tools: tools.length > 0 ? tools : undefined,
      toolChoice: "auto",
    });

    if (result.usage) {
      usageTotal.promptTokens += result.usage.promptTokens;
      usageTotal.completionTokens += result.usage.completionTokens;
    } else {
      usageTotal.promptTokens += estimateMessageTokens(messages);
      usageTotal.completionTokens += estimateTextTokens(result.content);
    }

    if (result.toolCalls.length === 0) {
      return {
        text: result.content,
        model,
        trace: input.context.trace,
        knowledge: [...input.context.knowledge.values()],
        rounds,
        requests,
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
  requests += 1;
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
  } else {
    usageTotal.promptTokens += estimateMessageTokens(messages);
    usageTotal.completionTokens += estimateTextTokens(final.content);
  }

  return {
    text: final.content,
    model,
    trace: input.context.trace,
    knowledge: [...input.context.knowledge.values()],
    rounds,
    requests,
    usage: toUsageOrNull(usageTotal),
  };
}

function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 2));
}

function estimateMessageTokens(messages: AiChatMessage[]): number {
  return messages.reduce(
    (sum, message) => sum + estimateTextTokens(message.content ?? ""),
    0,
  );
}
function toUsageOrNull(total: {
  promptTokens: number;
  completionTokens: number;
}): { promptTokens: number; completionTokens: number } | null {
  return total.promptTokens > 0 || total.completionTokens > 0
    ? { ...total }
    : null;
}

export async function buildConversationMessages(input: {
  conversationId: string;
  siteId: string;
  siteName: string;
  query: string;
  config: AiConfig;
  policy?: import("../../lib/ai-policy").EffectiveAiPolicy;
  allowMutations: boolean;
  expectedMessageId?: string;
  leaseToken?: string;
  jobId?: string;
  jobRevision?: number;
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
    policy: input.policy,
    allowMutations: input.allowMutations,
    expectedMessageId: input.expectedMessageId,
    leaseToken: input.leaseToken,
    jobId: input.jobId,
    jobRevision: input.jobRevision,
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
