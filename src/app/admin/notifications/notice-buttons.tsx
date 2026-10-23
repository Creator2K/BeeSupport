"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markNoticesReadAction } from "@/server/actions/account-notices";
import { callClientAction } from "@/lib/client-action";
export function NoticeButtons({ id }: { id?: string }) {
  const [pending, setPending] = useState(false),
    router = useRouter();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await callClientAction(
          () => markNoticesReadAction(id),
          "操作失败，请重试",
        );
        setPending(false);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        router.refresh();
      }}
    >
      {pending ? "处理中…" : id ? "标为已读" : "全部标为已读"}
    </Button>
  );
}
