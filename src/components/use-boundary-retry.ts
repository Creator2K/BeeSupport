"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * 错误边界的「重试」：先让服务端组件重新取数，再重置边界。
 * 只调 reset() 会拿旧的服务端结果重渲染，服务端抛出的错误会原样再出现。
 */
export function useBoundaryRetry(reset: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return { retry, pending };
}
