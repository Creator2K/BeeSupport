import type { AiConfig } from "../../lib/ai";
import type { EffectiveAiPolicy } from "../../lib/ai-policy";

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
  policy?: EffectiveAiPolicy;
  /** 建议草稿场景下不允许改会话（只读工具） */
  allowMutations: boolean;
  expectedMessageId?: string;
  leaseToken?: string;
  jobId?: string;
  jobRevision?: number;
  query: string;
  trace: AiToolTrace[];
  knowledge: Map<string, AiKnowledgeTrace>;
};
