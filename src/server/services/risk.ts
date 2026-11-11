import { HttpError } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { clientIp, rateLimit, rateLimitSource } from "../../lib/rate-limit";
import { matchesIp, matchesWord } from "../../lib/risk-matching";
import { readVisitorToken, verifyVisitorToken } from "../../lib/visitor-auth";
import { createTtlCache } from "../ttl-cache";

type RiskContext = {
  siteId: string;
  visitorId?: string;
  ip: string;
  context?: string;
};

type RuleKind = "IP" | "WORD";
type ActiveRule = {
  id: string;
  kind: string;
  value: string;
  expiresAt: Date | null;
};

/**
 * 每个访客请求都要过一遍规则，直接查库是每次两条查询，所以每个站点的规则列表缓存几秒。
 * 本进程里改规则会立刻清掉缓存（clearRiskRuleCache）；多实例部署时其他实例上的 HTTP 请求、
 * 以及绕过后台直接改库的变化，最多晚 RULE_CACHE_TTL_MS 才生效。
 * 自定义 server 和 Next 的各个打包层各加载一份本模块，缓存挂在 globalThis 上才是同一份。
 */
function ruleCacheTtl(): number {
  // 0 表示不缓存；没设、留空或写错时用默认 5 秒，上限 60 秒
  const raw = process.env.RISK_RULE_CACHE_TTL_MS?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, 60_000)
    : 5_000;
}
const RULE_CACHE_TTL_MS = ruleCacheTtl();
const globalForRisk = globalThis as unknown as {
  __beeRiskRules?: {
    lists: ReturnType<typeof createTtlCache<string, ActiveRule[]>>;
    generation: number;
  };
};
const ruleCache = (globalForRisk.__beeRiskRules ??= {
  lists: createTtlCache<string, ActiveRule[]>({
    ttlMs: RULE_CACHE_TTL_MS,
    maxEntries: 1_000,
  }),
  generation: 0,
});

/** 规则有改动后调用：本进程里下一个请求就按新规则判断 */
export function clearRiskRuleCache(): void {
  ruleCache.generation += 1;
  ruleCache.lists.clear();
}

async function loadRules(
  kind: RuleKind,
  siteId: string,
): Promise<ActiveRule[] | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { tenantId: true },
  });
  if (!site) return null;
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
    select: { id: true, kind: true, value: true, expiresAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/** fresh：不读缓存，直接查库（查到的结果仍会写回缓存） */
async function activeRules(
  kind: RuleKind,
  siteId: string,
  fresh = false,
): Promise<ActiveRule[]> {
  const key = `${kind}:${siteId}`;
  let rules = fresh ? undefined : ruleCache.lists.get(key);
  if (!rules) {
    const generation = ruleCache.generation;
    const loaded = await loadRules(kind, siteId);
    if (!loaded) return [];
    // 查库期间规则被改过的话，这份结果可能是旧的，不放进缓存
    if (RULE_CACHE_TTL_MS > 0 && generation === ruleCache.generation)
      ruleCache.lists.set(key, loaded);
    rules = loaded;
  }
  // 到期时间每次都重新比，缓存不会让已到期的规则多生效几秒
  const now = Date.now();
  return rules.filter(
    (rule) => !rule.expiresAt || rule.expiresAt.getTime() > now,
  );
}

/**
 * 被拦的客户端会不断重试，不能每次都写库：同一站点上同一条规则对同一来源、同一访客、同一场景十分钟只记一条，
 * 每个站点每类规则十分钟最多 300 条（不断换地址或身份也越不过这个数）。
 */
async function shouldRecord(
  input: RiskContext,
  rule: { id: string; kind: string },
  context: string,
): Promise<boolean> {
  const repeat = [
    "risk-event",
    input.siteId,
    rule.id,
    rateLimitSource(input.ip),
    input.visitorId ?? "-",
    context,
  ].join(":");
  if (!(await rateLimit(repeat, 1, 600)).ok) return false;
  return (
    await rateLimit(`risk-event-cap:${input.siteId}:${rule.kind}`, 300, 600)
  ).ok;
}

async function reject(
  input: RiskContext,
  rule: { id: string; kind: string; value: string },
  log: boolean,
): Promise<never> {
  const context = (input.context || "request").slice(0, 80);
  if (log && (await shouldRecord(input, rule, context)))
    await prisma.riskEvent.create({
      data: {
        kind: rule.kind,
        ruleId: rule.id,
        ruleValue: rule.value,
        siteId: input.siteId,
        visitorId: input.visitorId,
        ip: input.ip,
        context,
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
  options: { fresh?: boolean } = {},
): Promise<void> {
  const rule = (
    await activeRules("IP", input.siteId, options.fresh)
  ).find((rule) => matchesIp(input.ip, rule.value));
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

async function assertRequestBudget(key: string, limit: number): Promise<void> {
  if (!(await rateLimit(key, limit, 300)).ok)
    throw new HttpError(429, "请求过于频繁，请稍后再试");
}

/** Recheck the current connection IP even when a valid visitor token already exists. */
export async function verifyVisitorRequest(headers: Headers) {
  const ip = clientIp(headers);
  // 所有访客接口共用的总量上限，按来源地址和按访客各一道，比正常用量高一个数量级。
  // 来源这一道放在验令牌之前，超限的请求不再查库
  await assertRequestBudget(
    `widget:requests-ip:${rateLimitSource(ip)}`,
    12000,
  );
  const visitor = await verifyVisitorToken(readVisitorToken(headers));
  if (visitor) {
    await assertRequestBudget(`widget:requests:${visitor.visitorId}`, 1200);
    await assertIpAllowed({
      ...visitor,
      ip,
      context: "authenticated-request",
    });
  }
  return visitor;
}
