import path from "node:path";

import { WeChatBot, type Credentials } from "@wechatbot/wechatbot";

import { HttpError } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { env } from "../../lib/env";

/**
 * 微信个人号通知（扫码登录）。
 *
 * 用 @wechatbot/wechatbot 在进程内跑一个机器人：后台出二维码 → 管理员扫码 →
 * 凭证落盘（${UPLOAD_DIR}/wechatbot），之后通知渠道就能直接给指定微信发消息。
 * 想用独立进程/独立机器跑桥接服务也可以，WebhookType.WECHAT 仍然保留。
 */
export const WECHATBOT_SETTING_KEY = "wechatbot";

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
const CODE_TIMEOUT_MS = 5 * 60 * 1000;

const globalForWechat = globalThis as unknown as {
  __beesupportWechat?: Runtime;
};

function runtime(): Runtime {
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

function log(level: "info" | "error", message: string): void {
  const state = runtime();
  state.logs = [
    { at: new Date().toISOString(), level, message: message.slice(0, 300) },
    ...state.logs,
  ].slice(0, MAX_LOGS);
  if (level === "error") console.error(`[wechatbot] ${message}`);
  else console.log(`[wechatbot] ${message}`);
}

/* ---------------- 配置 ---------------- */

export function defaultWechatConfig(): WechatBotConfig {
  return {
    enabled: process.env.WECHATBOT_ENABLED === "true",
    defaultTo: process.env.WECHATBOT_DEFAULT_TO?.trim() ?? "",
  };
}

export async function getWechatConfig(): Promise<WechatBotConfig> {
  const defaults = defaultWechatConfig();
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: WECHATBOT_SETTING_KEY },
    });
    if (!setting?.value) return defaults;
    const stored = setting.value as Partial<WechatBotConfig>;
    return {
      enabled:
        typeof stored.enabled === "boolean" ? stored.enabled : defaults.enabled,
      defaultTo:
        typeof stored.defaultTo === "string" ? stored.defaultTo : defaults.defaultTo,
    };
  } catch (error) {
    console.error("[wechatbot] 读取配置失败:", error);
    return defaults;
  }
}

export async function saveWechatConfig(
  patch: Partial<WechatBotConfig>,
): Promise<WechatBotConfig> {
  const current = await getWechatConfig();
  const next: WechatBotConfig = {
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
    defaultTo:
      patch.defaultTo === undefined ? current.defaultTo : patch.defaultTo.trim().slice(0, 120),
  };

  await prisma.setting.upsert({
    where: { key: WECHATBOT_SETTING_KEY },
    create: { key: WECHATBOT_SETTING_KEY, value: next },
    update: { value: next },
  });

  return next;
}

/* ---------------- 状态 ---------------- */

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

function waitForVerifyCode(isRetry: boolean): Promise<string> {
  const state = runtime();
  state.status = "code";
  log(
    "info",
    isRetry ? "配对码不正确，请重新输入" : "微信要求输入配对码，请查看手机屏幕上显示的数字",
  );

  return new Promise<string>((resolve, reject) => {
    if (state.pendingCode) {
      clearTimeout(state.pendingCode.timer);
      state.pendingCode.resolve("");
    }

    const timer = setTimeout(() => {
      state.pendingCode = null;
      reject(new HttpError(408, "配对码等待超时，请重新生成二维码"));
    }, CODE_TIMEOUT_MS);

    state.pendingCode = {
      timer,
      resolve: (code: string) => {
        clearTimeout(timer);
        state.pendingCode = null;
        resolve(code);
      },
    };
  });
}

/** 后台提交配对码 */
export function submitWechatCode(code: string): boolean {
  const state = runtime();
  if (!state.pendingCode) return false;
  state.pendingCode.resolve(code.trim());
  log("info", "已提交配对码，等待微信确认");
  return true;
}

/** 启动（或复用）机器人：没有凭证时走扫码流程 */
export async function startWechatBot(): Promise<WechatBotState> {
  const state = runtime();
  if (state.bot?.isRunning) return getWechatState();
  if (state.starting) {
    await state.starting.catch(() => undefined);
    return getWechatState();
  }

  state.error = null;
  state.status = "starting";
  state.qrUrl = null;

  const loginCallbacks = {
    onQrUrl: (url: string) => {
      state.qrUrl = url;
      state.status = "qr";
      state.error = null;
      log("info", "二维码已生成，请用微信扫码");
    },
    onScanned: () => {
      state.status = "scanned";
      log("info", "已扫码，请在手机上点击确认");
    },
    onExpired: () => {
      state.qrUrl = null;
      state.status = "qr";
      log("info", "二维码已过期，正在重新获取");
    },
    onVerifyCode: (isRetry: boolean) => waitForVerifyCode(isRetry),
  };

  const bot = new WeChatBot({
    storage: "file",
    storageDir: wechatStorageDir(),
    logLevel: "warn",
    botAgent: "BeeSupport/1.0",
    // 注意：SDK 只会用 login({ callbacks }) 传进来的回调，构造参数里的会被忽略，
    // 所以下面调用 login() 时再传一次。
    loginCallbacks,
  });

  const applyCredentials = (credentials: Credentials) => {
    state.account = {
      userId: credentials.userId,
      accountId: credentials.accountId,
    };
    state.status = "online";
    state.qrUrl = null;
    state.error = null;
  };

  bot.on("login", (credentials) => {
    applyCredentials(credentials);
    log("info", `登录成功：${credentials.userId || credentials.accountId}`);
  });
  bot.on("session:restored", (credentials) => {
    applyCredentials(credentials);
    log("info", "登录态已自动恢复");
  });
  bot.on("session:expired", () => {
    state.status = "qr";
    state.qrUrl = null;
    state.account = null;
    log("error", "登录态已失效，需要重新扫码");
  });
  bot.on("error", (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    state.error = message.slice(0, 300);
    if (state.status !== "online") state.status = "error";
    log("error", message);
  });

  state.bot = bot;

  state.starting = (async () => {
    try {
      const credentials = await bot.login({ callbacks: loginCallbacks });
      applyCredentials(credentials);

      const stored = bot.getCredentials();
      if (stored) applyCredentials(stored);

      // 长轮询，直到 stop() 才会返回
      await bot.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.error = message.slice(0, 300);
      if (state.status !== "online") state.status = "error";
      log("error", `启动失败：${message}`);
    } finally {
      state.starting = null;
      if (!bot.isRunning && state.status !== "error") {
        state.status = "stopped";
      }
    }
  })();

  return getWechatState();
}

export function stopWechatBot(note = "已停止"): WechatBotState {
  const state = runtime();
  try {
    state.bot?.stop();
  } catch (error) {
    console.error("[wechatbot] 停止失败:", error);
  }
  state.bot = null;
  state.status = "stopped";
  state.qrUrl = null;
  if (state.pendingCode) {
    clearTimeout(state.pendingCode.timer);
    state.pendingCode.resolve("");
    state.pendingCode = null;
  }
  log("info", note);
  return getWechatState();
}

/** 退出登录：清掉本地凭证，下次需要重新扫码 */
export async function logoutWechatBot(): Promise<WechatBotState> {
  const state = runtime();
  const bot = state.bot;

  try {
    bot?.stop();
    if (bot) await bot.storage.clear();
    else {
      const { FileStorage } = await import("@wechatbot/wechatbot");
      await new FileStorage(wechatStorageDir()).clear();
    }
  } catch (error) {
    console.error("[wechatbot] 清理凭证失败:", error);
  }

  state.bot = null;
  state.account = null;
  state.qrUrl = null;
  state.status = "stopped";
  log("info", "已退出登录，本地凭证已清除");
  return getWechatState();
}

/* ---------------- 发送 ---------------- */

export async function sendWechatText(
  to: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const state = runtime();
  const config = await getWechatConfig();
  const target = (to || config.defaultTo || "").trim();

  if (!target) return { ok: false, error: "未填写微信接收人" };
  if (!state.bot) return { ok: false, error: "微信机器人未启动，请先在后台扫码登录" };
  if (state.status !== "online") {
    return { ok: false, error: "微信未登录（需要扫码）" };
  }

  try {
    await state.bot.send(target, { text });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `发送给 ${target} 失败：${message}`);
    return { ok: false, error: message.slice(0, 200) };
  }
}

/** 配置里开了 enabled 就自动启动（服务启动时调用一次） */
export async function ensureWechatBot(): Promise<void> {
  try {
    const config = await getWechatConfig();
    if (!config.enabled) return;
    await startWechatBot();
  } catch (error) {
    console.error("[wechatbot] 自动启动失败:", error);
  }
}
