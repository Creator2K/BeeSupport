"use client";

import type { CSSProperties } from "react";

import { WidgetChatConversation } from "@/components/widget/widget-chat-conversation";
import { WidgetChatStates } from "@/components/widget/widget-chat-states";
import { WidgetHeader } from "@/components/widget/widget-header";
import { normalizeHex, relativeLuminance, shade } from "@/lib/color";
import { launcherForeground } from "@/lib/launcher";
import { cn } from "@/lib/utils";
import { useWidgetChat } from "./use-widget-chat";

/** Near-black brand colors disappear on the dark theme, so dark mode gets a lifted variant. */
function brandVariables(primaryColor: string): CSSProperties {
  const day = normalizeHex(primaryColor);
  const night = relativeLuminance(day) < 0.06 ? shade(day, 30) : day;
  return {
    "--site-accent": day,
    "--site-accent-foreground": launcherForeground(day),
    "--site-accent-night": night,
    "--site-accent-night-foreground": launcherForeground(night),
  } as CSSProperties;
}

export function WidgetChat({
  siteKey,
  embedToken,
  pageUrl,
  pageTitle,
  referrer,
  host,
}: {
  siteKey: string;
  embedToken: string;
  pageUrl: string;
  pageTitle: string;
  referrer: string;
  host: string;
}) {
  const chat = useWidgetChat({
    siteKey,
    embedToken,
    pageUrl,
    pageTitle,
    referrer,
    host,
  });
  const primaryColor = chat.config?.primaryColor;

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-hidden",
        primaryColor && "widget-brand",
      )}
      style={primaryColor ? brandVariables(primaryColor) : undefined}
    >
      <WidgetHeader
        config={chat.config}
        online={chat.availability.online}
        onClose={() => chat.postToParent({ type: "beesupport:close" })}
      />
      <WidgetChatStates chat={chat} />
      <WidgetChatConversation chat={chat} />
    </div>
  );
}
