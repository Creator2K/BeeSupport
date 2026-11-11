import "dotenv/config";

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { chatCompletion, retrieveKnowledge } from "../src/lib/ai.ts";
import { prisma } from "../src/lib/db.ts";
import { resolveAiPolicyForSite } from "../src/server/services/ai-policy.ts";
import { runAiQualityCases } from "../src/server/services/ai-quality.ts";
import { checkAiQuota, recordAiUsage } from "../src/server/services/ai-usage.ts";

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    "site-slug": { type: "string" },
    cases: { type: "string", default: "config/ai-quality-cases.json" },
    out: { type: "string" },
    "live-knowledge": { type: "boolean", default: false },
  },
});

let siteId = values.site ?? process.env.AI_QUALITY_SITE_ID;
if (!siteId && values["site-slug"]) {
  const site = await prisma.site.findUnique({
    where: { slug: values["site-slug"] },
    select: { id: true },
  });
  if (!site) throw new Error(`找不到站点 slug：${values["site-slug"]}`);
  siteId = site.id;
}
if (!siteId) throw new Error("请通过 --site、--site-slug 或 AI_QUALITY_SITE_ID 指定评估站点");

try {
  const resolved = await resolveAiPolicyForSite(siteId);
  if (!resolved) throw new Error(`找不到站点：${siteId}`);
  if (!resolved.policy.enabled) throw new Error("该商家或站点的 AI 功能未启用");
  const config = resolved.policy.config;
  const quota = await checkAiQuota(resolved.tenantId, siteId, resolved.policy);
  if (!quota.ok)
    throw new Error(`AI 本月额度不足：${quota.reason}（${quota.action}）`);

  const casesPath = resolve(values.cases);
  const cases = JSON.parse(await readFile(casesPath, "utf8"));
  const useLive = values["live-knowledge"] === true;
  const run = await runAiQualityCases({
    config,
    cases,
    retrieve: useLive
      ? (testCase) =>
          retrieveKnowledge({
            siteId,
            query: testCase.question,
            topK: config.topK,
            config,
          })
      : undefined,
    complete: (messages) =>
      chatCompletion(config, messages, { model: config.model }),
  });

  for (const result of run.cases) {
    await recordAiUsage({
      tenantId: resolved.tenantId,
      siteId,
      requests: result.answer ? 1 : 0,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      failed: !result.answer,
    });
  }

  const report = {
    ...run,
    evaluatedAt: new Date().toISOString(),
    siteId,
    siteName: resolved.siteName,
    model: resolved.policy.config.model,
    mode: useLive ? "live-knowledge" : "fixture-knowledge",
    promptSha256: createHash("sha256")
      .update(resolved.policy.config.systemPrompt)
      .digest("hex"),
  };
  const outPath = values.out
    ? resolve(values.out)
    : resolve("test-results/ai-quality", `run-${Date.now()}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const result of run.cases) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.reason}`);
  }
  console.log(`AI quality: ${run.passed} passed, ${run.failed} failed`);
  console.log(`Report: ${outPath}`);
  if (run.status !== "passed") process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
