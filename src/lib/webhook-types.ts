export type WebhookEvent =
  | "conversation.created"
  | "conversation.offline"
  | "conversation.assigned"
  | "conversation.closed"
  | "message.created";

export const WEBHOOK_EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: "conversation.created", label: "新会话开始" },
  { value: "conversation.offline", label: "离线留言" },
  { value: "conversation.assigned", label: "会话被接入/转接" },
  { value: "conversation.closed", label: "会话结束" },
  { value: "message.created", label: "有新消息" },
];

export type WebhookPayload = {
  event: WebhookEvent;
  siteId: string;
  siteName: string;
  title: string;
  text: string;
  url?: string;
  data?: Record<string, unknown>;
};

export type DeliveryResult = {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  skipped?: boolean;
};
