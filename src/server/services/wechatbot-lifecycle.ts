import { WeChatBot, type Credentials } from "@wechatbot/wechatbot";

import { HttpError } from "../../lib/auth";
import { logger } from "../../lib/logger";
import { getWechatConfig } from "./wechatbot-config";
import {
  CODE_TIMEOUT_MS,
  getWechatState,
  log,
  runtime,
  wechatStorageDir,
  type WechatBotState,
} from "./wechatbot-runtime";

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
    logger.error("wechat.stop_failed", {}, error);
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
    logger.error("wechat.credentials_clear_failed", {}, error);
  }

  state.bot = null;
  state.account = null;
  state.qrUrl = null;
  state.status = "stopped";
  log("info", "已退出登录，本地凭证已清除");
  return getWechatState();
}

/* ---------------- 发送 ---------------- */

export async function ensureWechatBot(): Promise<void> {
  try {
    const config = await getWechatConfig();
    if (!config.enabled) return;
    await startWechatBot();
  } catch (error) {
    logger.error("wechat.autostart_failed", {}, error);
  }
}
