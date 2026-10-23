import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";

import type { AgentStatus, Role } from "@prisma/client";

import { prisma } from "./db";
import { env } from "./env";
import { disconnectSession } from "./realtime/emit";

export const SESSION_COOKIE = "beesupport_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 天

const secretKey = new TextEncoder().encode(env.AUTH_SECRET);

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
  locale: string;
  status: AgentStatus;
  /** null 表示可访问全部站点（管理员） */
  siteIds: string[] | null;
  tenantId: string;
  tenantStatus: string;
  tenantExpired: boolean;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signSessionToken(payload: {
  userId: string;
  role: Role;
  tokenVersion: number;
}): Promise<string> {
  return new SignJWT({ role: payload.role, tv: payload.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey);
}

export async function createSession(
  userId: string,
  role: Role,
  tokenVersion: number,
): Promise<void> {
  const token = await signSessionToken({ userId, role, tokenVersion });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // 按站点协议决定：内网 http 自部署（http://192.168.x.x）也必须能登录
    secure: env.APP_URL.startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (token) disconnectSession(token);
}

/** 由 token 解析出登录用户（Socket.IO 握手等没有 cookies() 的场景复用） */
export async function resolveUserFromToken(
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    const userId = payload.sub;
    if (!userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        sites: { select: { siteId: true } },
        tenant: {
          select: {
            status: true,
            expiresAt: true,
            sites: { select: { id: true } },
          },
        },
      },
    });

    if (!user || !user.active) return null;
    if (user.emailVerificationRequired && !user.emailVerifiedAt) return null;
    // 改密码 / 禁用后 tokenVersion 变化，旧 token 立即失效
    if (payload.tv !== user.tokenVersion) {
      return null;
    }

    if (user.role !== "ADMIN" && user.tenant.status !== "ACTIVE") return null;
    return {
      tenantId: user.tenantId,
      tenantStatus: user.tenant.status,
      tenantExpired:
        !!user.tenant.expiresAt && user.tenant.expiresAt <= new Date(),
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      status: user.status,
      siteIds:
        user.role === "ADMIN"
          ? null
          : user.role === "MERCHANT_ADMIN"
            ? user.tenant.sites.map((s) => s.id)
            : user.sites.map((s) => s.siteId),
    };
  } catch {
    return null;
  }
}

/** 当前请求的登录用户，同一请求内只查一次库 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return resolveUserFromToken(store.get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "未登录或登录已过期");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MERCHANT_ADMIN")
    throw new HttpError(403, "需要管理员权限");
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new HttpError(403, "需要平台管理员权限");
  return user;
}

export function canAccessSite(user: SessionUser, siteId: string): boolean {
  return user.siteIds === null || user.siteIds.includes(siteId);
}

export function assertSiteAccess(user: SessionUser, siteId: string): void {
  if (!canAccessSite(user, siteId)) {
    throw new HttpError(403, "无权访问该站点");
  }
}

/** 访客可用的客服（在线优先），用于排队提示 */
export async function countOnlineAgents(siteId: string): Promise<number> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { tenantId: true },
  });
  if (!site) return 0;
  return prisma.user.count({
    where: {
      tenantId: site.tenantId,
      role: { not: "ADMIN" },
      active: true,
      status: { in: ["ONLINE", "AWAY"] },
      lastSeenAt: { gte: new Date(Date.now() - 90_000) },
      OR: [{ role: "MERCHANT_ADMIN" }, { sites: { some: { siteId } } }],
    },
  });
}
