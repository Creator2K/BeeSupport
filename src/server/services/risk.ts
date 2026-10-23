import { HttpError } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { clientIp } from "../../lib/rate-limit";
import { matchesIp, matchesWord } from "../../lib/risk-matching";
import { readVisitorToken, verifyVisitorToken } from "../../lib/visitor-auth";

type RiskContext = {
  siteId: string;
  visitorId?: string;
  ip: string;
  context?: string;
};

async function activeRules(kind: "IP" | "WORD", siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { tenantId: true },
  });
  if (!site) return [];
  return prisma.riskRule.findMany({
    where: {
      tenantId: site.tenantId,
      kind,
      active: true,
      AND: [
        { OR: [{ siteId: null }, { siteId }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}

async function reject(
  input: RiskContext,
  rule: { id: string; kind: string; value: string },
  log: boolean,
): Promise<never> {
  if (log)
    await prisma.riskEvent.create({
      data: {
        kind: rule.kind,
        ruleId: rule.id,
        ruleValue: rule.value,
        siteId: input.siteId,
        visitorId: input.visitorId,
        ip: input.ip,
        context: (input.context || "request").slice(0, 80),
      },
    });
  throw new HttpError(
    403,
    rule.kind === "WORD"
      ? "内容包含不允许发送的词语，请修改后重试"
      : "当前网络已被限制访问，请联系站点管理员",
  );
}

export async function assertIpAllowed(
  input: RiskContext,
  log = true,
): Promise<void> {
  const rule = (await activeRules("IP", input.siteId)).find((rule) =>
    matchesIp(input.ip, rule.value),
  );
  if (rule) await reject(input, rule, log);
}

export async function assertVisitorContentAllowed(
  input: RiskContext & { text: string },
): Promise<void> {
  const rule = (await activeRules("WORD", input.siteId)).find((rule) =>
    matchesWord(input.text, rule.value),
  );
  if (rule) await reject(input, rule, true);
}

/** Recheck the current connection IP even when a valid visitor token already exists. */
export async function verifyVisitorRequest(headers: Headers) {
  const visitor = await verifyVisitorToken(readVisitorToken(headers));
  if (visitor)
    await assertIpAllowed({
      ...visitor,
      ip: clientIp(headers),
      context: "authenticated-request",
    });
  return visitor;
}
