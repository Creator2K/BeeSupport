import type { Metadata, Viewport } from "next";

import { LocaleProvider } from "@/components/locale-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getServerT } from "@/lib/i18n/server";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BeeSupport",
    template: "%s · BeeSupport",
  },
  description: "多站点统一客服系统",
};

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
