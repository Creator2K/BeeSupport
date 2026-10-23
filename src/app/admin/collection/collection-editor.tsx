"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CollectionInfo } from "@/components/admin/collection-info";
import { type CollectionSettings, collectionSchema } from "@/lib/collection";
import { saveCollectionAction } from "@/server/actions/collection";
import { callClientAction } from "@/lib/client-action";
export function CollectionEditor({
  initial,
}: {
  initial: { revision: string; settings: CollectionSettings };
}) {
  const [settings, setSettings] = useState(initial.settings),
    [revision, setRevision] = useState(initial.revision),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const preview = collectionSchema.safeParse(settings);
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <form
        className="min-w-0 space-y-5 rounded-xl border p-4 sm:p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          const result = await callClientAction(
            () => saveCollectionAction(settings, revision),
            "保存失败，请重试",
          );
          setPending(false);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          if ("revision" in result) setRevision(result.revision);
          toast.success(result.message);
        }}
      >
        <fieldset disabled={pending} className="space-y-5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings({ ...settings, enabled: e.target.checked })
              }
            />
            向商家展示收款说明
          </label>
          <div className="space-y-2">
            <Label htmlFor="collection-title">说明标题</Label>
            <Input
              id="collection-title"
              required
              maxLength={60}
              value={settings.title}
              onChange={(e) =>
                setSettings({ ...settings, title: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-instructions">收款说明</Label>
            <Textarea
              id="collection-instructions"
              rows={7}
              maxLength={2000}
              placeholder="填写支持的付款渠道、收款方、账号及付款备注要求。"
              value={settings.instructions}
              onChange={(e) =>
                setSettings({ ...settings, instructions: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-contact">平台联系方式</Label>
            <Input
              id="collection-contact"
              maxLength={200}
              value={settings.contact}
              onChange={(e) =>
                setSettings({ ...settings, contact: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-qr">收款码图片地址（可选）</Label>
            <Input
              id="collection-qr"
              type="url"
              maxLength={2048}
              value={settings.qrCodeUrl}
              onChange={(e) =>
                setSettings({ ...settings, qrCodeUrl: e.target.value })
              }
            />
            <p className="text-xs leading-6 text-muted-foreground">
              使用商家浏览器可以访问的 http / https
              图片地址。保存前请核对收款方和二维码；图片只在浏览器加载。
            </p>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存收款配置"}
        </Button>
      </form>
      <div className="min-w-0 space-y-3">
        <h2 className="font-medium">商家端预览</h2>
        <p className="text-xs text-muted-foreground">
          保存后生效；关闭展示会保留已填写内容。
        </p>
        {preview.success ? (
          <CollectionInfo settings={preview.data} />
        ) : (
          <p className="text-sm text-muted-foreground">
            请填写有效配置后查看预览。
          </p>
        )}
      </div>
    </div>
  );
}
