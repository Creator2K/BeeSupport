import { EmptyState, StatCard } from "@/components/admin/page-header";
import {
  efficiencyDuration,
  efficiencyRate,
  type EfficiencyData,
} from "@/lib/efficiency";
import { reportTime } from "@/lib/reporting";

export function EfficiencySummary({ data }: { data: EfficiencyData }) {
  const { summary } = data;
  return (
    <>
    <p className="text-xs leading-6 text-muted-foreground">
      统计快照：{reportTime(new Date(data.asOf))}
      （北京时间）。以下数量和分组均限于所选日期内新建的会话；当前状态、接待人及评价会随后续处理变化，不代表历史时点快照。
    </p>
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="客服效率汇总"
    >
      <StatCard
        label="新建会话"
        value={summary.total}
        hint={`待接入 ${summary.pending} · 进行中 ${summary.open} · 已结束 ${summary.closed}`}
      />
      <StatCard
        label="当前待人工回复"
        value={summary.waiting}
        hint="未结束且仍有访客消息等待人工答复"
      />
      <StatCard
        label="平均首次响应"
        value={efficiencyDuration(summary.avgResponseSeconds)}
        hint={`${summary.responseSamples} 个有效样本；已首响占比 ${efficiencyRate(summary.responseSamples, summary.total)}`}
      />
      <StatCard
        label="90% 首响不超过"
        value={efficiencyDuration(summary.p90ResponseSeconds)}
        hint="P90：反映较慢的首次响应"
      />
      <StatCard
        label="平均结案耗时"
        value={efficiencyDuration(summary.avgCloseSeconds)}
        hint={`${summary.closeSamples} 个有效结案样本；含排队和离线等待`}
      />
      <StatCard
        label="当前结案占比"
        value={efficiencyRate(summary.closed, summary.total)}
        hint="当前状态为已结束的会话占比"
      />
      <StatCard
        label="平均评分"
        value={
          summary.avgRating === null
            ? "—"
            : `${summary.avgRating.toFixed(1)} / 5`
        }
        hint={`${summary.ratingSamples} 个有效评价；评价覆盖 ${efficiencyRate(summary.ratingSamples, summary.total)}`}
      />
      <StatCard
        label="满意评价占比"
        value={efficiencyRate(summary.satisfied, summary.ratingSamples)}
        hint={`${summary.satisfied} / ${summary.ratingSamples} 个评价为 4～5 分`}
      />
    </section>
    {summary.total === 0 && (
      <EmptyState
        title="所选范围暂无会话"
        description="可扩大日期范围，或切换站点、客服。没有样本时，时长和比例显示为“—”。"
      />
    )}
    </>
  );
}
