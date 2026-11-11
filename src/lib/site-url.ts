import { env } from "./env";

/** 对外访问的站点根地址；APP_URL 不是合法地址时返回 null，调用方跳过绝对链接。 */
export function siteUrl(): URL | null {
  try {
    return new URL(env.APP_URL);
  } catch {
    return null;
  }
}
