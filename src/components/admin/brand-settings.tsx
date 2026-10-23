"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { BrandingEditor } from "./branding-editor";
import { Button } from "@/components/ui/button";
import type { WidgetSettings, EffectiveWidgetSettings } from "@/lib/branding";
import { saveBrandingAction } from "@/server/actions/tenants";
import { callClientAction } from "@/lib/client-action";

export function BrandSettings({
  initial,
  inherited,
  platform = false,
  canCustomizeFooter = true,
}: {
  initial: WidgetSettings;
  inherited: EffectiveWidgetSettings;
  platform?: boolean;
  canCustomizeFooter?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError("");
        const result = await callClientAction(
          () => saveBrandingAction(value, platform),
          "配置保存失败，请重试",
        );
        setPending(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success(result.message);
        router.refresh();
      }}
    >
      {!canCustomizeFooter && (
        <p className="text-sm text-muted-foreground">
          当前套餐的底部品牌由平台统一显示，其他窗口配置可正常修改。
        </p>
      )}
      <BrandingEditor
        value={value}
        inherited={inherited}
        onChange={setValue}
        canCustomizeFooter={canCustomizeFooter}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存默认配置"}
      </Button>
    </form>
  );
}
