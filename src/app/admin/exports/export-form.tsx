"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AUDIT_ACTION_LABELS,
  conversationStatuses,
  reportOrderStatuses,
  reportKinds,
  exportInputSchema,
  reportDateRange,
  type ExportInput,
} from "@/lib/reporting";

const field =
  "mt-1 h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
export function ExportForm({
  sites,
  dates,
  initial,
}: {
  sites: { id: string; name: string }[];
  dates: { from: string; to: string };
  initial: Record<string, string>;
}) {
  const [kind, setKind] = useState<ExportInput["kind"]>(
    Object.hasOwn(reportKinds, initial.kind)
      ? (initial.kind as ExportInput["kind"])
      : "conversations",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const input = {
      kind,
      from: fields.get("from"),
      to: fields.get("to"),
      query: fields.get("query"),
      ...(kind === "audit"
        ? { action: fields.get("action") }
        : kind === "orders"
          ? { status: fields.get("status") }
          : { status: fields.get("status"), siteId: fields.get("siteId") }),
    };
    setError("");
    setResult("");
    const parsed = exportInputSchema.safeParse(input);
    if (!parsed.success) {
      setError("请检查日期及筛选条件");
      return;
    }
    try {
      reportDateRange(parsed.data.from, parsed.data.to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "日期范围无效");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "导出失败，请稍后重试");
      }
      const blob = await response.blob();
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([a-zA-Z0-9_.-]+)"/)?.[1] ??
        "beesupport-export.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setResult(
        `已生成 ${response.headers.get("X-Export-Rows") ?? "0"} 条记录，文件已开始下载。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-3xl rounded-lg border bg-card p-4 sm:p-6">
      <form onSubmit={submit} className="space-y-5" aria-label="导出业务数据">
        <label className="block text-sm font-medium">
          <span id="export-kind-label">导出内容</span>
          <select
            aria-labelledby="export-kind-label"
            className={field}
            value={kind}
            disabled={busy}
            onChange={(e) => {
              setKind(e.target.value as ExportInput["kind"]);
              setError("");
              setResult("");
            }}
          >
            {Object.entries(reportKinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <fieldset disabled={busy} className="space-y-4">
          <legend className="sr-only">导出筛选条件</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block min-w-0 text-sm font-medium">
              开始日期
              <input
                name="from"
                type="date"
                required
                max={dates.to}
                defaultValue={initial.from || dates.from}
                className={field}
              />
            </label>
            <label className="block min-w-0 text-sm font-medium">
              结束日期
              <input
                name="to"
                type="date"
                required
                max={dates.to}
                defaultValue={initial.to || dates.to}
                className={field}
              />
            </label>
          </div>
          {kind === "conversations" && (
            <label className="block text-sm font-medium">
              <span id="export-site-label">站点</span>
              <select
                aria-labelledby="export-site-label"
                name="siteId"
                className={field}
              >
                <option value="">全部站点</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind !== "audit" ? (
            <label className="block text-sm font-medium">
              <span id="export-status-label">状态</span>
              <select
                aria-labelledby="export-status-label"
                key={kind}
                name="status"
                className={field}
              >
                <option value="">全部状态</option>
                {Object.entries(
                  kind === "conversations"
                    ? conversationStatuses
                    : reportOrderStatuses,
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-sm font-medium">
              <span id="export-action-label">操作类型</span>
              <input
                aria-labelledby="export-action-label"
                name="action"
                list="export-actions"
                defaultValue={initial.action}
                maxLength={100}
                placeholder="全部类型，或输入操作代码"
                className={field}
              />
              <datalist id="export-actions">
                {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </datalist>
            </label>
          )}
          <label className="block text-sm font-medium">
            关键词
            <input
              name="query"
              defaultValue={initial.query}
              maxLength={120}
              className={field}
              placeholder={
                kind === "conversations"
                  ? "访客姓名、邮箱、主题或会话编号"
                  : kind === "orders"
                    ? "订单号、商家或套餐名称"
                    : "操作人员、操作代码、对象或 IP"
              }
            />
          </label>
        </fieldset>
        <div className="space-y-2 text-sm leading-6 text-muted-foreground">
          <p>
            按创建日期筛选，日期与导出时间统一为北京时间。单次最多 90 天、5,000
            条；超出时请缩小范围。CSV 文件可用 Excel 打开。
          </p>
          <p>
            {kind === "conversations"
              ? "会话摘要包含访客姓名、邮箱、接待人员及评分，不包含聊天正文、附件或内部备注。"
              : kind === "orders"
                ? "订单按下单时的套餐与金额快照导出，不包含付款凭证或内部审核备注。"
                : "操作日志包含操作人员、时间、对象及 IP，不包含原始请求或敏感配置。"}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {error}
          </p>
        )}
        <p role="status" className="text-sm">
          {result}
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? "正在生成…" : "下载 CSV"}
        </Button>
      </form>
    </div>
  );
}
