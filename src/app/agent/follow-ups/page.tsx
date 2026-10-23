import { FollowUpBoard } from "@/components/follow-ups/follow-up-board";
export const metadata = { title: "我的跟进待办" };
export const dynamic = "force-dynamic";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="h-dvh overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <FollowUpBoard
          searchParams={searchParams}
          basePath="/agent/follow-ups"
        />
      </div>
    </main>
  );
}
