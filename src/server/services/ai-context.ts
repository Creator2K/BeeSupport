import type { Prisma } from "@prisma/client";
import { readFeatures } from "../../lib/entitlements";
import { tenantCanServe } from "./tenants";
import type { AiJobLease } from "./ai-job-queue";

export type AiContextIdentity = {
  conversationId: string;
  siteId?: string;
  visitorId?: string;
  expectedMessageId?: string;
  leaseToken?: string;
  jobId?: string;
  jobRevision?: number;
};

/** Recheck access and generation identity; callers must lock the conversation before writes. */
export async function readAiContext(
  db: Pick<Prisma.TransactionClient, "conversation" | "aiJob">,
  input: AiContextIdentity,
  allowClosed = false,
) {
  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      siteId: true,
      visitorId: true,
      status: true,
      tags: true,
      aiReplyToken: true,
      aiReplyExpiresAt: true,
      site: {
        select: {
          name: true,
          active: true,
          tenant: { select: { status: true, expiresAt: true, features: true } },
        },
      },
      visitor: { select: { blocked: true } },
      messages: {
        where: { sender: { not: "SYSTEM" }, type: { notIn: ["SYSTEM", "NOTE"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, sender: true, type: true, body: true },
      },
    },
  });
  if (
    !conversation ||
    (input.siteId !== undefined && conversation.siteId !== input.siteId) ||
    (input.visitorId !== undefined &&
      conversation.visitorId !== input.visitorId) ||
    (!allowClosed && conversation.status === "CLOSED") ||
    !conversation.site.active ||
    !tenantCanServe(conversation.site.tenant) ||
    !readFeatures(conversation.site.tenant.features).ai ||
    conversation.visitor.blocked
  )
    return null;

  if (
    input.leaseToken &&
    !input.jobId &&
    (conversation.aiReplyToken !== input.leaseToken ||
      !conversation.aiReplyExpiresAt ||
      conversation.aiReplyExpiresAt <= new Date())
  )
    return null;

  if (input.jobId) {
    const lease = input as AiJobLease;
    const job = await db.aiJob.findFirst({
      where: {
        id: lease.jobId,
        revision: lease.jobRevision,
        leaseToken: lease.leaseToken,
        status: "PROCESSING",
        lockedUntil: { gt: new Date() },
        kind: "AUTO_REPLY",
        conversationId: input.conversationId,
        messageId: input.expectedMessageId,
      },
      select: { id: true },
    });
    if (!input.leaseToken || input.jobRevision === undefined || !input.expectedMessageId || !job)
      return null;
  }

  const latest = conversation.messages[0];
  if (
    input.expectedMessageId &&
    (latest?.id !== input.expectedMessageId || latest.sender !== "VISITOR")
  )
    return null;
  return conversation;
}
