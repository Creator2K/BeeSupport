/* eslint-disable @next/next/no-img-element -- External brand logos match the embedded launcher. */
"use client";

import { useState } from "react";
import { ChevronDown, Headset, MessageCircleMore } from "lucide-react";
import {
  launcherAppearance,
  launcherShowsLabel,
  type LauncherStyle,
} from "@/lib/launcher";

/** Visual only: callers own the button and its accessible name. */
export function LauncherPreview({
  style,
  color,
  label = "在线客服",
  logoUrl = "",
  open = false,
}: {
  style: LauncherStyle;
  color: string;
  label?: string;
  logoUrl?: string;
  open?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  const Icon = open
    ? ChevronDown
    : style === "avatar"
      ? Headset
      : MessageCircleMore;
  return (
    <span
      data-launcher-style={style}
      className="relative inline-flex shrink-0 items-center justify-center gap-2.5 align-middle font-sans text-sm font-semibold leading-none"
      style={{ ...launcherAppearance(style, color), boxSizing: "border-box" }}
    >
      {style === "avatar" && logoUrl && failedUrl !== logoUrl && !open ? (
        <img
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(logoUrl)}
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      ) : (
        <Icon className="size-[26px] shrink-0" aria-hidden="true" />
      )}
      {launcherShowsLabel(style) && (
        <span className="min-w-0 truncate">{label.trim() || "在线客服"}</span>
      )}
    </span>
  );
}
