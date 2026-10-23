import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";
import { pickVisitorEnv } from "@/lib/visitor-env";
import { signVisitorToken } from "@/lib/visitor-auth";
import { getSiteAvailability, resolveSiteByKey } from "@/lib/widget";
import { getVisitorConversationState } from "@/server/services/conversations";
import { touchVisitorOnSession } from "@/server/services/visitors";
import {
  assertIpAllowed,
  assertVisitorContentAllowed,
} from "@/server/services/risk";
import { assertWidgetOriginAllowed } from "@/lib/widget-origin";

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const bodySchema = z.object({
  key: z.string().min(1),
  localKey: z.string().min(8).max(64),
  email: z.string().trim().max(200).optional(),
  name: z.string().trim().max(80).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  // 环境信息（屏幕、时区、浏览器、网络等），服务端会按白名单过滤
  env: z.record(z.string(), scalar).optional(),
  pageUrl: z.string().max(500).optional(),
  pageTitle: z.string().max(200).optional(),
  referrer: z.string().max(500).optional(),
});

/**
 * 访客身份门槛：填写邮箱后签发访客令牌（存在访客浏览器 localStorage）。
 * 二次访问时前端会自动带上已保存的邮箱，无需重复填写。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ip = clientIp(request.headers);
    const limit = await rateLimit(`widget:session:${ip}`, 30, 600);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429 },
      );
    }

    const input = bodySchema.parse(await readJson(request));
    const site = await resolveSiteByKey(input.key);
    await assertWidgetOriginAllowed(site, request.headers);
    await assertIpAllowed({ siteId: site.id, ip, context: "session" });
    await assertVisitorContentAllowed({
      siteId: site.id,
      ip,
      text: `${input.name || ""} ${input.email || ""}`,
      context: "identity",
    });

    let email = "";
    if (site.requireEmail) {
      email = emailSchema.parse(input.email ?? "");
    } else if (input.email) {
      email = emailSchema.parse(input.email);
    }

    const env = {
      ...pickVisitorEnv(input.meta),
      ...pickVisitorEnv(input.env),
      ip,
    };

    const visitor = await prisma.visitor.upsert({
      where: { siteId_localKey: { siteId: site.id, localKey: input.localKey } },
      create: {
        siteId: site.id,
        localKey: input.localKey,
        email,
        name: input.name || null,
        meta: env,
        landingPage: input.pageUrl ?? null,
        lastPage: input.pageUrl ?? null,
        lastPageTitle: input.pageTitle ?? null,
        referrer: input.referrer ?? null,
        lastSeenAt: new Date(),
      },
      update: {
        email: email || undefined,
        name: input.name || undefined,
      },
    });

    // 环境信息、页面轨迹、访问次数（半小时以上空闲算新访问）
    await touchVisitorOnSession({
      visitorId: visitor.id,
      env,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      referrer: input.referrer,
    });

    if (visitor.blocked) {
      throw new HttpError(403, "该访客已被限制");
    }

    const token = await signVisitorToken({
      visitorId: visitor.id,
      siteId: site.id,
      email: visitor.email,
      localKey: visitor.localKey,
    });

    const [availability, state] = await Promise.all([
      getSiteAvailability(site),
      getVisitorConversationState({
        visitorId: visitor.id,
        siteId: site.id,
        email: visitor.email,
        localKey: visitor.localKey,
      }),
    ]);

    return NextResponse.json({
      token,
      visitor: {
        id: visitor.id,
        email: visitor.email,
        name: visitor.name,
      },
      availability,
      ...state,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
