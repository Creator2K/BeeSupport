import { env } from "../../lib/env";
import {
  enqueueMail,
  enqueueWebhooks,
  type NotificationDb,
} from "./notification-outbox";
import { type WebhookEvent } from "../../lib/webhooks";
import type { SerializedConversation } from "../../lib/realtime/types";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export async function notifyConversationAssigned(
  input: {
    conversation: Pick<SerializedConversation, "id" | "siteId" | "siteName"> & {
      assignedAgent: { id: string } | null;
    };
    agentName: string;
  },
  db?: NotificationDb,
): Promise<void> {
  const conversation = input.conversation;
  await enqueueWebhooks(
    {
      event: "conversation.assigned",
      siteId: conversation.siteId,
      siteName: conversation.siteName,
      title: `【会话分配】${conversation.siteName}`,
      text: `会话已分配给 ${input.agentName}`,
      url: `${env.APP_URL.replace(/\/$/, "")}/agent?c=${conversation.id}`,
      data: {
        conversationId: conversation.id,
        agentId: conversation.assignedAgent?.id,
      },
    },
    db,
  );
}

/**
 * 新会话 / 离线留言的通知：Webhook 渠道 + 站点通知邮箱。
 * 这里只持久化任务，外部发送由后台 worker 执行。
 */
export async function notifyConversationCreated(
  input: {
    conversationId: string;
    siteId: string;
    siteName: string;
    notifyEmail: string | null;
    visitorEmail: string;
    visitorName: string | null;
    subject: string | null;
    preview: string;
    offline: boolean;
  },
  db?: NotificationDb,
): Promise<void> {
  const event: WebhookEvent = input.offline
    ? "conversation.offline"
    : "conversation.created";

  const title = input.offline
    ? `【离线留言】${input.siteName}`
    : `【新会话】${input.siteName}`;

  const lines = [
    `访客：${input.visitorName ? `${input.visitorName} <${input.visitorEmail}>` : input.visitorEmail}`,
    input.subject ? `主题：${input.subject}` : "",
    `内容：${input.preview || "(无文字内容)"}`,
  ].filter(Boolean);

  const url = `${env.APP_URL.replace(/\/$/, "")}/agent?c=${input.conversationId}`;

  await Promise.all([
    enqueueWebhooks(
      {
        event,
        siteId: input.siteId,
        siteName: input.siteName,
        title,
        text: lines.join("\n"),
        url,
        data: {
          conversationId: input.conversationId,
          visitorEmail: input.visitorEmail,
          visitorName: input.visitorName,
          offline: input.offline,
        },
      },
      db,
    ),
    input.notifyEmail
      ? enqueueMail(
          {
            to: input.notifyEmail,
            subject: title,
            text: `${lines.join("\n")}\n\n处理链接：${url}`,
            html: `<p>${lines.map(escapeHtml).join("<br />")}</p><p><a href="${escapeHtml(url)}">打开客服工作台处理</a></p>`,
            replyTo: input.visitorEmail || undefined,
          },
          db,
        )
      : Promise.resolve(),
  ]);
}

export async function notifyConversationClosed(
  input: {
    conversationId: string;
    siteId: string;
    siteName: string;
    visitorEmail: string;
    agentName: string;
  },
  db?: NotificationDb,
): Promise<void> {
  await enqueueWebhooks(
    {
      event: "conversation.closed",
      siteId: input.siteId,
      siteName: input.siteName,
      title: `【会话结束】${input.siteName}`,
      text: `客服 ${input.agentName} 结束了与 ${input.visitorEmail} 的会话`,
      url: `${env.APP_URL.replace(/\/$/, "")}/agent?c=${input.conversationId}`,
      data: { conversationId: input.conversationId },
    },
    db,
  );
}

/**
 * 访客新消息的 Webhook 推送（只走 Webhook，不发邮件，避免打扰）。
 * 只有显式订阅了 message.created 的渠道才会收到。
 */
export async function notifyVisitorMessage(
  input: {
    conversationId: string;
    siteId: string;
    siteName: string;
    visitorEmail: string;
    preview: string;
  },
  db?: NotificationDb,
): Promise<void> {
  await enqueueWebhooks(
    {
      event: "message.created",
      siteId: input.siteId,
      siteName: input.siteName,
      title: `【新消息】${input.siteName}`,
      text: `${input.visitorEmail}：${input.preview || "(无文字内容)"}`,
      url: `${env.APP_URL.replace(/\/$/, "")}/agent?c=${input.conversationId}`,
      data: {
        conversationId: input.conversationId,
        visitorEmail: input.visitorEmail,
      },
    },
    db,
  );
}
