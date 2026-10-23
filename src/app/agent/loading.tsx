import { Skeleton } from "@/components/ui/skeleton";

/**
 * 工作台加载骨架：三栏结构先行出现，避免切页面时整屏空白。
 */
export default function AgentLoading() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <Skeleton className="size-6 rounded-md" />
        <Skeleton className="h-4 w-28" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-80 shrink-0 space-y-2 border-r p-2.5 sm:block">
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-16 w-full rounded-md" />
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-2 border-b px-3">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex-1 space-y-3 p-4">
            <Skeleton className="h-10 w-2/3 rounded-xl" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-xl" />
            <Skeleton className="h-16 w-3/4 rounded-xl" />
            <Skeleton className="ml-auto h-10 w-2/5 rounded-xl" />
          </div>
          <div className="border-t p-3">
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
