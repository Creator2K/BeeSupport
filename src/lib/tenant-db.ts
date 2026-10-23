import type { PrismaClient } from "@prisma/client";
import { HttpError, requireAdmin, type SessionUser } from "./auth";
import { prisma } from "./db";

/** Explicitly scoped clients: no ambient state shared between HTTP requests or sockets. */
export function tenantDb(user: SessionUser): PrismaClient {
  if (user.role === "ADMIN") return prisma;
  const tenantId = user.tenantId;
  const direct = new Set([
    "User",
    "Site",
    "CannedResponse",
    "AiKnowledge",
    "WebhookEndpoint",
    "RiskRule",
    "AuditLog",
  ]);
  const siteOwned = new Set([
    "Visitor",
    "Conversation",
    "Attachment",
    "RiskEvent",
  ]);
  return prisma.$extends({
    name: "merchant-isolation",
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        if (!model)
          throw new HttpError(403, "商家查询不能使用未限定范围的 SQL");
        const billingModel =
          model === "SubscriptionOrder" ||
          model === "SubscriptionPlan" ||
          model === "AccountNotice";
        if (
          billingModel &&
          ![
            "findUnique",
            "findUniqueOrThrow",
            "findFirst",
            "findFirstOrThrow",
            "findMany",
            "count",
            "aggregate",
            "groupBy",
          ].includes(operation)
        )
          throw new HttpError(
            403,
            model === "AccountNotice"
              ? "通知必须通过专用操作更新"
              : "订单和套餐必须通过专用操作更新",
          );
        const scope =
          model === "AccountNotice"
            ? { tenantId, userId: user.id }
            : model === "SubscriptionOrder"
              ? { tenantId }
              : model === "SubscriptionPlan"
                ? { active: true }
                : direct.has(model)
                  ? {
                      tenantId,
                      ...(model === "User" ? { role: { not: "ADMIN" } } : {}),
                    }
                  : siteOwned.has(model)
                    ? { site: { tenantId } }
                    : model === "Message"
                      ? { conversation: { site: { tenantId } } }
                      : model === "AiKnowledgeChunk"
                        ? { knowledge: { tenantId } }
                        : model === "SiteAgent"
                          ? { user: { tenantId }, site: { tenantId } }
                          : model === "Tenant"
                            ? { id: tenantId }
                            : null;
        if (!scope) throw new HttpError(403, "此配置仅限平台管理员访问");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma supplies a model-dependent argument union.
        const input = args as Record<string, any>; // Prisma delegates have different argument types.
        if (
          model === "Tenant" &&
          ![
            "findUnique",
            "findUniqueOrThrow",
            "findFirst",
            "findFirstOrThrow",
            "findMany",
            "count",
            "aggregate",
            "groupBy",
          ].includes(operation) &&
          (!["update", "updateMany"].includes(operation) ||
            Object.keys(input.data ?? {}).some((key) => key !== "updatedAt"))
        )
          throw new HttpError(
            403,
            "商家额度、功能和有效期必须通过平台专用操作更新",
          );
        if (!operation.startsWith("create")) {
          input.where = {
            ...input.where,
            AND: [input.where?.AND ?? {}, scope],
          };
        }
        if (
          [
            "create",
            "createMany",
            "createManyAndReturn",
            "update",
            "updateMany",
            "updateManyAndReturn",
            "upsert",
          ].includes(operation)
        ) {
          const values =
            operation === "upsert"
              ? [input.create, input.update]
              : Array.isArray(input.data)
                ? input.data
                : [input.data];
          for (const value of values) {
            if (!value) continue;
            if (
              "tenant" in value ||
              (value.tenantId && value.tenantId !== tenantId)
            )
              throw new HttpError(403, "不能更改数据所属商家");
            if (
              direct.has(model) &&
              (operation.startsWith("create") ||
                (operation === "upsert" && value === input.create))
            )
              value.tenantId = tenantId;
            if (model === "User" && value.role === "ADMIN")
              throw new HttpError(403, "不能授予平台管理员权限");
            if (
              value.siteId &&
              !(await prisma.site.findFirst({
                where: { id: value.siteId, tenantId },
                select: { id: true },
              }))
            )
              throw new HttpError(403, "无权访问该站点");
            if (
              value.ownerId &&
              !(await prisma.user.findFirst({
                where: { id: value.ownerId, tenantId },
                select: { id: true },
              }))
            )
              throw new HttpError(403, "无权访问该账号");
            if (
              model === "SiteAgent" &&
              value.userId &&
              !(await prisma.user.findFirst({
                where: { id: value.userId, tenantId, role: { not: "ADMIN" } },
                select: { id: true },
              }))
            )
              throw new HttpError(403, "无权访问该账号");
          }
        }
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
}

export async function adminDb(): Promise<PrismaClient> {
  return tenantDb(await requireAdmin());
}
