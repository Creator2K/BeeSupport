"use client";

import { LayoutDashboard, RotateCw, TriangleAlert } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { SectionStatus } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { useBoundaryRetry } from "@/components/use-boundary-retry";

// 后台入口可以配置成任意路径，客户端拿不到服务端的配置，
// 所以按浏览器地址栏的第一段回到概览。
function goToOverview() {
  const [, base = ""] = window.location.pathname.split("/");
  window.location.assign(`/${base}`);
}

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  const { retry, pending } = useBoundaryRetry(reset);

  return (
    <SectionStatus
      icon={<TriangleAlert />}
      title={t("status.sectionErrorTitle")}
      description={t("status.sectionErrorBody")}
      footnote={
        error.digest ? t("status.errorId", { id: error.digest }) : undefined
      }
      actions={
        <>
          <Button onClick={retry} disabled={pending}>
            <RotateCw
              aria-hidden="true"
              className={pending ? "animate-spin" : undefined}
            />
            {t("common.retry")}
          </Button>
          <Button variant="outline" onClick={goToOverview}>
            <LayoutDashboard aria-hidden="true" />
            {t("status.backToOverview")}
          </Button>
        </>
      }
    />
  );
}
