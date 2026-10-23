import { cookies, headers } from "next/headers";

import {
  LOCALE_COOKIE,
  defaultLocale,
  isLocale,
  resolveLocaleFromHeader,
  type Locale,
} from "./config";
import { createTranslator, type TranslateFn } from "./translate";

/**
 * 服务端取语言：优先用户显式选择的 cookie，其次跟随 Accept-Language。
 * 客服/管理后台登录后会把用户偏好写进 cookie。
 */
export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerStore = await headers();
  return resolveLocaleFromHeader(headerStore.get("accept-language")) ?? defaultLocale;
}

export async function getServerT(): Promise<{
  locale: Locale;
  t: TranslateFn;
}> {
  const locale = await getServerLocale();
  return { locale, t: createTranslator(locale) };
}
