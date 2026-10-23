import { randomUUID } from "node:crypto";
import type { NotificationJob } from "@prisma/client";
import { prisma } from "../lib/db";
import { sendMail, type SendMailInput } from "../lib/mail";
import { sendWebhookDelivery, type WebhookPayload } from "../lib/webhooks";
import { deliverExpiryMail } from "./services/subscription-reminders";
import { deliverAccountMail } from "./services/account-mail";

const MAX_ATTEMPTS = 5;

/** SKIP LOCKED and a lease allow several app instances to share the same queue. */
export async function claimNotification(): Promise<NotificationJob | null> {
  const token = randomUUID();
  const jobs = await prisma.$queryRaw<NotificationJob[]>`
    UPDATE "NotificationJob" SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "totalAttempts" = GREATEST("totalAttempts", "attempts") + 1,
      "leaseToken" = ${token}, "lockedUntil" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '5 minutes', "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE id = (
      SELECT id FROM "NotificationJob" WHERE "attempts" < ${MAX_ATTEMPTS} AND (
        ("status" = 'PENDING' AND "availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) OR
        ("status" = 'PROCESSING' AND "lockedUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
      ) ORDER BY "availableAt", id LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *
  `;
  return jobs[0] ?? null;
}

export async function deliverNotification(job: NotificationJob): Promise<void> {
  const owner = {
    id: job.id,
    status: "PROCESSING",
    leaseToken: job.leaseToken,
  };
  try {
    let result: {
      ok: boolean;
      skipped?: boolean;
      error?: string;
      retryable?: boolean;
    };
    if (job.kind === "WEBHOOK") {
      const payload = job.payload as unknown as {
        endpointId: string;
        webhook: WebhookPayload;
      };
      result = await sendWebhookDelivery(
        payload.endpointId,
        payload.webhook,
        job.id,
      );
    } else if (job.kind === "SUBSCRIPTION_MAIL") {
      result = await deliverExpiryMail(job.payload);
    } else if (job.kind === "ACCOUNT_MAIL") {
      result = await deliverAccountMail(job.payload, job.id);
    } else if (job.kind === "MAIL") {
      const mailResult = await sendMail({
        ...(job.payload as unknown as SendMailInput),
        messageId: `<${job.id}@beesupport>`,
      });
      result = mailResult.skipped
        ? { ok: false, error: "SMTP 尚未配置，暂不能发送会话通知" }
        : mailResult;
    } else {
      throw Object.assign(new Error("Unknown notification kind"), {
        retryable: false,
      });
    }
    if (!result.ok && !result.skipped)
      throw Object.assign(new Error(result.error ?? "Delivery failed"), {
        retryable: result.retryable !== false,
      });
    await prisma.notificationJob.updateMany({
      where: owner,
      data: {
        status: "DELIVERED",
        outcome: result.skipped ? "SKIPPED" : "SUCCESS",
        completedAt: new Date(),
        lockedUntil: null,
        leaseToken: null,
        lastError: null,
        ...(job.kind === "ACCOUNT_MAIL" ? { payload: {} } : {}),
      },
    });
  } catch (error) {
    const exhausted =
      job.attempts >= MAX_ATTEMPTS ||
      (error as { retryable?: boolean })?.retryable === false;
    await prisma.notificationJob.updateMany({
      where: owner,
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        outcome: null,
        availableAt: new Date(
          Date.now() + Math.min(60_000, 5000 * 2 ** (job.attempts - 1)),
        ),
        lockedUntil: null,
        leaseToken: null,
        lastError: (error instanceof Error
          ? error.message
          : "Delivery failed"
        ).slice(0, 500),
      },
    });
  }
}

/** Starts after migrations. Shutdown stops claims and lets the current batch finish. */
export function startNotificationWorker(): () => Promise<void> {
  let stopping = false;
  let running: Promise<void> | null = null;
  let lastCleanup = 0;
  const tick = () => {
    if (stopping || running) return;
    running = (async () => {
      if (Date.now() - lastCleanup > 60_000) {
        await prisma.notificationJob.updateMany({
          where: {
            status: "PROCESSING",
            attempts: { gte: MAX_ATTEMPTS },
            lockedUntil: { lt: new Date() },
          },
          data: {
            status: "FAILED",
            leaseToken: null,
            lockedUntil: null,
            lastError: "Delivery lease expired after final attempt",
          },
        });
        await prisma.notificationJob.deleteMany({
          where: {
            OR: [
              {
                status: "DELIVERED",
                completedAt: { lt: new Date(Date.now() - 7 * 86400_000) },
              },
              {
                status: "FAILED",
                updatedAt: { lt: new Date(Date.now() - 30 * 86400_000) },
              },
            ],
          },
        });
        await prisma.accountToken.deleteMany({
          where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400_000) } },
        });
        lastCleanup = Date.now();
      }
      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, async () => {
          if (stopping) return;
          const job = await claimNotification();
          if (job) await deliverNotification(job);
        }),
      );
      const failure = outcomes.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })()
      .catch((error: unknown) =>
        console.error("[notifications] Worker failed:", error),
      )
      .finally(() => {
        running = null;
      });
  };
  tick();
  const timer = setInterval(tick, 2000);
  timer.unref();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await running;
  };
}
