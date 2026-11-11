import { cn } from "@/lib/utils";

/**
 * BeeSupport 的标志：圆角六边形（蜂巢）里的对话气泡。
 * 只用品牌色变量，不带渐变 id，所以同一页可以出现多次（包括在隐藏的容器里）。
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("size-8 shrink-0", className)}
    >
      <path
        d="M16 3 27.26 9.5v13L16 29 4.74 22.5v-13z"
        strokeWidth="3"
        strokeLinejoin="round"
        className="fill-brand stroke-brand"
      />
      <path
        d="M12.8 10.6h6.4a3.2 3.2 0 0 1 3.2 3.2v2.6a3.2 3.2 0 0 1-3.2 3.2h-3.1l-3.3 2.9v-2.9a3.2 3.2 0 0 1-3.2-3.2v-2.6a3.2 3.2 0 0 1 3.2-3.2z"
        className="fill-brand-foreground"
      />
      <g className="fill-brand">
        <circle cx="13.2" cy="15.1" r="1.05" />
        <circle cx="16" cy="15.1" r="1.05" />
        <circle cx="18.8" cy="15.1" r="1.05" />
      </g>
    </svg>
  );
}
