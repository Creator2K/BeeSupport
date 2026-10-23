"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

type LocaleContextValue = {
  locale: Locale;
  t: TranslateFn;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale: initialLocale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      // 写 cookie 后刷新，让服务端组件也用新语言重新渲染
      document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
      router.refresh();
    },
    [router],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: createTranslator(locale), setLocale }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale 必须在 LocaleProvider 内使用");
  }
  return context;
}

/** 只关心翻译函数时的便捷 hook */
export function useT(): TranslateFn {
  return useLocale().t;
}
