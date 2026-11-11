import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

import { SectionStatus } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { ADMIN_PATH } from "@/lib/app-paths";
import { getServerT } from "@/lib/i18n/server";

export default async function AdminNotFound() {
  const { t } = await getServerT();

  return (
    <SectionStatus
      code="404"
      title={t("status.sectionNotFoundTitle")}
      description={t("status.sectionNotFoundBody")}
      actions={
        <Button asChild variant="outline">
          <Link href={ADMIN_PATH}>
            <LayoutDashboard aria-hidden="true" />
            {t("status.backToOverview")}
          </Link>
        </Button>
      }
    />
  );
}
