import { requireAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { UnansweredBoard } from "@/components/follow-ups/unanswered-board";
export const metadata = { title: "长时间未回复提醒" };
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  return (
    <UnansweredBoard
      searchParams={searchParams}
      basePath={`${ADMIN_PATH}/follow-ups/unanswered`}
    />
  );
}
