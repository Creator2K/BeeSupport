import type {
  AiChatMessage,
  AiChatResult,
  AiConfig,
  KnowledgeHit,
} from "../../lib/ai";
import { buildSystemPrompt, chatCompletion } from "../../lib/ai";

export type AiQualityCase = {
  id: string;
  category: "knowledge_hit" | "unknown" | "policy_conflict" | "handoff";
  question: string;
  knowledge?: Array<{ title: string; content: string }>;
  expectedKnowledgeTitle?: string;
  useLiveKnowledge?: boolean;
  expectAny?: string[];
  forbidAny?: string[];
};

export type AiQualityCaseResult = {
  id: string;
  category: AiQualityCase["category"];
  passed: boolean;
  reason: string;
  question: string;
  answer: string;
  expectedKnowledgeTitle: string | null;
  retrievedTitles: string[];
  usage: AiChatResult["usage"];
  durationMs: number;
};

export type AiQualityRun = {
  status: "passed" | "failed";
  passed: number;
  failed: number;
  cases: AiQualityCaseResult[];
};

export async function runAiQualityCases(input: {
  config: AiConfig;
  cases: AiQualityCase[];
  retrieve?: (testCase: AiQualityCase) => Promise<KnowledgeHit[]>;
  complete?: (messages: AiChatMessage[]) => Promise<AiChatResult>;
}): Promise<AiQualityRun> {
  const results: AiQualityCaseResult[] = [];
  for (const testCase of input.cases) {
    const startedAt = Date.now();
    const knowledge = await resolveKnowledge(testCase, input.retrieve);
    const messages: AiChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({
          config: input.config,
          siteName: "质量评估站点",
          knowledge,
        }),
      },
      { role: "user", content: testCase.question },
    ];
    try {
      const result = await (input.complete
        ? input.complete(messages)
        : chatCompletion(input.config, messages, { model: input.config.model }));
      const assessment = assessAnswer(testCase, result.content, knowledge);
      results.push({
        id: testCase.id,
        category: testCase.category,
        passed: assessment.passed,
        reason: assessment.reason,
        question: testCase.question,
        answer: result.content,
        expectedKnowledgeTitle: testCase.expectedKnowledgeTitle ?? null,
        retrievedTitles: knowledge.map((item) => item.title),
        usage: result.usage,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        category: testCase.category,
        passed: false,
        reason: `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
        question: testCase.question,
        answer: "",
        expectedKnowledgeTitle: testCase.expectedKnowledgeTitle ?? null,
        retrievedTitles: knowledge.map((item) => item.title),
        usage: null,
        durationMs: Date.now() - startedAt,
      });
    }
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    status: passed === results.length ? "passed" : "failed",
    passed,
    failed: results.length - passed,
    cases: results,
  };
}

async function resolveKnowledge(
  testCase: AiQualityCase,
  retrieve?: (testCase: AiQualityCase) => Promise<KnowledgeHit[]>,
): Promise<KnowledgeHit[]> {
  if (testCase.useLiveKnowledge && retrieve) return retrieve(testCase);
  return (testCase.knowledge ?? []).map((entry, index) => ({
    id: `${testCase.id}:${index}`,
    knowledgeId: `${testCase.id}:${index}`,
    title: entry.title,
    content: entry.content,
    score: 1,
    via: "keyword",
  }));
}

function assessAnswer(
  testCase: AiQualityCase,
  answer: string,
  knowledge: KnowledgeHit[],
): { passed: boolean; reason: string } {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return { passed: false, reason: "模型返回空内容" };
  if (
    testCase.expectedKnowledgeTitle &&
    !knowledge.some((item) => item.title === testCase.expectedKnowledgeTitle)
  )
    return {
      passed: false,
      reason: `没有召回预期知识：${testCase.expectedKnowledgeTitle}`,
    };
  if (
    testCase.expectAny?.length &&
    !testCase.expectAny.some((word) => normalized.includes(word.toLowerCase()))
  )
    return {
      passed: false,
      reason: `回答未包含任一预期词：${testCase.expectAny.join("、")}`,
    };
  const forbidden = testCase.forbidAny?.find((word) =>
    normalized.includes(word.toLowerCase()),
  );
  if (forbidden)
    return { passed: false, reason: `回答包含禁止内容：${forbidden}` };
  return { passed: true, reason: "符合固定评估规则" };
}
