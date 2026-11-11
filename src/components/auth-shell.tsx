import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * 登录、入驻申请、找回密码等页面共用的外壳：
 * 大屏左侧是墨色品牌面板，右侧是表单；小屏只保留顶部的品牌入口和表单。
 * 品牌面板里不放标题元素，每个页面的 h1 始终只有表单区那一个。
 */
export async function AuthShell({
  actions,
  wide = false,
  children,
}: {
  actions?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { t } = await getServerT();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="surface-ink bg-sidebar text-sidebar-foreground pattern-hex glow-honey hidden overflow-hidden [--glow-origin:85%_0%] [--pattern-opacity:0.1] [--pattern-origin:85%_0%] lg:flex lg:flex-col lg:p-10 xl:p-14">
        <Link
          href="/"
          className="focus-visible:ring-ring flex items-center gap-2.5 self-start rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <BrandMark className="size-9" />
          <span className="text-lg font-semibold tracking-tight">
            BeeSupport
          </span>
        </Link>

        <div className="flex flex-1 items-center py-10">
          <ConversationSketch />
        </div>

        <p className="max-w-md text-3xl leading-[1.2] font-semibold tracking-tight xl:text-[2.5rem]">
          {t("app.tagline")}
        </p>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 px-5 py-4 lg:justify-end lg:px-8">
          <Link
            href="/"
            className="focus-visible:ring-ring flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none lg:hidden"
          >
            <BrandMark className="size-7" />
            <span className="text-sm font-semibold tracking-tight">
              BeeSupport
            </span>
          </Link>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pt-6 pb-16">
          <div className={cn("w-full", wide ? "max-w-md" : "max-w-sm")}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** 品牌面板上的对话示意图：只有色块，没有文字，纯装饰。 */
function ConversationSketch() {
  return (
    <div aria-hidden="true" className="w-full max-w-sm">
      <div className="rounded-2xl border bg-white/[0.04] p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="bg-brand/20 ring-brand/40 size-9 shrink-0 rounded-full ring-1" />
          <div className="flex-1 space-y-2">
            <span className="block h-2 w-24 rounded-full bg-white/25" />
            <span className="block h-1.5 w-14 rounded-full bg-white/10" />
          </div>
          <span className="bg-success size-2 rounded-full" />
        </div>
        <div className="mt-6 space-y-3">
          <div className="w-4/5 rounded-2xl rounded-bl-md border bg-white/[0.05] p-3.5">
            <span className="block h-1.5 w-full rounded-full bg-white/20" />
            <span className="mt-2.5 block h-1.5 w-2/3 rounded-full bg-white/20" />
          </div>
          <div className="bg-brand ml-auto w-3/5 rounded-2xl rounded-br-md p-3.5">
            <span className="bg-brand-foreground/35 block h-1.5 w-full rounded-full" />
            <span className="bg-brand-foreground/35 mt-2.5 block h-1.5 w-1/2 rounded-full" />
          </div>
          <div className="flex w-fit items-center gap-1.5 rounded-2xl rounded-bl-md border bg-white/[0.05] px-3.5 py-3">
            <span className="size-1.5 rounded-full bg-white/45" />
            <span className="size-1.5 rounded-full bg-white/30" />
            <span className="size-1.5 rounded-full bg-white/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
