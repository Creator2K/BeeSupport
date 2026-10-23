"use client";

import { useEffect, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SerializedAttachment } from "@/lib/realtime/types";

export function ImageAttachment({
  attachment,
  visitorToken,
}: {
  attachment: SerializedAttachment;
  visitorToken?: string | null;
}) {
  const t = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!open) return;
    const resize = () =>
      setViewport({
        width: Math.min(1000, window.innerWidth - 40),
        height: window.innerHeight * 0.7,
      });
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);
  useEffect(() => {
    if (!visitorToken || window.parent === window) return;
    let target: string;
    try {
      target = new URL(document.referrer).origin;
    } catch {
      return;
    }
    window.parent.postMessage({ type: "beesupport:lightbox", open }, target);
    return () => {
      if (open)
        window.parent.postMessage(
          { type: "beesupport:lightbox", open: false },
          target,
        );
    };
  }, [open, visitorToken]);
  useEffect(() => {
    if (!visitorToken) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreview(null);
    setFailed(false);
    void fetch(attachment.url, {
      headers: { authorization: `Bearer ${visitorToken}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Image unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.url, visitorToken, retry]);
  const imageUrl = visitorToken
    ? preview
    : `${attachment.url}${retry ? `?retry=${retry}` : ""}`;
  const fit =
    natural.width && natural.height && viewport.width
      ? Math.min(
          1,
          viewport.width / natural.width,
          viewport.height / natural.height,
        )
      : 1;
  const width = natural.width ? natural.width * fit * zoom : undefined;
  const height = natural.height ? natural.height * fit * zoom : undefined;
  return (
    <>
      <button
        type="button"
        aria-label={`${t("chat.viewImage")}: ${attachment.filename}`}
        className="block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-current/15 p-1"
        onClick={() => {
          setZoom(1);
          setOpen(true);
        }}
      >
        {imageUrl && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={attachment.filename}
            className="max-h-64 w-auto max-w-full object-contain"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="flex items-center gap-2 p-3 text-xs">
            {failed ? (
              t("chat.imageFailed")
            ) : (
              <Loader2 className="size-4 animate-spin" />
            )}
            {attachment.filename}
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-5xl">
          <DialogTitle className="truncate pr-8 text-sm">
            {attachment.filename}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("chat.imageHelp")}
          </DialogDescription>
          <div className="flex items-center justify-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("chat.zoomOut")}
              disabled={zoom <= 1}
              onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
            >
              <Minus className="size-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums">
              {zoom * 100}%
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("chat.zoomIn")}
              disabled={zoom >= 3}
              onClick={() => setZoom((v) => Math.min(3, v + 0.5))}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("chat.resetZoom")}
              onClick={() => setZoom(1)}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
          <div
            className="max-h-[75dvh] min-h-32 overflow-auto rounded-md bg-muted/50"
            style={{ touchAction: "pan-x pan-y pinch-zoom" }}
          >
            {imageUrl && !failed ? (
              <div
                className="grid min-w-full place-items-center"
                style={{ width, minHeight: Math.max(128, height ?? 128) }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={attachment.filename}
                  className="max-w-none object-contain"
                  style={{ width, height }}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setNatural((previous) =>
                      previous.width === image.naturalWidth &&
                      previous.height === image.naturalHeight
                        ? previous
                        : {
                            width: image.naturalWidth,
                            height: image.naturalHeight,
                          },
                    );
                  }}
                  onError={() => setFailed(true)}
                />
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center gap-2 p-4 text-sm">
                {failed ? (
                  <>
                    <span>{t("chat.imageFailed")}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFailed(false);
                        setRetry((v) => v + 1);
                      }}
                    >
                      {t("common.retry")}
                    </Button>
                  </>
                ) : (
                  <Loader2 className="size-6 animate-spin" />
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
