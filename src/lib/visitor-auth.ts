import { SignJWT, jwtVerify } from "jose";

import { tenantCanServe } from "../server/services/tenants";
import { env } from "./env";
import { prisma } from "./db";

/**
 * 访客身份：发起会话前必须填写邮箱，服务端校验后签发访客令牌。
 * 令牌存在访客浏览器的 localStorage 中，随请求头与 Socket.IO 握手带上。
 */
const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 天
const secretKey = new TextEncoder().encode(`${env.AUTH_SECRET}:visitor`);

export type VisitorSession = {
  visitorId: string;
  siteId: string;
  email: string;
  localKey: string;
};

export async function signVisitorToken(
  session: VisitorSession,
): Promise<string> {
  return new SignJWT({
    siteId: session.siteId,
    email: session.email,
    localKey: session.localKey,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.visitorId)
    .setAudience("beesupport:visitor")
    .setIssuedAt()
    .setExpirationTime(`${VISITOR_TTL_SECONDS}s`)
    .sign(secretKey);
}

export async function verifyVisitorToken(
  token: string | undefined | null,
): Promise<VisitorSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      audience: "beesupport:visitor",
      algorithms: ["HS256"],
    });
    if (
      !payload.sub ||
      typeof payload.siteId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    const visitor = await prisma.visitor.findUnique({
      where: { id: payload.sub },
      select: {
        siteId: true,
        blocked: true,
        site: {
          select: {
            active: true,
            tenant: { select: { status: true, expiresAt: true } },
          },
        },
      },
    });
    if (
      !visitor ||
      visitor.blocked ||
      !visitor.site.active ||
      !tenantCanServe(visitor.site.tenant) ||
      visitor.siteId !== payload.siteId
    )
      return null;
    return {
      visitorId: payload.sub,
      siteId: payload.siteId,
      email: payload.email,
      localKey: typeof payload.localKey === "string" ? payload.localKey : "",
    };
  } catch {
    return null;
  }
}

/** 从请求头中取出访客令牌（Authorization: Bearer xxx 优先，其次 x-visitor-token） */
export function readVisitorToken(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return headers.get("x-visitor-token");
}
