import path from "node:path";

import type { WeChatBot } from "@wechatbot/wechatbot";

import { env } from "../../lib/env";

export type WechatBotConfig = {
  /** 打开后进程启动即自动登录，并在掉线时保留登录态 */
  enabled: boolean;
  /** 默认接收人（wxid 或备注名），通知渠道没填目标时用它 */
  defaultTo: string;
};

export type WechatBotStatus =
  | "stopped"
  | "starting"
  | "qr"
  | "scanned"
  | "code"
  | "online"
  | "error";

export type WechatBotState = {
  status: WechatBotStatus;
  qrUrl: string | null;
  scanned: boolean;
  account: { userId: string; accountId: string } | null;
  error: string | null;
  hasCredentials: boolean;
  running: boolean;
  storageDir: string;
  logs: { at: string; level: "info" | "error"; message: string }[];
};

type PendingCode = {
  resolve: (code: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Runtime = {
  bot: WeChatBot | null;
  status: WechatBotStatus;
  qrUrl: string | null;
  account: { userId: string; accountId: string } | null;
  error: string | null;
  logs: { at: string; level: "info" | "error"; message: string }[];
  pendingCode: PendingCode | null;
  starting: Promise<void> | null;
};

const MAX_LOGS = 40;
export const CODE_TIMEOUT_MS = 5 * 60 * 1000;

const globalForWechat = globalThis as unknown as {
  __beesupportWechat?: Runtime;
};

export function runtime(): Runtime {
  globalForWechat.__beesupportWechat ??= {
    bot: null,
    status: "stopped",
    qrUrl: null,
    account: null,
    error: null,
    logs: [],
    pendingCode: null,
    starting: null,
  };
  return globalForWechat.__beesupportWechat;
}

export function wechatStorageDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.WECHATBOT_STORAGE_DIR?.trim() ||
      path.join(env.UPLOAD_DIR, "wechatbot"),
  );
}

export function log(level: "info" | "error", message: string): void {
  const state = runtime();
  state.logs = [
    { at: new Date().toISOString(), level, message: message.slice(0, 300) },
    ...state.logs,
  ].slice(0, MAX_LOGS);
  if (level === "error") console.error(`[wechatbot] ${message}`);
  else console.log(`[wechatbot] ${message}`);
}

/* ---------------- 配置 ---------------- */

export function getWechatState(): WechatBotState {
  const state = runtime();
  return {
    status: state.status,
    qrUrl: state.qrUrl,
    scanned: state.status === "scanned" || state.status === "code",
    account: state.account,
    error: state.error,
    hasCredentials: Boolean(state.bot?.getCredentials() ?? state.account),
    running: Boolean(state.bot?.isRunning),
    storageDir: wechatStorageDir(),
    logs: state.logs,
  };
}

export function isWechatOnline(): boolean {
  const state = runtime();
  return state.status === "online" && Boolean(state.bot);
}

/* ---------------- 扫码登录 ---------------- */
