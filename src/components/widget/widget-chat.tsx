"use client";

import { WidgetChatConversation } from "@/components/widget/widget-chat-conversation";
import { WidgetChatStates } from "@/components/widget/widget-chat-states";
import { WidgetHeader } from "@/components/widget/widget-header";
import { useWidgetChat } from "./use-widget-chat";

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

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
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
