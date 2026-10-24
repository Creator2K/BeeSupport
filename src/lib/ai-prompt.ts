import {
  DEFAULT_SYSTEM_PROMPT,
  type AiConfig,
} from "./ai-config";
import type { AiMessage } from "./ai-provider";
import type { KnowledgeHit } from "./ai-retrieval";

export function buildSystemPrompt(input: {
  config: AiConfig;
  siteName: string;
  knowledge: Pick<KnowledgeHit, "title" | "content">[];
}): string {
  const base = (input.config.systemPrompt || DEFAULT_SYSTEM_PROMPT).replace(
    /\{siteName\}/g,
    input.siteName,
  );

  if (input.knowledge.length === 0) {
    return `${base}\n\n知识库：暂无匹配内容，遇到具体政策或价格请让访客留言给人工客服。`;
  }

  const context = input.knowledge
    .map((entry, index) => `【${index + 1}】${entry.title}\n${entry.content}`)
    .join("\n\n");

  return `${base}\n\n知识库（按相关度排序，优先使用）：\n${context}`;
}

/** 把会话历史转成模型消息（跳过内部备注与系统消息） */
export function toAiMessages(
  rows: {
    sender: "VISITOR" | "AGENT" | "SYSTEM" | "AI";
    type: string;
    body: string;
    authorName: string | null;
  }[],
  limit: number,
): AiMessage[] {
  return rows
    .filter(
      (row) => row.type !== "NOTE" && row.type !== "SYSTEM" && row.body.trim(),
    )
    .slice(-limit)
    .map((row) => {
      if (row.sender === "VISITOR") {
        return { role: "user" as const, content: row.body };
      }
      if (row.sender === "AI") {
        return { role: "assistant" as const, content: row.body };
      }
      if (row.sender === "AGENT") {
        return {
          role: "assistant" as const,
          content: `${row.authorName ?? "客服"}：${row.body}`,
        };
      }
      return { role: "system" as const, content: row.body };
    });
}
