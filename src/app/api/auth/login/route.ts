import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { loginDestination } from "@/server/services/onboarding";
import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  clientIp,
  rateLimit,
  rateLimitSource,
  rateLimitStatus,
  resetRateLimit,
} from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";

const bodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码"),
});

// 账号不存在时拿它做一次同样成本的比对，响应时间不暴露账号是否存在；没有人知道它对应的口令
let placeholderHash: Promise<string> | undefined;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ip = clientIp(request.headers);
    const source = rateLimitSource(ip);
    const parsed = bodySchema.parse(await readJson(request));
    // 失败次数按「账号 + 来源」计，别人输错密码锁不住账号主人；
    // 账号合计另设一个高得多的上限，挡住分散在很多地址上的猜口令
    const sourceFailures = `login:failed:account-ip:${parsed.email}:${source}`;
    const accountFailures = `login:failed:account:${parsed.email}`;

    // A broad request cap protects password hashing; tight budgets count failures only.
    const [ipLimit, ipFailures, sourceLimit, accountLimit] = await Promise.all([
      rateLimit(`login:requests:${source}`, 200, 600),
      rateLimitStatus(`login:failed:ip:${source}`, 50, 600),
      rateLimitStatus(sourceFailures, 10, 600),
      rateLimitStatus(accountFailures, 100, 600),
    ]);

    if (!ipLimit.ok || !ipFailures.ok || !sourceLimit.ok || !accountLimit.ok) {
      await recordAudit({
        action: "auth.login.rate_limited",
        actorName: parsed.email,
        ip,
      });
      return NextResponse.json(
        { error: "尝试次数过多，请稍后再试" },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(
                1,
                Math.ceil(
                  (Math.max(
                    ipLimit.resetAt,
                    ipFailures.resetAt,
                    sourceLimit.resetAt,
                    accountLimit.resetAt,
                  ) -
                    Date.now()) /
                    1000,
                ),
              ),
            ),
          },
        },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        active: true,
        passwordHash: true,
        tokenVersion: true,
        emailVerificationRequired: true,
        emailVerifiedAt: true,
        tenant: { select: { status: true } },
      },
    });

    // 账号不存在或已停用时也照常比对一次，耗时和提示都不暴露账号状态
    const passwordMatches = await verifyPassword(
      parsed.password,
      user?.passwordHash ??
        (await (placeholderHash ??= hashPassword(crypto.randomUUID()))),
    );

    if (!user || !user.active || !passwordMatches) {
      await Promise.all([
        rateLimit(`login:failed:ip:${source}`, 50, 600),
        rateLimit(sourceFailures, 10, 600),
        rateLimit(accountFailures, 100, 600),
      ]);
      await recordAudit({
        action: user ? "auth.login.failed" : "auth.login.unknown_user",
        actorId: user?.id ?? null,
        actorName: parsed.email,
        ip,
      });
      return NextResponse.json(
        {
          // 走到这里且密码正确，只可能是账号停用：只有知道密码的人才会被告知
          error:
            user && passwordMatches ? "该账号已被禁用" : "邮箱或密码不正确",
        },
        { status: 401 },
      );
    }

    if (user.emailVerificationRequired && !user.emailVerifiedAt)
      return NextResponse.json(
        {
          error: "请先验证邮箱，可通过下方入口重新发送验证邮件",
          verificationRequired: true,
        },
        { status: 403 },
      );
    if (user.role !== "ADMIN" && user.tenant.status !== "ACTIVE")
      return NextResponse.json(
        { error: "商家尚未开通或已停用，请联系平台管理员" },
        { status: 403 },
      );
    await createSession(user.id, user.role, user.tokenVersion);
    await resetRateLimit(sourceFailures, 600);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });
    await recordAudit({
      action: "auth.login",
      actorId: user.id,
      actorName: user.name,
      ip,
    });

    return NextResponse.json({
      ok: true,
      user: { id: user.id, name: user.name, role: user.role },
      redirectTo: await loginDestination(user),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
