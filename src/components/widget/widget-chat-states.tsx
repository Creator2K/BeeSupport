"use client";

import { Loader2, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WidgetIdentityForm } from "@/components/widget/widget-identity-form";
import type { WidgetChatController } from "./use-widget-chat";

export function WidgetChatStates({ chat }: { chat: WidgetChatController }) {
  const {
    t,
    mode,
    config,
    availability,
    email,
    name,
    formError,
    submitting,
    setEmail,
    setName,
    startSession,
  } = chat;

  return (
    <>
      {mode === "loading" ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("widget.loading")}
        </div>
      ) : null}

      {mode === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <MessageSquare className="text-muted-foreground size-6" />
          <p className="text-muted-foreground text-sm">
            {t("widget.connectionLost")}
          </p>
          <Button size="sm" onClick={() => window.location.reload()}>
            {t("widget.retry")}
          </Button>
        </div>
      ) : null}

      {mode === "form" ? (
        <WidgetIdentityForm
          config={config}
          online={availability.online}
          email={email}
          name={name}
          formError={formError}
          submitting={submitting}
          onEmailChange={setEmail}
          onNameChange={setName}
          onSubmit={(event) => void startSession(event)}
        />
      ) : null}
    </>
  );
}
