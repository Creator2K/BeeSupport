import { dictionaries, zhCN, type MessageKey } from "./dictionaries";
import { defaultLocale, type Locale } from "./config";

export type { MessageKey };

export type TranslateVars = Record<string, string | number>;

export type TranslateFn = (key: MessageKey, vars?: TranslateVars) => string;

/**
 * 纯函数版本的翻译器：服务端组件与客户端组件都能用。
 * 缺 key 时回退到中文，再回退到 key 本身，方便开发期发现漏翻译。
 */
export function createTranslator(locale: Locale): TranslateFn {
  const dictionary = dictionaries[locale] ?? dictionaries[defaultLocale];

  return (key, vars) => {
    const template = dictionary[key] ?? zhCN[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      vars[name] !== undefined ? String(vars[name]) : match,
    );
  };
}
