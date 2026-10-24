import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db";
import { unansweredDue } from "../../lib/unanswered";
import { ownerScope, serviceActive } from "./unanswered-scope";

/** Bounded, cursor-based scan. Conversation and rule locks serialize replies and rule disabling. */
export async function generateUnansweredReminders(
  now = new Date(),
  cursor?: string,
  tenantIds?: string[],
) {
  if (tenantIds && !tenantIds.length) return { created: 0, cursor: undefined };
  // Compare each site's delay and enable boundary in SQL so old/future rounds do not consume batches.
  const batch = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT c.id FROM "Conversation" c
    JOIN "Site" s ON s.id = c."siteId"
    JOIN "Tenant" t ON t.id = s."tenantId"
    JOIN "UnansweredRule" r ON r."siteId" = s.id
    WHERE c.status IN ('PENDING', 'OPEN') AND c."waitingMessageId" IS NOT NULL
      AND r.enabled = true AND r."enabledAt" IS NOT NULL
      AND c."waitingSince" >= r."enabledAt"
      AND c."waitingSince" <= ${now} - r."delayMinutes" * INTERVAL '1 minute'
      AND s.active = true AND t.status = 'ACTIVE' AND (t."expiresAt" IS NULL OR t."expiresAt" > ${now})
      AND NOT EXISTS (SELECT 1 FROM "UnansweredReminder" n WHERE n."conversationId" = c.id AND n."resolvedAt" IS NULL)
      ${cursor ? Prisma.sql`AND c.id > ${cursor}` : Prisma.empty}
      ${tenantIds ? Prisma.sql`AND s."tenantId" IN (${Prisma.join(tenantIds)})` : Prisma.empty}
    ORDER BY c.id ASC LIMIT 100
  `);
  let created = 0;
  for (const candidate of batch) {
    created += await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${candidate.id} FOR UPDATE`;
      const conversation = await tx.conversation.findFirst({
        where: {
          id: candidate.id,
          status: { in: ["PENDING", "OPEN"] },
          site: serviceActive(now),
        },
        select: {
          id: true,
          siteId: true,
          waitingSince: true,
          waitingMessageId: true,
          assignedAgentId: true,
          site: { select: { tenantId: true } },
        },
      });
      if (!conversation) return 0;
      await tx.$queryRaw`SELECT id FROM "UnansweredRule" WHERE "siteId" = ${conversation.siteId} FOR SHARE`;
      const rule = await tx.unansweredRule.findUnique({
        where: { siteId: conversation.siteId },
      });
      if (
        !rule ||
        !unansweredDue(
          conversation.waitingSince,
          conversation.waitingMessageId,
          rule,
          now,
        )
      )
        return 0;
      const recipientIds = [
        ...new Set([
          ...(rule.recipientMode === "ASSIGNED_OR_OWNER" &&
          conversation.assignedAgentId
            ? [conversation.assignedAgentId]
            : []),
          ...(rule.ownerId ? [rule.ownerId] : []),
        ]),
      ];
      if (!recipientIds.length) return 0;
      const owners = await tx.user.findMany({
        where: {
          AND: [
            ownerScope(conversation.site.tenantId, conversation.siteId),
            { id: { in: recipientIds } },
          ],
        },
        select: { id: true },
      });
      const recipientId = recipientIds.find((id) =>
        owners.some((owner) => owner.id === id),
      );
      if (!recipientId) return 0;
      const result = await tx.unansweredReminder.createMany({
        data: {
          tenantId: conversation.site.tenantId,
          conversationId: conversation.id,
          recipientId,
          ruleId: rule.id,
          ruleVersion: rule.version,
          waitingMessageId: conversation.waitingMessageId!,
          waitingSince: conversation.waitingSince!,
          remindedAt: now,
        },
        skipDuplicates: true,
      });
      if (!result.count) return 0;
      const reminder = await tx.unansweredReminder.findUniqueOrThrow({
        where: {
          conversationId_waitingMessageId: {
            conversationId: conversation.id,
            waitingMessageId: conversation.waitingMessageId!,
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: conversation.site.tenantId,
          actorName: "系统",
          action: "unanswered.remind",
          targetType: "UnansweredReminder",
          targetId: reminder.id,
          meta: {
            conversationId: conversation.id,
            recipientId,
            waitingSince: conversation.waitingSince!.toISOString(),
            ruleId: rule.id,
            ruleVersion: rule.version,
          },
        },
      });
      return 1;
    });
  }
  return {
    created,
    cursor: batch.length === 100 ? batch[batch.length - 1].id : undefined,
  };
}
