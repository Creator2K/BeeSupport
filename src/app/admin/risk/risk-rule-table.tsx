import { Plus, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { RiskPagination } from "./risk-pagination";
import type { RiskFilters, RiskRule, RiskSite } from "./risk-types";
import { riskSelectStyle } from "./risk-ui";

export function RiskRuleTable({
  rules,
  sites,
  filters,
  page,
  total,
  previous,
  next,
  pending,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  rules: RiskRule[];
  sites: RiskSite[];
  filters: RiskFilters;
  page: number;
  total: number;
  previous: string;
  next: string;
  pending: boolean;
  onAdd: () => void;
  onEdit: (rule: RiskRule) => void;
  onToggle: (rule: RiskRule) => void;
  onDelete: (rule: RiskRule) => void;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4" /> 拦截规则
        </h2>
        <Button size="sm" onClick={onAdd}>
          <Plus className="size-4" />
          添加规则
        </Button>
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <Input
          name="query"
          defaultValue={filters.query}
          placeholder="搜索规则内容"
          aria-label="搜索规则内容"
          className="w-full sm:w-48"
        />
        <select
          name="kind"
          defaultValue={filters.kind}
          aria-label="规则类型"
          className={riskSelectStyle}
        >
          <option value="">全部类型</option>
          <option value="WORD">违禁词</option>
          <option value="IP">IP 封禁</option>
        </select>
        <select
          name="siteId"
          defaultValue={filters.siteId}
          aria-label="筛选站点"
          className={`${riskSelectStyle} max-w-full`}
        >
          <option value="">全部站点</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <Button variant="outline" type="submit">
          筛选
        </Button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              {["类型 / 内容", "作用范围", "状态 / 到期", "备注", "操作"].map(
                (label) => (
                  <th key={label} className="px-2 py-3 font-medium">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b last:border-0">
                <td className="max-w-56 break-all px-2 py-3">
                  <span className="mb-1 block text-[11px] text-muted-foreground">
                    {rule.kind === "IP" ? "IP 封禁" : "违禁词"}
                  </span>
                  {rule.value}
                </td>
                <td className="max-w-40 break-words px-2 py-3">
                  {rule.siteName}
                </td>
                <td className="px-2 py-3">
                  <span
                    className={
                      rule.active && !rule.expired
                        ? "text-emerald-600"
                        : "text-muted-foreground"
                    }
                  >
                    {rule.expired
                      ? "已到期"
                      : rule.active
                        ? "生效中"
                        : "已停用"}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {rule.expiresAt ? rule.expiryLabel : "永久"}
                  </span>
                </td>
                <td className="max-w-40 break-words px-2 py-3 text-xs text-muted-foreground">
                  {rule.note || "—"}
                </td>
                <td className="px-2 py-3">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onEdit(rule)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onToggle(rule)}
                    >
                      {rule.active ? "停用" : "启用"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onDelete(rule)}
                    >
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rules.length && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            暂无规则，添加后将按选定范围拦截访客请求。
          </p>
        )}
      </div>
      <RiskPagination
        page={page}
        total={total}
        previous={previous}
        next={next}
      />
    </section>
  );
}
