import type { Prisma } from "@prisma/client";

import { HttpError, type SessionUser } from "../../lib/auth";

export function scope(actor: SessionUser): Prisma.ConversationWhereInput {
  if (
    !actor.tenantId ||
    !["ADMIN", "MERCHANT_ADMIN", "AGENT"].includes(actor.role)
  )
    throw new HttpError(403, "无权访问未回复提醒");
  return {
    ...(actor.role === "ADMIN" ? {} : { site: { tenantId: actor.tenantId } }),
    ...(actor.siteIds === null ? {} : { siteId: { in: actor.siteIds } }),
  };
}
export function siteScope(actor: SessionUser, siteId: string): Prisma.SiteWhereInput {
  scope(actor);
  if (actor.role === "AGENT") throw new HttpError(403, "需要管理员权限");
  return {
    id: siteId,
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    ...(actor.siteIds === null ? {} : { AND: [{ id: { in: actor.siteIds } }] }),
  };
}
export function ownerScope(tenantId: string, siteId: string): Prisma.UserWhereInput {
  return {
    tenantId,
    active: true,
    OR: [
      { role: { in: ["ADMIN", "MERCHANT_ADMIN"] } },
      { role: "AGENT", sites: { some: { siteId } } },
    ],
  };
}

export function serviceActive(now: Date): Prisma.SiteWhereInput {
  return {
    active: true,
    unansweredRule: { is: { enabled: true } },
    tenant: {
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  };
}

export function activeReminder(now: Date): Prisma.UnansweredReminderWhereInput {
  return {
    resolvedAt: null,
    conversation: {
      status: { in: ["PENDING", "OPEN"] },
      waitingMessageId: { not: null },
      site: serviceActive(now),
    },
  };
}
