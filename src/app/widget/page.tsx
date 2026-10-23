import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LocaleProvider } from "@/components/locale-provider";
import { WidgetChat } from "@/components/widget/widget-chat";
import { resolveLocaleFromHeader } from "@/lib/i18n/config";
import { resolveSiteByKey } from "@/lib/widget";
import { createEmbedToken } from "@/lib/widget-origin";

export const metadata: Metadata = {
  title: "在线客服",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function WidgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const readString = (key: string): string => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };

  const headerStore = await headers();
  const locale = resolveLocaleFromHeader(headerStore.get("accept-language"));
  let embedToken = "";
  let embeddingHost = "";
  try {
    const site = await resolveSiteByKey(readString("key"));
    embedToken = await createEmbedToken(
      site,
      headerStore.get("referer"),
      readString("preview"),
    );
    const referer = headerStore.get("referer");
    if (referer) embeddingHost = new URL(referer).origin;
  } catch {
    notFound();
  }

  return (
    <LocaleProvider locale={locale}>
      <div className="bg-background h-dvh">
        <WidgetChat
          siteKey={readString("key")}
          embedToken={embedToken}
          pageUrl={readString("page")}
          pageTitle={readString("title")}
          referrer={readString("ref")}
          host={embeddingHost}
        />
      </div>
    </LocaleProvider>
  );
}
