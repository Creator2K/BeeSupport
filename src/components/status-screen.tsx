import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

/**
 * 整页的状态屏（404、出错）：品牌墨色底，中间是状态码、说明和出口。
 * 不读语言和会话，文案由调用方传入，服务端页面和客户端错误边界都能用。
 */
export function StatusScreen({
  code,
  title,
  description,
  actions,
  footnote,
}: {
  code: string;
  title: React.ReactNode;
  description: React.ReactNode;
  actions: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <div className="surface-ink bg-background pattern-hex glow-honey flex min-h-dvh flex-col [--pattern-opacity:0.08]">
      <header className="px-6 py-6 sm:px-10">
        <Link
          href="/"
          className="focus-visible:ring-ring/50 inline-flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px]"
        >
          <BrandMark className="size-8" />
          <span className="font-semibold tracking-tight">BeeSupport</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="animate-stagger flex max-w-md flex-col items-center text-center">
          <p
            aria-hidden="true"
            className="from-brand-strong to-brand/10 bg-linear-to-b bg-clip-text text-[length:clamp(5.5rem,24vw,8.5rem)] leading-none font-semibold tracking-tighter text-transparent tabular-nums select-none"
          >
            {code}
          </p>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {title}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed text-pretty sm:text-base">
            {description}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {actions}
          </div>
          {footnote ? (
            <p className="text-muted-foreground mt-6 font-mono text-xs select-all">
              {footnote}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/**
 * 控制台内容区里的状态块（找不到、出错）：外壳和侧栏保留，只替换内容区。
 */
export function SectionStatus({
  icon,
  title,
  description,
  actions,
  footnote,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions?: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="animate-stagger flex max-w-md flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="text-brand-strong relative grid size-16 place-items-center"
        >
          <svg
            viewBox="0 0 24 24"
            strokeWidth="0.8"
            strokeLinejoin="round"
            className="fill-brand-soft stroke-brand-strong/40 absolute inset-0 size-full"
          >
            <path d="M12 2.2 20.5 7.1v9.8L12 21.8l-8.5-4.9V7.1z" />
          </svg>
          <span className="relative [&_svg]:size-6">{icon}</span>
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
          {description}
        </p>
        {actions ? (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {actions}
          </div>
        ) : null}
        {footnote ? (
          <p className="text-muted-foreground mt-5 font-mono text-xs select-all">
            {footnote}
          </p>
        ) : null}
      </div>
    </div>
  );
}
