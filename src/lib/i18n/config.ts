export const locales = ["zh-CN", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

export const LOCALE_COOKIE = "beesupport_locale";

export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * 访客端跟随浏览器语言：
 * 简单解析 Accept-Language，命中 zh* 就用中文，其余一律英文。
 */
export function resolveLocaleFromHeader(
  acceptLanguage: string | null | undefined,
): Locale {
  if (!acceptLanguage) return defaultLocale;

  const entries = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.split("=")[1]) : 1;
      return { tag: (tag ?? "").trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    if (entry.tag.startsWith("zh")) return "zh-CN";
    if (entry.tag.startsWith("en")) return "en";
  }
  return "en";
}
