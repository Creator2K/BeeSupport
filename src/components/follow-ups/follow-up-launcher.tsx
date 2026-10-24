"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FollowUpEditor } from "./follow-up-editor";

export function FollowUpLauncher({
  conversationId,
  compact = false,
  refreshList = false,
}: {
  conversationId: string;
  compact?: boolean;
  refreshList?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="安排或处理会话跟进"
        onClick={() => setOpen(true)}
      >
        <Clock className="size-4" />
        <span className={compact ? "hidden sm:inline" : ""}>会话跟进</span>
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>会话跟进</DialogTitle>
          <DialogDescription>
            为当前会话安排内部跟进。时间统一使用北京时间，任务与会话状态分别管理。
          </DialogDescription>
        </DialogHeader>
        {open && (
          <FollowUpEditor
            key={conversationId}
            conversationId={conversationId}
            refreshList={refreshList}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
