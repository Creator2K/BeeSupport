"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { getOnboarding } from "@/server/services/onboarding";

export function OnboardingGuide({
  state,
  appUrl,
  basePath,
}: {
  state: Awaited<ReturnType<typeof getOnboarding>>;
  appUrl: string;
  basePath: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(
    state.sites.find((site) => site.active)?.id ?? "",
  );
  const site =
    state.sites.find((site) => site.id === selected) ??
    state.sites.find((site) => site.active) ??
    state.sites[0];
  const hasSite = Boolean(site?.active),
    hasConversation = Boolean(site?.hasConversation),
    embedded = Boolean(site?.active && site.embedSeenAt);
  const progress = [hasSite, hasConversation, embedded].filter(Boolean).length;
  const snippet = site
    ? `<script src="${appUrl.replace(/\/$/, "")}/widget.js?key=${encodeURIComponent(site.publicKey)}" async></script>`
    : "";
  const steps = [
    {
      done: hasSite,
      title: "创建你的站点",
      text: "填写站点名称和允许接入的域名，生成本站点的嵌入代码。",
      path: "/sites",
      cta: "管理站点",
    },
    {
      done: hasConversation,
      title: "完成一次试聊",
      text: "打开站点预览，发送一条消息，再到客服工作台接待。仅打开预览不算完成试聊。",
      path: null,
      cta: "打开站点预览",
    },
    {
      done: embedded,
      title: "安装代码并检测接入",
      text: "把下方代码放到你的网站，在网站中打开页面；窗口成功上报后，刷新这里查看接入结果。后台预览不会计入正式接入。",
      path: null,
      cta: null,
    },
  ];
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/20 p-5">
        <p className="font-medium">
          {state.tenantName} ·{" "}
          {progress === 3
            ? "已完成基础接入"
            : `已完成 ${progress} / 3 个接入步骤`}
        </p>
        <div
          role="progressbar"
          aria-label="基础接入进度"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={3}
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            style={{ width: `${(progress / 3) * 100}%` }}
            className="h-full rounded-full bg-primary"
          />
        </div>
        {state.expired && (
          <p
            role="status"
            className="mt-3 text-sm text-amber-700 dark:text-amber-400"
          >
            服务已到期，访客接待暂停。
            <Link href={`${basePath}/subscription`} className="ml-1 underline">
              先提交续费订单
            </Link>
          </p>
        )}
      </div>
      {state.sites.length > 0 && (
        <label className="block space-y-2 text-sm">
          当前操作站点
          <select
            className="block h-10 w-full rounded-md border bg-background px-3 sm:max-w-md"
            value={site?.id ?? ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {state.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
                {site.active ? "" : "（已停用）"}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="space-y-4">
        {steps.map((step, index) => (
          <section
            key={step.title}
            className="flex gap-3 rounded-xl border p-4 sm:p-5"
          >
            {step.done ? (
              <CheckCircle2
                className="mt-1 size-5 shrink-0 text-emerald-700 dark:text-emerald-400"
                aria-hidden="true"
              />
            ) : (
              <Circle
                className="mt-1 size-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <h2 className="font-medium">
                {index + 1}. {step.title}{" "}
                <span className="ml-1 text-xs text-muted-foreground">
                  {step.done ? "已完成" : "待完成"}
                </span>
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {step.text}
              </p>
              {step.path && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`${basePath}${step.path}`}>{step.cta}</Link>
                </Button>
              )}
              {index === 1 && (
                <div className="flex flex-wrap gap-3">
                  {site?.active && !state.expired ? (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/preview?key=${site.publicKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        打开站点预览
                      </Link>
                    </Button>
                  ) : (
                    <Button type="button" disabled size="sm" variant="outline">
                      请先创建启用中的站点并保持服务有效
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link href="/agent">打开客服工作台</Link>
                  </Button>
                </div>
              )}
              {index === 2 && (
                <div className="space-y-3">
                  {site ? (
                    <>
                      <label
                        className="block text-xs font-medium"
                        htmlFor="onboarding-embed-code"
                      >
                        本站点嵌入代码
                      </label>
                      <textarea
                        id="onboarding-embed-code"
                        readOnly
                        value={snippet}
                        rows={3}
                        className="w-full resize-none rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-6"
                      />
                      <div className="flex flex-wrap gap-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(snippet);
                              toast.success("嵌入代码已复制");
                            } catch {
                              document
                                .querySelector<HTMLTextAreaElement>(
                                  "#onboarding-embed-code",
                                )
                                ?.select();
                              toast.info("请手动复制已选中的代码");
                            }
                          }}
                        >
                          <Copy className="size-3.5" />
                          复制嵌入代码
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => router.refresh()}
                        >
                          刷新接入状态
                        </Button>
                      </div>
                      <p className="break-words text-xs text-muted-foreground">
                        {site.embedSeenAt
                          ? `最近接入来源：${site.embedOrigin} · ${new Date(site.embedSeenAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）`
                          : "尚未检测到该站点的真实接入。请检查代码是否部署，以及站点的域名白名单。"}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      创建站点后，这里会显示专属代码。
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
      <section className="space-y-3 rounded-xl border border-dashed p-5">
        <h2 className="font-medium">按需完善服务</h2>
        <p className="text-sm text-muted-foreground">
          商家管理员可以直接接待访客；需要多人协作时，再创建客服并分配站点。
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="sm" variant="outline">
            <Link href={`${basePath}/organization`}>配置品牌与按钮样式</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`${basePath}/agents`}>
              {state.hasTeam ? "管理客服团队" : "添加客服团队（可选）"}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
