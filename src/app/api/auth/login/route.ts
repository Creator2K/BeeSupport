import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { loginDestination } from "@/server/services/onboarding";
import { createSession, verifyPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  clientIp,
  rateLimit,
  rateLimitStatus,
  resetRateLimit,
} from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";

const bodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码"),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ip = clientIp(request.headers);
    const parsed = bodySchema.parse(await readJson(request));

    // A broad request cap protects password hashing; tight budgets count failures only.
    const [ipLimit, ipFailures, accountLimit] = await Promise.all([
      rateLimit(`login:requests:${ip}`, 200, 600),
      rateLimitStatus(`login:failed:ip:${ip}`, 50, 600),
      rateLimitStatus(`login:failed:account:${parsed.email}`, 10, 600),
    ]);

    if (!ipLimit.ok || !ipFailures.ok || !accountLimit.ok) {
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

    const passwordOk =
      user && user.active
        ? await verifyPassword(parsed.password, user.passwordHash)
        : false;

    if (!user || !passwordOk) {
      await Promise.all([
        rateLimit(`login:failed:ip:${ip}`, 50, 600),
        rateLimit(`login:failed:account:${parsed.email}`, 10, 600),
      ]);
      await recordAudit({
        action: user ? "auth.login.failed" : "auth.login.unknown_user",
        actorId: user?.id ?? null,
        actorName: parsed.email,
        ip,
      });
      return NextResponse.json(
        {
          error: user && !user.active ? "该账号已被禁用" : "邮箱或密码不正确",
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
    await resetRateLimit(`login:failed:account:${parsed.email}`, 600);
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
