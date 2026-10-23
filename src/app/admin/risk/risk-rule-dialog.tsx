"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callClientAction } from "@/lib/client-action";
import { saveRiskRuleAction } from "@/server/actions/risk";

import type { RiskRule, RiskSite } from "./risk-types";
import { riskDateTimeValue, riskSelectStyle } from "./risk-ui";

export function RiskRuleDialog({
  rule,
  initialIp,
  initialSiteId,
  sites,
  onClose,
}: {
  rule: RiskRule | null;
  initialIp: string;
  initialSiteId: string;
  sites: RiskSite[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState(rule?.kind ?? (initialIp ? "IP" : "WORD"));
  const [values, setValues] = useState(rule?.value ?? initialIp);
  const [siteId, setSiteId] = useState(rule?.siteId ?? initialSiteId);
  const [note, setNote] = useState(rule?.note ?? "");
  const [expiresAt, setExpiresAt] = useState(
    riskDateTimeValue(rule?.expiresAt ?? null),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!pending && !value) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "编辑规则" : "添加规则"}</DialogTitle>
          <DialogDescription>
            违禁词拦截访客发送的文字；IP 支持单个地址或 CIDR
            网段，不限制客服登录。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError("");
            try {
              const result = await callClientAction(
                () =>
                  saveRiskRuleAction(
                    {
                      kind: kind as "IP" | "WORD",
                      values,
                      siteId: siteId || null,
                      note,
                      expiresAt: expiresAt
                        ? new Date(expiresAt).toISOString()
                        : null,
                    },
                    rule?.id,
                  ),
                "保存失败，请重试",
              );
              if (!result.ok) {
                setError(result.error);
                return;
              }
              toast.success(result.message || "规则已保存");
              onClose();
              router.refresh();
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="risk-kind">规则类型</Label>
              <select
                id="risk-kind"
                className={`${riskSelectStyle} w-full`}
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="WORD">违禁词</option>
                <option value="IP">IP 封禁</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-site">作用范围</Label>
              <select
                id="risk-site"
                className={`${riskSelectStyle} w-full`}
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
              >
                <option value="">全部站点</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="risk-values">
              {kind === "IP" ? "IP 地址 / 网段" : "违禁词"}
            </Label>
            <Textarea
              id="risk-values"
              required
              value={values}
              onChange={(event) => setValues(event.target.value)}
              rows={4}
              maxLength={20000}
              placeholder={
                kind === "IP"
                  ? "203.0.113.10\n198.51.100.0/24\n2001:db8::/32"
                  : "每行一条词语"
              }
            />
            <p className="text-xs text-muted-foreground">
              {rule
                ? "每次编辑一条规则。"
                : "每行一条，最多批量添加 200 条。"}
              {kind === "WORD" && "忽略大小写、全半角和空白字符。"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="risk-expires">到期时间（留空为永久）</Label>
            <Input
              id="risk-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="risk-note">备注</Label>
            <Input
              id="risk-note"
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : "保存规则"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
