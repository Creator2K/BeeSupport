import type { MessageKey } from "@/lib/i18n/dictionaries";

export type WechatStatus =
  | "stopped"
  | "starting"
  | "qr"
  | "scanned"
  | "code"
  | "online"
  | "error";

export type WechatLog = {
  at: string;
  level: "info" | "error";
  message: string;
};

export type WechatStateView = {
  status: WechatStatus;
  qrUrl: string | null;
  scanned: boolean;
  account: { userId: string; accountId: string } | null;
  error: string | null;
  hasCredentials: boolean;
  running: boolean;
  storageDir: string;
  logs: WechatLog[];
};

export type WechatConfigView = { enabled: boolean; defaultTo: string };

export const STATUS_KEY: Record<WechatStatus, MessageKey> = {
  stopped: "wechat.status.stopped",
  starting: "wechat.status.starting",
  qr: "wechat.status.qr",
  scanned: "wechat.status.scanned",
  code: "wechat.status.code",
  online: "wechat.status.online",
  error: "wechat.status.error",
};

export const STATUS_TONE: Record<WechatStatus, string> = {
  stopped: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  starting: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  qr: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  scanned: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  code: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  online: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-700 dark:text-red-400",
};
