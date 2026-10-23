import { PreviewWidget } from "./preview-widget";
import { notFound, redirect } from "next/navigation";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Globe,
  Layers,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getCurrentUser, canAccessSite } from "@/lib/auth";
import { resolveSiteByKey } from "@/lib/widget";
import { createPreviewToken } from "@/lib/widget-origin";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "站点嵌入预览",
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "AGENT") notFound();
  const params = await searchParams;
  const site = await resolveSiteByKey(
    typeof params.key === "string" ? params.key : null,
  ).catch(() => null);
  if (!site || !canAccessSite(user, site.id)) notFound();
  const token = await createPreviewToken(site);
  return (
    <div className="min-h-dvh bg-[#f8faf7] text-[#18352c] selection:bg-emerald-200">
      <div className="border-b border-emerald-900/10 bg-[#e8f1e9] px-4 py-2 text-center text-xs leading-relaxed">
        {site.name} · 访客端嵌入预览 <span className="mx-1 opacity-40">/</span>{" "}
        这是示例网页，发送的消息会进入真实客服工作台
      </div>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <a
          href="#home"
          className="flex min-w-0 items-center gap-2.5 font-semibold"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#204b3b] text-white">
            <Layers className="size-5" />
          </span>
          <span className="truncate">{site.name}</span>
        </a>
        <nav
          aria-label="示例网站导航"
          className="flex items-center gap-5 text-sm"
        >
          <a href="#features" className="hidden sm:block">
            产品优势
          </a>
          <a href="#questions" className="hidden sm:block">
            常见问题
          </a>
          <a
            href="#contact"
            className="rounded-full border border-emerald-900/20 px-4 py-2"
          >
            联系我们
          </a>
        </nav>
      </header>
      <main id="home" className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <section className="grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="mb-5 flex items-center gap-2 text-xs font-medium tracking-widest text-emerald-700">
              <span className="size-1.5 rounded-full bg-emerald-600" /> MAKE
              EVERY CONNECTION COUNT
            </p>
            <h1 className="text-4xl font-semibold leading-[1.2] tracking-tight sm:text-5xl lg:text-6xl">
              好产品，
              <br />
              也需要好沟通。
            </h1>
            <p className="mt-6 max-w-md text-base leading-8 text-[#5f7369]">
              让每一次咨询都有回应。从了解产品到解决问题，我们始终在你身边，帮助你找到适合自己的方案。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href="#features"
                className="inline-flex items-center gap-5 rounded-full bg-[#204b3b] px-6 py-3 text-sm text-white"
              >
                探索我们的服务
                <ArrowUpRight className="size-4" />
              </a>
              <a
                href="#contact"
                className="inline-flex items-center gap-2 px-2 py-3 text-sm"
              >
                了解在线咨询
                <ArrowDown className="size-4" />
              </a>
            </div>
            <p className="mt-8 flex items-center gap-2 text-xs text-[#5f7369]">
              <Check className="size-4" /> 专注体验 · 及时响应 · 用心服务
            </p>
          </div>
          <div className="relative overflow-hidden rounded-[2rem] bg-[#dfeade] p-7 sm:p-10">
            <div className="absolute -right-12 -top-12 size-64 rounded-full border-[35px] border-white/20" />
            <div className="relative rounded-2xl bg-white/90 p-6 shadow-xl shadow-emerald-950/5">
              <div className="flex items-center justify-between border-b border-emerald-900/10 pb-4">
                <span className="text-sm font-medium">每一步，都有人陪伴</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">
                  SERVICE PLUS
                </span>
              </div>
              <div className="my-7 flex items-center gap-4">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-[#204b3b] text-white">
                  <MessageCircle className="size-7" />
                </span>
                <div>
                  <p className="font-semibold">把问题交给我们</p>
                  <p className="mt-1 text-xs text-[#5f7369]">
                    把时间留给更重要的事
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  "产品咨询与方案建议",
                  "使用指导与技术支持",
                  "订单跟进与售后服务",
                ].map((text) => (
                  <div
                    key={text}
                    className="flex items-center justify-between rounded-xl bg-[#f3f6f1] px-4 py-3 text-sm"
                  >
                    <span>{text}</span>
                    <Check className="size-4 text-emerald-700" />
                  </div>
                ))}
              </div>
            </div>
            <div className="relative ml-auto mt-5 w-fit rounded-xl bg-[#204b3b] px-4 py-3 text-sm text-white">
              一条消息，让沟通更简单。
            </div>
          </div>
        </section>
        <section
          id="features"
          className="scroll-mt-8 border-t border-emerald-900/10 py-12 sm:py-16"
        >
          <p className="text-xs tracking-widest text-emerald-700">
            BUILT AROUND YOU
          </p>
          <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">
            从你的需求出发
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: Sparkles,
                title: "简单易用",
                text: "清晰的产品体验，让每一次使用都轻松自然。",
              },
              {
                icon: ShieldCheck,
                title: "可靠服务",
                text: "从选购到使用，为你提供持续、贴心的支持。",
              },
              {
                icon: Globe,
                title: "随时连接",
                text: "无论电脑还是手机，打开网页就能找到我们。",
              },
            ].map(({ icon: Icon, title, text }) => (
              <article
                key={title}
                className="rounded-2xl border border-emerald-900/10 bg-white p-6"
              >
                <Icon className="mb-5 size-6 text-emerald-700" />
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#5f7369]">{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="questions" className="scroll-mt-8 py-8">
          <h2 className="text-2xl font-semibold">你可能想了解</h2>
          <div className="mt-6 divide-y divide-emerald-900/10">
            {[
              [
                "如何选择适合自己的方案？",
                "告诉我们你的使用场景，客服会根据需求提供建议。",
              ],
              [
                "遇到问题可以在哪里咨询？",
                "点击页面角落的聊天按钮，直接与客服沟通；不在线时也可以留言。",
              ],
              [
                "手机上可以使用在线咨询吗？",
                "可以。网页和聊天窗口都会根据屏幕尺寸调整，手机也能轻松交流。",
              ],
            ].map(([q, a]) => (
              <details key={q} className="py-5">
                <summary className="cursor-pointer text-sm font-medium">
                  {q}
                </summary>
                <p className="mt-3 text-sm leading-7 text-[#5f7369]">{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section
          id="contact"
          className="mt-10 scroll-mt-8 rounded-2xl bg-[#204b3b] p-7 text-white sm:p-10"
        >
          <h2 className="text-2xl font-semibold">有问题，随时聊聊。</h2>
          <p className="mt-3 max-w-lg text-sm leading-7 text-emerald-100/80">
            点击页面角落的客服气泡即可开始咨询。你可以试试发送文字、表情和图片，感受访客在真实网页中的沟通体验。
          </p>
        </section>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 text-xs text-[#5f7369]">
          <span>
            © {new Date().getFullYear()} {site.name}
          </span>
          <span>示例内容，仅用于嵌入效果预览</span>
        </footer>
      </main>
      <PreviewWidget
        src={`/widget.js?${new URLSearchParams({ key: site.publicKey, preview: token })}`}
      />
    </div>
  );
}
