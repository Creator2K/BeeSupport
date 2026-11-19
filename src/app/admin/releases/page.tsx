import { EmptyState, PageHeader, StatCard } from "@/components/admin/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requirePlatformPage } from "@/lib/platform-page";
import { releaseNotes } from "@/lib/release-notes";
import { getAppRelease } from "@/server/release-deployment";
import { isUpdaterConnected, latestPublishedRelease, readUpdateState } from "@/server/online-update";
import { OnlineUpdatePanel } from "./online-update-panel";

export const metadata = { title: "版本更新记录" };
export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  await requirePlatformPage();
  const [release, history, state] = await Promise.all([
    getAppRelease(),
    prisma.releaseDeployment.findMany({ orderBy: { id: "desc" }, take: 51 }),
    readUpdateState(),
  ]);
  const published = await latestPublishedRelease(release.version);
  const latest = history[0];
  const currentDeployment =
    latest && release.image?.version === latest.version && release.image.commit === latest.commit
      ? latest
      : undefined;
  const displayTime = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: env.REPORT_TIMEZONE,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="版本更新记录"
        description="查看每个版本的变更，以及这台服务器实际启用了哪些版本。"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="当前版本"
          value={release.version}
          hint={release.image ? "发布镜像" : "本地构建"}
        />
        <StatCard label="当前提交" value={release.image?.commit.slice(0, 12) ?? "—"} />
        <StatCard
          label="启用时间"
          value={currentDeployment ? displayTime.format(currentDeployment.startedAt) : "—"}
        />
      </div>
      <OnlineUpdatePanel
        {...published}
        connected={isUpdaterConnected(state)}
        image={!!release.image}
        job={state.job}
      />
      <section className="space-y-3" aria-labelledby="release-notes-title">
        <h2 id="release-notes-title" className="text-lg font-semibold">版本说明</h2>
        {releaseNotes.map(({ version, title, changes }) => (
          <article key={version} className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">
              <span className="mr-2 font-mono">{version}</span>{title}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </article>
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="deployment-history-title">
        <h2 id="deployment-history-title" className="text-lg font-semibold">部署历史</h2>
        <p className="text-sm text-muted-foreground">
          最近 50 次版本启用记录，按时间倒序显示（{env.REPORT_TIMEZONE}）。重启同一镜像版本和提交只记一次。
        </p>
        {history.length ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>启用版本</TableHead>
                  <TableHead>上一个版本</TableHead>
                  <TableHead>启用时间</TableHead>
                  <TableHead>Git 提交</TableHead>
                  <TableHead>镜像构建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.slice(0, 50).map((entry, index) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.version}</TableCell>
                    <TableCell>{history[index + 1]?.version ?? "—"}</TableCell>
                    <TableCell>{displayTime.format(entry.startedAt)}</TableCell>
                    <TableCell className="font-mono" title={entry.commit}>
                      {entry.commit.slice(0, 12)}
                    </TableCell>
                    <TableCell>{displayTime.format(entry.builtAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title="暂无部署记录"
            description="使用正式发布镜像启动后会自动记录版本和启用时间。"
          />
        )}
      </section>
    </div>
  );
}
