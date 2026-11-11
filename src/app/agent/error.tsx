"use client";

import { Headset, RotateCw, TriangleAlert } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { SectionStatus } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { useBoundaryRetry } from "@/components/use-boundary-retry";

export default function AgentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  const { retry, pending } = useBoundaryRetry(reset);

  return (
    <div className="bg-background grid h-full place-items-center overflow-y-auto">
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
            {/* 整页跳转：出错的可能就是工作台本身，同地址的客户端导航不会重置错误边界 */}
            <Button
              variant="outline"
              onClick={() => window.location.assign("/agent")}
            >
              <Headset aria-hidden="true" />
              {t("status.backToWorkbench")}
            </Button>
          </>
        }
      />
    </div>
  );
}
