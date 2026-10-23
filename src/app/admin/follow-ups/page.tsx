import { requireAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { FollowUpBoard } from "@/components/follow-ups/follow-up-board";
export const metadata = { title: "会话跟进待办" };
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  return (
    <FollowUpBoard
      searchParams={searchParams}
      basePath={`${ADMIN_PATH}/follow-ups`}
    />
  );
}
