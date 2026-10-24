import type { AiConfig } from "../../lib/ai";

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
