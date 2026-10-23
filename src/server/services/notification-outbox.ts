import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import type { SendMailInput } from "../../lib/mail";
import type { WebhookPayload } from "../../lib/webhooks";

export type NotificationDb = Pick<
  Prisma.TransactionClient,
  "notificationJob" | "webhookEndpoint"
>;
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Pass the business transaction so a committed event always has its delivery jobs. */
export async function enqueueWebhooks(
  payload: WebhookPayload,
  db: NotificationDb = prisma,
): Promise<void> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: {
      tenant: { sites: { some: { id: payload.siteId } } },
      active: true,
      OR: [{ siteId: null }, { siteId: payload.siteId }],
    },
    select: { id: true, events: true },
  });
  const targets = endpoints.filter(
    (endpoint) =>
      !endpoint.events.length || endpoint.events.includes(payload.event),
  );
  if (targets.length)
    await db.notificationJob.createMany({
      data: targets.map((endpoint) => ({
        kind: "WEBHOOK",
        payload: json({ endpointId: endpoint.id, webhook: payload }),
      })),
    });
}

export async function enqueueMail(
  mail: SendMailInput,
  db: NotificationDb = prisma,
): Promise<void> {
  await db.notificationJob.create({
    data: { kind: "MAIL", payload: json(mail) },
  });
}
