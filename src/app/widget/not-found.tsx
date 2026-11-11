import { Headset } from "lucide-react";

import { SectionStatus } from "@/components/status-screen";
import { getServerT } from "@/lib/i18n/server";

// 访客窗口嵌在客户网站的 iframe 里：只说明暂时打不开，不放跳到本站的链接。
export default async function WidgetNotFound() {
  const { t } = await getServerT();

  return (
    <div className="bg-background grid h-dvh place-items-center overflow-y-auto">
      <SectionStatus
        icon={<Headset />}
        title={t("status.widgetUnavailableTitle")}
        description={t("status.widgetUnavailableBody")}
      />
    </div>
  );
}
