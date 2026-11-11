import { logger } from "./logger";

/**
 * 后台入口路径。
 *
 * 默认是 /admin，但强烈建议用 ADMIN_PATH 换成一个随机路径，
 * 例如 ADMIN_PATH="/console-7f3a9c21"：这样后台地址不可猜测，
 * 而真正的安全边界仍然是登录鉴权。
 *
 * 该模块只在服务端使用（server.ts / layout / route handler），
 * 客户端组件通过 props 接收路径，避免把 process.env 打进浏览器包。
 */
const RESERVED = new Set([
  "/api",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/accept-invite",
  "/agent",
  "/widget",
  "/preview",
  "/home-preview",
  "/widget.js",
  "/favicon.ico",
  "/_next",
]);

export function resolveAdminPath(raw?: string | null): string {
  const value = (raw ?? "").trim();
  if (!value || value === "/") return "/admin";

  const withSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withSlash.replace(/\/+$/, "");

  // 只允许单段、字母数字与 - _ . 开头
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(normalized)) {
    logger.warn("config.admin_path_invalid", { value, fallback: "/admin" });
    return "/admin";
  }

  if (
    normalized.toLowerCase() !== "/admin" &&
    RESERVED.has(normalized.toLowerCase())
  ) {
    logger.warn("config.admin_path_reserved", {
      value: normalized,
      fallback: "/admin",
    });
    return "/admin";
  }

  return normalized;
}

export const ADMIN_PATH = resolveAdminPath(process.env.ADMIN_PATH);

/** 拼接后台路径，例：adminUrl("/sites") → /console-xxx/sites */
export function adminUrl(subPath = ""): string {
  if (!subPath) return ADMIN_PATH;
  return `${ADMIN_PATH}${subPath.startsWith("/") ? subPath : `/${subPath}`}`;
}
