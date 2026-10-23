import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import { getFollowUpRule } from "@/server/services/follow-up-rules";
import { PageHeader, EmptyState } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { FollowUpRuleEditor } from "./rule-editor";
import { getUnansweredRule } from "@/server/services/unanswered";
import { UnansweredEditor } from "./unanswered-editor";

export const metadata = { title: "自动跟进规则" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin(),
    params = await searchParams;
  const sites = await prisma.site.findMany({
    where: {
      ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
      ...(actor.siteIds === null ? {} : { id: { in: actor.siteIds } }),
    },
    select: { id: true, name: true, tenant: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const selected =
    typeof params.siteId === "string" && params.siteId
      ? params.siteId
      : sites[0]?.id;
  if (selected && !sites.some((site) => site.id === selected)) notFound();
  const initial = selected ? await getFollowUpRule(actor, selected) : null;
  const unanswered = selected ? await getUnansweredRule(actor, selected) : null;
  return (
    <div className="space-y-5">
      <PageHeader
        title="自动跟进规则"
        description="按站点设置离线留言待办和长时间未回复提醒，分别开启、独立保存。"
        actions={
          <Button asChild variant="outline">
            <a href={`${ADMIN_PATH}/follow-ups`}>返回跟进待办</a>
          </Button>
        }
      />
      {initial ? (
        <>
          <form
            action={`${ADMIN_PATH}/follow-ups/rules`}
            className="flex max-w-2xl flex-wrap items-end gap-3"
          >
            <label
              className="flex min-w-0 flex-1 flex-col gap-2 text-sm"
              htmlFor="rule-site"
            >
              配置站点
              <select
                id="rule-site"
                name="siteId"
                defaultValue={selected}
                className="h-10 w-full min-w-0 rounded-md border bg-background px-3"
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {actor.role === "ADMIN" ? `${site.tenant.name} · ` : ""}
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" className="h-10">
              切换站点
            </Button>
          </form>
          <FollowUpRuleEditor key={selected} initial={initial} />
          {unanswered && (
            <UnansweredEditor
              key={`unanswered-${selected}`}
              siteId={selected!}
              initial={unanswered}
            />
          )}
        </>
      ) : (
        <EmptyState
          title="暂无可配置的站点"
          description="请先创建站点，再配置自动跟进。"
        />
      )}
    </div>
  );
}
