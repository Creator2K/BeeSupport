import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db";
import { getSmtpConfig, sendMail } from "../../lib/mail";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import { ADMIN_PATH } from "../../lib/app-paths";
import type { PreparedAccountMail } from "./account-mail";
import {
  REMINDER_SETTING_KEY,
  readReminderSettings,
  reminderPhase,
  reminderText,
} from "../../lib/subscription-reminders";
export async function getReminderSettings() {
  return readReminderSettings(
    (await prisma.setting.findUnique({ where: { key: REMINDER_SETTING_KEY } }))
      ?.value,
  );
}
/** Each transaction rechecks the locked tenant; unique keys de-duplicate concurrent workers. */
export async function generateExpiryNotices(
  now = new Date(),
  cursor?: string,
  tenantIds?: string[],
) {
  const { settings } = await getReminderSettings();
  if (!settings.enabled) return { created: 0, cursor: undefined };
  const smtpReady = settings.mailEnabled && Boolean(await getSmtpConfig());
  const batch = await prisma.tenant.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: {
        gte: new Date(now.getTime() - 7 * 86400000),
        lte: new Date(now.getTime() + settings.leadDays * 86400000),
      },
      ...(tenantIds ? { id: { in: tenantIds } } : {}),
      ...(cursor ? { AND: { id: { gt: cursor } } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 200,
  });
  let created = 0;
  for (const row of batch) {
    created += await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${row.id} FOR UPDATE`;
      const tenant = await tx.tenant.findUnique({ where: { id: row.id } });
      if (!tenant || tenant.status !== "ACTIVE" || !tenant.expiresAt) return 0;
      const phase = reminderPhase(tenant.expiresAt, now, settings.leadDays);
      if (phase === null) return 0;
      const users = await tx.user.findMany({
        where: { tenantId: tenant.id, role: "MERCHANT_ADMIN", active: true },
        select: { id: true },
      });
      let added = 0;
      for (const user of users) {
        const dedupeKey = `expiry:${tenant.expiresAt.toISOString()}:${phase}`;
        const id = randomUUID();
        const text = reminderText(
          { ...tenant, expiresAt: tenant.expiresAt },
          phase,
        );
        const result = await tx.accountNotice.createMany({
          data: [
            {
              id,
              tenantId: tenant.id,
              userId: user.id,
              kind: "subscription.expiry",
              dedupeKey,
              ...text,
              expirySnapshot: tenant.expiresAt,
              createdAt: now,
            },
          ],
          skipDuplicates: true,
        });
        added += result.count;
        if (smtpReady) {
          const notice = await tx.accountNotice.findUniqueOrThrow({
            where: { userId_dedupeKey: { userId: user.id, dedupeKey } },
          });
          const jobId = `expiry-mail-${notice.id}`;
          const claimed = await tx.accountNotice.updateMany({
            where: { id: notice.id, mailJobId: null },
            data: { mailJobId: jobId },
          });
          if (claimed.count)
            await tx.notificationJob.create({
              data: {
                id: jobId,
                kind: "SUBSCRIPTION_MAIL",
                payload: { noticeId: notice.id, phase },
                availableAt: now,
              },
            });
        }
      }
      return added;
    });
  }
  return {
    created,
    cursor: batch.length === 200 ? batch[batch.length - 1].id : undefined,
  };
}
/** Old queued reminders must never email a merchant after renewal, suspension or disabling mail. */
export async function prepareExpiryMail(
  payload: unknown,
): Promise<PreparedAccountMail> {
  const { settings } = await getReminderSettings();
  if (!settings.enabled || !settings.mailEnabled)
    return { ok: false, skipped: true };
  const input = payload as { noticeId?: string; phase?: number };
  if (
    !input ||
    typeof input.noticeId !== "string" ||
    !Number.isInteger(input.phase)
  )
    return {
      ok: false,
      retryable: false,
      error: "Invalid subscription reminder payload",
    };
  const notice = await prisma.accountNotice.findUnique({
    where: { id: input.noticeId },
    include: { tenant: true, user: true },
  });
  if (
    !notice ||
    notice.kind !== "subscription.expiry" ||
    !notice.user.active ||
    notice.user.role !== "MERCHANT_ADMIN" ||
    notice.user.tenantId !== notice.tenantId ||
    notice.tenant.status !== "ACTIVE" ||
    !notice.tenant.expiresAt ||
    notice.tenant.expiresAt.getTime() !== notice.expirySnapshot?.getTime() ||
    reminderPhase(notice.tenant.expiresAt, new Date(), settings.leadDays) !==
      input.phase
  )
    return { ok: false, skipped: true };
  if (!(await getSmtpConfig()))
    return { ok: false, error: "SMTP 尚未配置，暂不能发送到期提醒" };
  return {
    ok: true,
    mail: {
      to: notice.user.email,
      subject: `${notice.title} · BeeSupport`,
      text: `${notice.body}\n\n${env.APP_URL.replace(/\/$/, "")}${ADMIN_PATH}/subscription`,
      messageId: `<expiry-${notice.id}@beesupport>`,
    },
  };
}
export async function deliverExpiryMail(payload: unknown) {
  const prepared = await prepareExpiryMail(payload);
  if (!prepared.ok) return prepared;
  const result = await sendMail(prepared.mail);
  return result.skipped
    ? { ok: false, error: "SMTP 尚未配置，暂不能发送到期提醒" }
    : result;
}
export function startSubscriptionReminderWorker() {
  let running: Promise<void> | null = null,
    stopping = false,
    cursor: string | undefined;
  const tick = () => {
    if (stopping || running) return;
    running = generateExpiryNotices(new Date(), cursor)
      .then((result) => {
        cursor = result.cursor;
      })
      .catch((error) =>
        logger.error("subscription_reminders.check_failed", {}, error),
      )
      .finally(() => {
        running = null;
      });
  };
  tick();
  const timer = setInterval(tick, 60000);
  timer.unref();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await running;
  };
}
