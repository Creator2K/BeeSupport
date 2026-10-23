"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { callClientAction } from "@/lib/client-action";
import { setRiskRuleActiveAction } from "@/server/actions/risk";

import { RiskDeleteDialog } from "./risk-delete-dialog";
import { RiskEventsTable } from "./risk-events-table";
import { RiskRuleDialog } from "./risk-rule-dialog";
import { RiskRuleTable } from "./risk-rule-table";
import type {
  RiskEvent,
  RiskFilters,
  RiskRule,
  RiskSite,
} from "./risk-types";

type RuleDraft = {
  rule: RiskRule | null;
  initialIp: string;
  initialSiteId: string;
};

export function RiskClient({
  basePath,
  rules,
  events,
  sites,
  total,
  eventTotal,
  page,
  eventPage,
  filters,
  initialIp,
  initialSiteId,
  activeCount,
  recentCount,
}: {
  basePath: string;
  rules: RiskRule[];
  events: RiskEvent[];
  sites: RiskSite[];
  total: number;
  eventTotal: number;
  page: number;
  eventPage: number;
  filters: RiskFilters;
  initialIp: string;
  initialSiteId: string;
  activeCount: number;
  recentCount: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<RuleDraft | undefined>(
    initialIp ? { rule: null, initialIp, initialSiteId } : undefined,
  );
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState<RiskRule | null>(null);
  const [confirmedRules, setConfirmedRules] = useState<
    Record<string, { active: boolean; updatedAt: string }>
  >({});
  const [deletedRules, setDeletedRules] = useState<string[]>([]);
  const visibleRules = rules
    .filter((rule) => !deletedRules.includes(rule.id))
    .map((rule) => {
      const confirmed = confirmedRules[rule.id];
      return confirmed && confirmed.updatedAt > rule.updatedAt
        ? { ...rule, active: confirmed.active }
        : rule;
    });
  const displayedTotal =
    total - rules.filter((rule) => deletedRules.includes(rule.id)).length;
  const displayedActive =
    activeCount +
    rules.reduce((change, rule) => {
      if (rule.expired) return change;
      const visible = visibleRules.find((item) => item.id === rule.id);
      return change + Number(Boolean(visible?.active)) - Number(rule.active);
    }, 0);

  function pageUrl(key: "page" | "eventPage", next: number) {
    const params = new URLSearchParams({
      ...filters,
      page: String(page),
      eventPage: String(eventPage),
    });
    params.set(key, String(next));
    return `${basePath}?${params}`;
  }

  async function toggleRule(rule: RiskRule) {
    if (pending) return;
    setPending(true);
    try {
      const result = await callClientAction(
        async () => {
          const next = await setRiskRuleActiveAction(rule.id, !rule.active);
          if (next.ok && "rule" in next) {
            setConfirmedRules((previous) => ({
              ...previous,
              [rule.id]: next.rule,
            }));
          }
          return next;
        },
        "操作失败，请重试",
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["生效规则", displayedActive],
          ["近 24 小时拦截", recentCount],
          ["拦截记录", eventTotal],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <RiskRuleTable
        rules={visibleRules}
        sites={sites}
        filters={filters}
        page={page}
        total={displayedTotal}
        previous={pageUrl("page", page - 1)}
        next={pageUrl("page", page + 1)}
        pending={pending}
        onAdd={() =>
          setDraft({ rule: null, initialIp: "", initialSiteId: "" })
        }
        onEdit={(rule) =>
          setDraft({ rule, initialIp: "", initialSiteId: "" })
        }
        onToggle={(rule) => void toggleRule(rule)}
        onDelete={setDeleting}
      />
      <RiskEventsTable
        events={events}
        basePath={basePath}
        page={eventPage}
        total={eventTotal}
        previous={pageUrl("eventPage", eventPage - 1)}
        next={pageUrl("eventPage", eventPage + 1)}
      />
      {draft && (
        <RiskRuleDialog
          key={`${draft.rule?.id ?? "new"}:${draft.initialIp}:${draft.initialSiteId}:${draft.rule?.updatedAt ?? ""}`}
          rule={draft.rule}
          initialIp={draft.initialIp}
          initialSiteId={draft.initialSiteId}
          sites={sites}
          onClose={() => setDraft(undefined)}
        />
      )}
      {deleting && (
        <RiskDeleteDialog
          key={deleting.id}
          rule={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setDeletedRules((previous) => [...previous, id]);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
