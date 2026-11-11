"use client";

import { House, RotateCw } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { useBoundaryRetry } from "@/components/use-boundary-retry";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  const { retry, pending } = useBoundaryRetry(reset);

  return (
    <StatusScreen
      code="500"
      title={t("status.errorTitle")}
      description={t("status.errorBody")}
      footnote={
        error.digest ? t("status.errorId", { id: error.digest }) : undefined
      }
      actions={
        <>
          <Button size="lg" onClick={retry} disabled={pending}>
            <RotateCw
              aria-hidden="true"
              className={pending ? "animate-spin" : undefined}
            />
            {t("common.retry")}
          </Button>
          {/* 整页跳转：出错的可能就是首页，同地址的客户端导航不会重置错误边界 */}
          <Button
            size="lg"
            variant="outline"
            onClick={() => window.location.assign("/")}
          >
            <House aria-hidden="true" />
            {t("auth.backHome")}
          </Button>
        </>
      }
    />
  );
}
