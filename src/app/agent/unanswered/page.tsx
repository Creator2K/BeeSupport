import { UnansweredBoard } from "@/components/follow-ups/unanswered-board";
export const metadata = { title: "我的未回复提醒" };
export const dynamic = "force-dynamic";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="h-dvh overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <UnansweredBoard
          searchParams={searchParams}
          basePath="/agent/unanswered"
        />
      </div>
    </main>
  );
}
