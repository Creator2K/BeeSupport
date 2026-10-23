import type { MessageKey } from "@/lib/i18n/dictionaries";

export type WebhookRecord = {
  id: string;
  name: string;
  type:
    | "GENERIC"
    | "TELEGRAM"
    | "DINGTALK"
    | "WECHAT_WORK"
    | "WECHAT"
    | "WECHAT_BOT";
  url: string;
  secret: string | null;
  events: string[];
  siteId: string | null;
  siteName: string | null;
  active: boolean;
  lastStatus: string | null;
  lastTriggeredAt: string | null;
};

export type SiteOption = { id: string; name: string };

export const EVENT_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  {
    value: "conversation.created",
    labelKey: "webhooks.eventConversationCreated",
  },
  {
    value: "conversation.offline",
    labelKey: "webhooks.eventConversationOffline",
  },
  {
    value: "conversation.assigned",
    labelKey: "webhooks.eventConversationAssigned",
  },
  {
    value: "conversation.closed",
    labelKey: "webhooks.eventConversationClosed",
  },
  { value: "message.created", labelKey: "webhooks.eventMessageCreated" },
];

export const TYPE_LABELS: Record<WebhookRecord["type"], MessageKey> = {
  GENERIC: "webhooks.typeGeneric",
  TELEGRAM: "webhooks.typeTelegram",
  DINGTALK: "webhooks.typeDingtalk",
  WECHAT_WORK: "webhooks.typeWechatWork",
  WECHAT_BOT: "webhooks.typeWechatBot",
  WECHAT: "webhooks.typeWechatBridge",
};

/** New channels expose only the built-in WeChat bot option. */
export const TYPE_ORDER: WebhookRecord["type"][] = [
  "GENERIC",
  "TELEGRAM",
  "DINGTALK",
  "WECHAT_WORK",
  "WECHAT_BOT",
];

/** Legacy external bridges remain editable but are not offered for new rows. */
export const LEGACY_TYPES: WebhookRecord["type"][] = ["WECHAT"];

export const URL_HINTS: Record<WebhookRecord["type"], MessageKey> = {
  GENERIC: "webhooks.urlHintGeneric",
  TELEGRAM: "webhooks.urlHintTelegram",
  DINGTALK: "webhooks.urlHintDingtalk",
  WECHAT_WORK: "webhooks.urlHintWechat",
  WECHAT_BOT: "webhooks.urlHintWechatInternal",
  WECHAT: "webhooks.urlHintWechatBot",
};
