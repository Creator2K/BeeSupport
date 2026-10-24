import type { EfficiencyData } from "@/lib/efficiency";
import { EfficiencyGroups } from "@/components/admin/efficiency-groups";
import { EfficiencySummary } from "./efficiency-summary";
import { EfficiencyTrend } from "./efficiency-trend";

export function EfficiencyReport({
  data,
  platform,
}: {
  data: EfficiencyData;
  platform: boolean;
}) {
  return (
    <>
    <EfficiencySummary data={data} />
    <EfficiencyTrend data={data} />
    <EfficiencyGroups
      title="站点分组"
      rows={data.sites}
      totalGroups={data.siteGroups}
      platform={platform}
    />
    <EfficiencyGroups
      title="客服分组"
      rows={data.agents}
      totalGroups={data.agentGroups}
      platform={platform}
    />
    <section
      className="space-y-2 rounded-lg border p-4 text-xs leading-6 text-muted-foreground"
      aria-label="客服效率统计口径"
    >
      <h2 className="text-sm font-medium text-foreground">统计口径</h2>
      <p>
        客服筛选和分组按当前／最后接待人归属。转接前的首响仍计入整段会话，不拆分每位客服的贡献；未分配包含原接待账号已删除的会话。停用站点及账号的历史数据保留。
      </p>
      <p>
        首响从会话创建到首次人工公开回复，文本、图片、文件均算回复，内部备注、已读、系统消息及
        AI
        自动回复不算。结案耗时从创建到最近一次结案，包含等待、非工作时间和重新打开前的时间，不是客服实际工作时长。
      </p>
      <p>
        当前待回复按等待状态判断；历史缺少等待字段时根据访客与人工公开消息补充判断。只统计当前未结束的会话，与仅在启用规则后生成的提醒数量不同。评价使用会话当前保留的有效
        1～5 分，4～5
        分为满意；不按评价提交日统计。所有时长、分位数和比例显示对应样本数，缺样本显示“—”。
      </p>
    </section>
    </>
  );
}
