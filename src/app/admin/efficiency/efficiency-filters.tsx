"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  EfficiencyFilters as Filters,
  EfficiencyOptions,
} from "@/lib/efficiency";

export function EfficiencyFilters({
  filters,
  options,
  action,
  today,
}: {
  filters: Filters;
  options: EfficiencyOptions;
  action: string;
  today: string;
}) {
  const [siteId, setSiteId] = useState(filters.siteId),
    [agentId, setAgentId] = useState(filters.agentId);
  const selectedSite = options.sites.find((site) => site.id === siteId);
  const agents = selectedSite
    ? options.agents.filter((agent) => agent.tenantId === selectedSite.tenantId)
    : options.agents;
  const field =
    "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
  return (
    <form
      action={action}
      aria-label="筛选客服效率"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
    >
      <label
        className="flex min-w-0 flex-col gap-1 text-sm"
        htmlFor="efficiency-from"
      >
        开始日期
        <input
          id="efficiency-from"
          name="from"
          type="date"
          required
          max={today}
          defaultValue={filters.from}
          className={field}
        />
      </label>
      <label
        className="flex min-w-0 flex-col gap-1 text-sm"
        htmlFor="efficiency-to"
      >
        结束日期
        <input
          id="efficiency-to"
          name="to"
          type="date"
          required
          max={today}
          defaultValue={filters.to}
          className={field}
        />
      </label>
      <label
        className="flex min-w-0 flex-col gap-1 text-sm"
        htmlFor="efficiency-site"
      >
        站点
        <select
          id="efficiency-site"
          name="siteId"
          value={siteId}
          className={field}
          onChange={(event) => {
            setSiteId(event.target.value);
            setAgentId("");
          }}
        >
          <option value="">全部站点</option>
          {options.sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.tenantName ? `${site.tenantName} · ` : ""}
              {site.name}
            </option>
          ))}
        </select>
      </label>
      <label
        className="flex min-w-0 flex-col gap-1 text-sm"
        htmlFor="efficiency-agent"
      >
        当前／最后接待客服
        <select
          id="efficiency-agent"
          name="agentId"
          value={agentId}
          className={field}
          onChange={(event) => setAgentId(event.target.value)}
        >
          <option value="">全部客服</option>
          <option value="unassigned">未分配</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.tenantName ? `${agent.tenantName} · ` : ""}
              {agent.name}
              {agent.active ? "" : "（已停用）"}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" className="h-10 self-end">
        查看效率数据
      </Button>
    </form>
  );
}
