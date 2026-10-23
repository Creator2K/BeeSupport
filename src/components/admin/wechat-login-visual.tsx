"use client";

import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  QrCode,
  Smartphone,
} from "lucide-react";

import { useT } from "@/components/locale-provider";

import type { WechatStateView } from "./wechat-login-types";

export function WechatLoginVisual({
  state,
  accountLabel,
}: {
  state: WechatStateView;
  accountLabel: string;
}) {
  const t = useT();

  return (
    <div className="bg-muted/40 flex size-[184px] shrink-0 items-center justify-center self-start rounded-lg border">
      {state.qrUrl && (state.status === "qr" || state.status === "scanned") ? (
        <div className="rounded-md bg-white p-2">
          <QRCodeSVG value={state.qrUrl} size={156} level="M" />
        </div>
      ) : state.status === "starting" ? (
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      ) : state.status === "online" ? (
        <div className="px-4 text-center">
          <CheckCircle2 className="mx-auto size-7 text-emerald-500" />
          <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
            {t("wechat.loggedInAs", { name: accountLabel })}
          </p>
        </div>
      ) : state.status === "code" ? (
        <div className="px-4 text-center">
          <Smartphone className="text-muted-foreground mx-auto size-7" />
          <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
            {t("wechat.codeHint")}
          </p>
        </div>
      ) : state.status === "error" ? (
        <div className="px-4 text-center">
          <AlertTriangle className="mx-auto size-7 text-red-500" />
          <p className="text-muted-foreground mt-2 text-[11px] break-all">
            {state.error ?? t("wechat.status.error")}
          </p>
        </div>
      ) : (
        <div className="px-4 text-center">
          <QrCode className="text-muted-foreground mx-auto size-7" />
          <p className="text-muted-foreground mt-2 text-[11px]">
            {t("wechat.noQr")}
          </p>
        </div>
      )}
    </div>
  );
}
