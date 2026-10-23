"use client";
import { useState } from "react";
import type { CollectionSettings } from "@/lib/collection";

function CollectionQr({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="text-sm text-muted-foreground">
      收款码加载失败，请通过下方联系方式联系平台。
    </p>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="平台收款码"
      referrerPolicy="no-referrer"
      className="h-auto max-h-72 w-64 max-w-full rounded-lg border bg-white object-contain p-2"
      onError={() => setFailed(true)}
    />
  );
}
export function CollectionInfo({ settings }: { settings: CollectionSettings }) {
  if (!settings.enabled)
    return (
      <p className="text-sm text-muted-foreground">
        付款安排请联系平台。提交订单后由平台核对收款并开通。
      </p>
    );
  return (
    <section
      className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-4 sm:p-5"
      aria-label="人工收款说明"
    >
      <h2 className="font-semibold break-words">{settings.title}</h2>
      {settings.instructions && (
        <p className="whitespace-pre-wrap break-words text-sm leading-7">
          {settings.instructions}
        </p>
      )}
      {settings.qrCodeUrl && (
        <CollectionQr key={settings.qrCodeUrl} url={settings.qrCodeUrl} />
      )}
      {settings.contact && (
        <p className="whitespace-pre-wrap break-words text-sm">
          联系平台：{settings.contact}
        </p>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        请先提交订单，再按订单金额付款，并备注订单号。反馈付款后，仍需平台核对实际到账并确认开通；报价过期后请先联系平台。
      </p>
    </section>
  );
}
