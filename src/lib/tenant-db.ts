import type { PrismaClient } from "@prisma/client";
import { HttpError, requireAdmin, type SessionUser } from "./auth";
import { prisma } from "./db";

type TenantValue = Record<string, unknown>;

const MUTATION_RELATION_FIELDS: Record<string, readonly string[]> = {
  Conversation: ["site", "visitor", "assignedAgent", "messages"],
  Message: ["conversation", "author", "attachments"],
  Attachment: ["site", "message"],
  AiKnowledgeChunk: ["knowledge"],
  RiskEvent: ["site"],
};

async function siteBelongs(tenantId: string, siteId: string) {
  return prisma.site.findFirst({
    where: { id: siteId, tenantId },
    select: { id: true },
  });
}

async function userBelongs(tenantId: string, userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, tenantId, role: { not: "ADMIN" } },
    select: { id: true },
  });
}

async function visitorBelongs(
  tenantId: string,
  visitorId: string,
  siteId?: string | null,
) {
  return prisma.visitor.findFirst({
    where: {
      id: visitorId,
      site: { tenantId },
      ...(siteId ? { siteId } : {}),
    },
    select: { siteId: true },
  });
}

async function conversationBelongs(
  tenantId: string,
  conversationId: string,
  siteId?: string | null,
) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      site: { tenantId },
      ...(siteId ? { siteId } : {}),
    },
    select: { siteId: true },
  });
}

async function messageBelongs(
  tenantId: string,
  messageId: string,
  siteId?: string | null,
) {
  return prisma.message.findFirst({
    where: {
      id: messageId,
      conversation: {
        site: { tenantId },
        ...(siteId ? { siteId } : {}),
      },
    },
    select: { conversation: { select: { siteId: true } } },
  });
}

async function attachmentBelongs(
  tenantId: string,
  attachmentId: string,
  siteId?: string | null,
) {
  return prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      site: { tenantId },
      ...(siteId ? { siteId } : {}),
    },
    select: { siteId: true },
  });
}

async function knowledgeBelongs(tenantId: string, knowledgeId: string) {
  return prisma.aiKnowledge.findFirst({
    where: { id: knowledgeId, tenantId },
    select: { id: true },
  });
}

async function riskRuleBelongs(tenantId: string, ruleId: string) {
  return prisma.riskRule.findFirst({
    where: { id: ruleId, tenantId },
    select: { id: true },
  });
}

async function assertMutationRelations(
  model: string,
  value: TenantValue,
  tenantId: string,
): Promise<void> {
  const relationFields = MUTATION_RELATION_FIELDS[model];
  if (relationFields?.some((field) => field in value))
    throw new HttpError(403, "关联字段必须通过外键 ID 写入");

  const readId = (field: string) => {
    const candidate = value[field];
    return typeof candidate === "string" && candidate.length > 0
      ? candidate
      : null;
  };
  const siteId = readId("siteId");
  const visitorId = readId("visitorId");
  const assignedAgentId = readId("assignedAgentId");
  const closedById = readId("closedById");
  const waitingMessageId = readId("waitingMessageId");
  const conversationId = readId("conversationId");
  const authorId = readId("authorId");
  const messageId = readId("messageId");
  const uploaderId = readId("uploaderId");
  const pendingImageId = readId("pendingImageId");
  const knowledgeId = readId("knowledgeId");
  const ruleId = readId("ruleId");

  if (model === "Conversation") {
    if (visitorId && !(await visitorBelongs(tenantId, visitorId, siteId)))
      throw new HttpError(403, "无权访问该访客");
    if (assignedAgentId && !(await userBelongs(tenantId, assignedAgentId)))
      throw new HttpError(403, "无权访问该账号");
    if (closedById && !(await userBelongs(tenantId, closedById)))
      throw new HttpError(403, "无权访问该账号");
    if (
      waitingMessageId &&
      !(await messageBelongs(tenantId, waitingMessageId, siteId))
    )
      throw new HttpError(403, "无权访问该消息");
  }

  if (model === "Message") {
    if (conversationId && !(await conversationBelongs(tenantId, conversationId)))
      throw new HttpError(403, "无权访问该会话");
    if (authorId && !(await userBelongs(tenantId, authorId)))
      throw new HttpError(403, "无权访问该账号");
  }

  if (model === "Attachment") {
    if (messageId && !(await messageBelongs(tenantId, messageId, siteId)))
      throw new HttpError(403, "无权访问该消息");
    if (
      value.uploader === "VISITOR" &&
      uploaderId &&
      !(await visitorBelongs(tenantId, uploaderId, siteId))
    )
      throw new HttpError(403, "无权访问该访客");
    if (
      value.uploader === "AGENT" &&
      uploaderId &&
      !(await userBelongs(tenantId, uploaderId))
    )
      throw new HttpError(403, "无权访问该账号");
  }

  if (
    model === "Visitor" &&
    pendingImageId &&
    !(await attachmentBelongs(tenantId, pendingImageId))
  )
    throw new HttpError(403, "无权访问该附件");

  if (
    model === "AiKnowledgeChunk" &&
    knowledgeId &&
    !(await knowledgeBelongs(tenantId, knowledgeId))
  )
    throw new HttpError(403, "无权访问该知识库");

  if (model === "RiskEvent") {
    if (visitorId && !(await visitorBelongs(tenantId, visitorId, siteId)))
      throw new HttpError(403, "无权访问该访客");
    if (ruleId && !(await riskRuleBelongs(tenantId, ruleId)))
      throw new HttpError(403, "无权访问该风控规则");
  }
}

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
            if (value.siteId && !(await siteBelongs(tenantId, value.siteId)))
              throw new HttpError(403, "无权访问该站点");
            if (value.ownerId && !(await userBelongs(tenantId, value.ownerId)))
              throw new HttpError(403, "无权访问该账号");
            if (
              model === "SiteAgent" &&
              value.userId &&
              !(await userBelongs(tenantId, value.userId))
            )
              throw new HttpError(403, "无权访问该账号");
            await assertMutationRelations(model, value, tenantId);
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
