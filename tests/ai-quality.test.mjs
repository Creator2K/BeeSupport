import { test } from "node:test";
import assert from "node:assert/strict";

import { loadAiModule, loadModule } from "./load-module.mjs";

const ai = loadAiModule();
const quality = loadModule("src/server/services/ai-quality.ts", {
  "../../lib/ai": ai,
});

test("fixed AI quality cases evaluate knowledge, fallback and forbidden claims", async () => {
  const cases = JSON.parse(
    await (await import("node:fs/promises")).readFile("config/ai-quality-cases.json", "utf8"),
  );
  const answers = new Map([
    ["标准版一个月多少钱？", "标准版是 299 元/月。"],
    ["你们明天早上八点一定有人在线吗？", "无法确认，建议留言给人工客服。"],
    ["我买了一个月，可以 30 天无理由退货吗？", "签收后 7 天内可以无理由退货。"],
    ["这个问题我要投诉，请马上转人工客服。", "我会为你转接人工客服。"],
  ]);
  const run = await quality.runAiQualityCases({
    config: { ...ai.defaultAiConfig(), enabled: true, model: "mock" },
    cases,
    complete: async (messages) => {
      const question = messages.find((message) => message.role === "user")?.content ?? "";
      return {
        content: answers.get(question) ?? "无法确认，请转人工。",
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5 },
        raw: { role: "assistant", content: "" },
      };
    },
  });
  assert.equal(run.status, "passed");
  assert.equal(run.failed, 0);
  assert.equal(run.cases.length, 4);
});

test("quality evaluation reports missing knowledge and unsafe claims", async () => {
  const run = await quality.runAiQualityCases({
    config: { ...ai.defaultAiConfig(), enabled: true, model: "mock" },
    cases: [
      {
        id: "knowledge",
        category: "knowledge_hit",
        question: "退款多久到账？",
        expectedKnowledgeTitle: "退款时效",
        expectAny: ["7 天"],
      },
      {
        id: "unsafe",
        category: "policy_conflict",
        question: "可以退吗？",
        expectAny: ["7 天"],
        forbidAny: ["随便退"],
      },
    ],
    complete: async () => ({
      content: "可以随便退。",
      toolCalls: [],
      finishReason: "stop",
      usage: null,
      raw: { role: "assistant", content: "" },
    }),
  });
  assert.equal(run.status, "failed");
  assert.equal(run.failed, 2);
  assert.match(run.cases[0].reason, /没有召回/);
  assert.match(run.cases[1].reason, /未包含|禁止/);
});
