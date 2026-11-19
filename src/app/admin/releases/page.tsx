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
import { readImageRelease } from "@/server/release-deployment";

export const metadata = { title: "版本更新记录" };
export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  await requirePlatformPage();
  const [release, history] = await Promise.all([
    readImageRelease(),
    prisma.releaseDeployment.findMany({ orderBy: { id: "desc" }, take: 50 }),
  ]);
  const displayTime = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: env.REPORT_TIMEZONE,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="版本更新记录"
        description={`最近 50 次版本切换按启动时间倒序显示，时区为 ${env.REPORT_TIMEZONE}。`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="当前版本" value={release?.version ?? "本地构建"} />
        <StatCard label="当前提交" value={release?.commit.slice(0, 12) ?? "—"} />
      </div>
      {history.length ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>版本</TableHead>
                <TableHead>Git 提交</TableHead>
                <TableHead>镜像构建时间</TableHead>
                <TableHead>应用启动时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.version}</TableCell>
                  <TableCell className="font-mono" title={entry.commit}>
                    {entry.commit.slice(0, 12)}
                  </TableCell>
                  <TableCell>{displayTime.format(entry.builtAt)}</TableCell>
                  <TableCell>{displayTime.format(entry.startedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="暂无版本更新记录"
          description="带版本号的发布镜像启动后会自动生成记录。"
        />
      )}
    </div>
  );
}
