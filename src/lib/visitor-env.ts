/**
 * 访客环境信息采集（浏览器端）。
 *
 * 采集来源有两处，合并后写入 Visitor.meta：
 * 1. 嵌入脚本（宿主页面，跨域下也能读到真实视口 / 页面标题）；
 * 2. 客服窗口 iframe（兜底，直接打开 /widget 调试时也有数据）。
 *
 * 这里只做纯函数，宿主页面的 widget.js 有一份等价实现（不能 import）。
 */

export type VisitorEnv = Record<string, string | number | boolean>;

export const VISITOR_ENV_KEYS = [
  "pageUrl",
  "pageTitle",
  "referrer",
  "host",
  "locale",
  "languages",
  "timezone",
  "tzOffset",
  "screen",
  "viewport",
  "dpr",
  "colorScheme",
  "platform",
  "device",
  "browser",
  "os",
  "ua",
  "mobile",
  "touchPoints",
  "cpu",
  "memory",
  "connection",
  "cookies",
  "dnt",
  "ip",
] as const;

export type VisitorEnvKey = (typeof VISITOR_ENV_KEYS)[number];

/** 老版本字段名 → 新字段名，兼容历史上报数据 */
const ENV_ALIASES: Record<string, VisitorEnvKey> = {
  userAgent: "ua",
  page: "pageUrl",
  title: "pageTitle",
  language: "locale",
  ref: "referrer",
};

/** 只保留白名单字段，避免访客端塞进来一堆无用数据 */
export function pickVisitorEnv(input: unknown): VisitorEnv {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const result: VisitorEnv = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = (ENV_ALIASES[rawKey] ?? rawKey) as VisitorEnvKey;
    if (!(VISITOR_ENV_KEYS as readonly string[]).includes(key)) continue;
    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      result[key] =
        typeof rawValue === "string" ? rawValue.slice(0, 500) : rawValue;
    }
  }

  return result;
}

export function mergeVisitorEnv(
  base: VisitorEnv | null | undefined,
  patch: VisitorEnv | null | undefined,
): VisitorEnv {
  return { ...(base ?? {}), ...(patch ?? {}) };
}

/* ---------------- 浏览器侧采集 ---------------- */

type NavigatorWithExtras = Navigator & {
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  userAgentData?: { platform?: string; mobile?: boolean };
};

function describeConnection(connection: NavigatorWithExtras["connection"]): string | null {
  if (!connection) return null;
  const parts: string[] = [];
  if (connection.effectiveType) parts.push(String(connection.effectiveType));
  if (typeof connection.downlink === "number") {
    parts.push(`${connection.downlink}Mbps`);
  }
  if (typeof connection.rtt === "number") parts.push(`${connection.rtt}ms`);
  if (connection.saveData) parts.push("省流量");
  return parts.length > 0 ? parts.join(" / ") : null;
}

/**
 * 采集当前窗口的环境信息。iframe 里调用时拿到的是客服窗口自己的视口，
 * 所以宿主页面还会通过 postMessage 送一份更真实的过来（见 visitorenv merge）。
 */
export function collectVisitorEnv(
  overrides: Record<string, string | number | boolean | undefined> = {},
): VisitorEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return pickVisitorEnv(overrides);
  }

  const nav = navigator as NavigatorWithExtras;
  const ua = nav.userAgent ?? "";
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  const mobile =
    nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const touchPoints = nav.maxTouchPoints ?? 0;

  const env: Record<string, string | number | boolean | undefined> = {
    screen:
      typeof window.screen !== "undefined"
        ? `${window.screen.width}x${window.screen.height}`
        : undefined,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    locale: nav.language,
    languages: (nav.languages ?? []).join(","),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffset: new Date().getTimezoneOffset(),
    colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
    platform,
    mobile,
    touchPoints,
    cpu: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    connection: describeConnection(nav.connection) ?? undefined,
    cookies: nav.cookieEnabled,
    dnt: nav.doNotTrack === "1",
    ua,
    browser: detectBrowser(ua) ?? undefined,
    os: detectOs(ua) ?? undefined,
    device:
      detectDevice({ ua, platform, mobile, touchPoints }) ?? undefined,
    ...overrides,
  };

  return pickVisitorEnv(env);
}

/* ---------------- UA 解析（面板展示用） ---------------- */

const BROWSERS: { test: RegExp; name: string; version: RegExp }[] = [
  { test: /Edg[A-Z]?\//, name: "Edge", version: /Edg[A-Z]?\/([\d.]+)/ },
  { test: /OPR\/|Opera/, name: "Opera", version: /(?:OPR|Opera)\/([\d.]+)/ },
  {
    test: /MicroMessenger/i,
    name: "微信内置浏览器",
    version: /MicroMessenger\/([\d.]+)/i,
  },
  { test: /QQBrowser/, name: "QQ 浏览器", version: /QQBrowser\/([\d.]+)/ },
  { test: /UCBrowser/, name: "UC 浏览器", version: /UCBrowser\/([\d.]+)/ },
  { test: /Firefox\//, name: "Firefox", version: /Firefox\/([\d.]+)/ },
  { test: /Chrome\//, name: "Chrome", version: /Chrome\/([\d.]+)/ },
  { test: /Safari\//, name: "Safari", version: /Version\/([\d.]+)/ },
  { test: /MSIE |Trident\//, name: "IE", version: /(?:MSIE |rv:)([\d.]+)/ },
];

export function detectBrowser(ua: string): string | null {
  if (!ua) return null;
  for (const { test, name, version } of BROWSERS) {
    if (!test.test(ua)) continue;
    const matched = ua.match(version);
    const major = matched?.[1]?.split(".")[0];
    return major ? `${name} ${major}` : name;
  }
  return null;
}

export function detectOs(ua: string): string | null {
  if (!ua) return null;
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS/iPadOS";
  if (/Android/.test(ua)) {
    const version = ua.match(/Android ([\d.]+)/);
    return version?.[1] ? `Android ${version[1]}` : "Android";
  }
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  if (/HarmonyOS/.test(ua)) return "HarmonyOS";
  return null;
}

/** 综合 platform / UA / 触摸能力给出设备类型描述 */
export function detectDevice(input: {
  ua?: string;
  platform?: string;
  mobile?: boolean;
  touchPoints?: number;
}): string | null {
  const ua = input.ua ?? "";
  if (!ua && !input.platform) return null;
  if (/iPad|Tablet/i.test(ua)) return "平板";
  if (input.mobile || /Mobile|Android|iPhone/i.test(ua)) return "手机";
  if ((input.touchPoints ?? 0) > 1) return "触屏设备";
  if (input.platform) return `${input.platform} 桌面端`;
  return "桌面端";
}

/** 面板里展示的浏览器/系统/设备，客户端与服务端都能算 */
export function describeVisitor(meta: Record<string, unknown> | null): {
  browser: string | null;
  os: string | null;
  device: string | null;
} {
  const ua = typeof meta?.ua === "string" ? meta.ua : "";
  return {
    browser:
      typeof meta?.browser === "string" && meta.browser
        ? meta.browser
        : detectBrowser(ua),
    os:
      typeof meta?.os === "string" && meta.os ? meta.os : detectOs(ua),
    device:
      typeof meta?.device === "string" && meta.device
        ? meta.device
        : detectDevice({
            ua,
            platform:
              typeof meta?.platform === "string" ? meta.platform : undefined,
            mobile: meta?.mobile === true,
            touchPoints:
              typeof meta?.touchPoints === "number" ? meta.touchPoints : 0,
          }),
  };
}
