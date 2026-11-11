import type { Metadata } from "next";
import Link from "next/link";
import { House, LogIn } from "lucide-react";

import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return { title: t("status.notFoundTitle") };
}

export default async function NotFound() {
  const { t } = await getServerT();

  return (
    <StatusScreen
      code="404"
      title={t("status.notFoundTitle")}
      description={t("status.notFoundBody")}
      actions={
        <>
          <Button asChild size="lg">
            <Link href="/">
              <House aria-hidden="true" />
              {t("auth.backHome")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">
              <LogIn aria-hidden="true" />
              {t("status.toConsole")}
            </Link>
          </Button>
        </>
      }
    />
  );
}
