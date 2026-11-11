import type { Metadata, Viewport } from "next";

import { LocaleProvider } from "@/components/locale-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getServerT } from "@/lib/i18n/server";
import { siteUrl } from "@/lib/site-url";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getServerT();
  const name = t("app.name");
  const tagline = t("app.tagline");

  return {
    metadataBase: siteUrl(),
    title: { default: name, template: `%s · ${name}` },
    description: tagline,
    applicationName: name,
    // 标题和描述留空，Next 会用各页面自己的 title / description 补上；
    // 页面若单独声明 openGraph，会整块替换这里，连 opengraph-image 一起丢掉。
    openGraph: {
      type: "website",
      siteName: name,
      locale: locale === "zh-CN" ? "zh_CN" : "en_US",
    },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getServerT();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <LocaleProvider locale={locale}>
            {children}
            <Toaster position="top-center" richColors closeButton />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
