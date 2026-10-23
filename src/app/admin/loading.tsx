import { Skeleton } from "@/components/ui/skeleton";

/**
 * 后台的加载骨架：点导航后立刻出现，服务端数据还在查时也不会有「卡住」的感觉。
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>

      <div className="space-y-2">
        <Skeleton className="h-9 w-full max-w-72 rounded-md" />
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
