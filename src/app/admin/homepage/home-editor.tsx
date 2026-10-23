"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_HOME_CONTENT, type HomeContent } from "@/lib/homepage-content";
import {
  saveHomeDraftAction,
  publishHomeAction,
} from "@/server/actions/homepage";
import { callClientAction } from "@/lib/client-action";

const fields = [
  ["brandName", "首页品牌名", 40, false],
  ["description", "搜索引擎描述", 300, true],
  ["heroEyebrow", "首屏顶部短句", 80, false],
  ["titleLine1", "主标题第一行", 40, false],
  ["titleLine2", "主标题第二行前缀", 40, false],
  ["titleHighlight", "主标题强调文字", 40, false],
  ["heroDescription", "首屏介绍（支持换行）", 400, true],
  ["primaryCta", "入驻按钮文字", 30, false],
  ["closingTitle", "页尾邀请标题（支持换行）", 100, true],
  ["footerText", "页脚说明", 150, false],
] as const;
export function HomeEditor({
  initial,
  plans,
}: {
  initial: {
    content: HomeContent;
    revision: string;
    publishedRevision: string;
    publishedAt: string | null;
  };
  plans: {
    id: string;
    name: string;
    priceCents: number;
    durationDays: number;
  }[];
}) {
  const id = useId();
  const [content, setContent] = useState(initial.content);
  const [saved, setSaved] = useState(JSON.stringify(initial.content));
  const [revision, setRevision] = useState(initial.revision);
  const [publishedRevision, setPublishedRevision] = useState(
    initial.publishedRevision,
  );
  const [publishedAt, setPublishedAt] = useState(initial.publishedAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(content) !== saved;
  const update = (key: keyof HomeContent, value: unknown) =>
    setContent((prev) => ({ ...prev, [key]: value }));
  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        const result = await callClientAction(
          () => saveHomeDraftAction(content, revision),
          "草稿保存失败，请重试",
        );
        setPending(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if ("revision" in result) setRevision(result.revision);
        setSaved(JSON.stringify(content));
        toast.success(result.message);
      }}
    >
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-5 rounded-xl border p-4 sm:p-6"
      >
        <legend className="px-1 font-medium">品牌与首页文案</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map(([key, label, max, multiline]) => (
            <div key={key} className="min-w-0 space-y-2">
              <Label htmlFor={`${id}-${key}`}>{label}</Label>
              {multiline ? (
                <Textarea
                  id={`${id}-${key}`}
                  value={content[key]}
                  maxLength={max}
                  rows={3}
                  onChange={(event) => update(key, event.target.value)}
                />
              ) : (
                <Input
                  id={`${id}-${key}`}
                  value={content[key]}
                  maxLength={max}
                  onChange={(event) => update(key, event.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset
        disabled={pending}
        className="min-w-0 rounded-xl border p-4 sm:p-6"
      >
        <legend className="px-1 font-medium">展示区块</legend>
        <div className="flex flex-wrap gap-5">
          {(
            [
              ["features", "产品能力"],
              ["appearance", "外观体验"],
              ["steps", "接入步骤"],
              ["faq", "常见问题"],
              ["plans", "套餐展示"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={content.sections[key]}
                onChange={(event) =>
                  update("sections", {
                    ...content.sections,
                    [key]: event.target.checked,
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-4 rounded-xl border p-4 sm:p-6"
      >
        <legend className="px-1 font-medium">产品能力卡片</legend>
        <div className="grid gap-4 lg:grid-cols-2">
          {content.features.map((feature, index) => (
            <div
              key={index}
              className="min-w-0 space-y-3 rounded-lg border p-3"
            >
              <p className="text-xs text-muted-foreground">卡片 {index + 1}</p>
              {(
                [
                  ["title", "标题", 60],
                  ["tag", "短标签", 40],
                  ["text", "说明", 400],
                ] as const
              ).map(([key, label, max]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`${id}-feature-${index}-${key}`}>
                    卡片 {index + 1} {label}
                  </Label>
                  <Input
                    id={`${id}-feature-${index}-${key}`}
                    value={feature[key]}
                    maxLength={max}
                    onChange={(event) =>
                      update(
                        "features",
                        content.features.map((item, n) =>
                          n === index
                            ? { ...item, [key]: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-4 rounded-xl border p-4 sm:p-6"
      >
        <legend className="px-1 font-medium">常见问题（1–12 条）</legend>
        {content.faqs.map((faq, index) => (
          <div key={index} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">问题 {index + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={content.faqs.length === 1}
                onClick={() =>
                  update(
                    "faqs",
                    content.faqs.filter((_, n) => n !== index),
                  )
                }
              >
                删除问题 {index + 1}
              </Button>
            </div>
            <Label htmlFor={`${id}-faq-${index}-q`}>
              问题 {index + 1} 标题
            </Label>
            <Input
              id={`${id}-faq-${index}-q`}
              value={faq.question}
              maxLength={120}
              onChange={(event) =>
                update(
                  "faqs",
                  content.faqs.map((item, n) =>
                    n === index
                      ? { ...item, question: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <Label htmlFor={`${id}-faq-${index}-a`}>
              问题 {index + 1} 回答
            </Label>
            <Textarea
              id={`${id}-faq-${index}-a`}
              rows={3}
              maxLength={1000}
              value={faq.answer}
              onChange={(event) =>
                update(
                  "faqs",
                  content.faqs.map((item, n) =>
                    n === index
                      ? { ...item, answer: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={content.faqs.length >= 12}
          onClick={() =>
            update("faqs", [
              ...content.faqs,
              { question: "新问题", answer: "请填写回答" },
            ])
          }
        >
          添加常见问题
        </Button>
      </fieldset>
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-3 rounded-xl border p-4 sm:p-6"
      >
        <legend className="px-1 font-medium">公开展示套餐（最多 6 个）</legend>
        <p className="text-xs text-muted-foreground">
          只展示勾选且仍上架的套餐，按勾选先后排序；名称、价格和额度跟随套餐管理同步。不勾选时不展示套餐区块。
        </p>
        {plans.map((plan) => (
          <label
            key={plan.id}
            className="flex items-start gap-2 rounded-lg border p-3 text-sm"
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={content.planIds.includes(plan.id)}
              disabled={
                !content.planIds.includes(plan.id) &&
                content.planIds.length >= 6
              }
              onChange={(event) =>
                update(
                  "planIds",
                  event.target.checked
                    ? [...content.planIds, plan.id]
                    : content.planIds.filter((id) => id !== plan.id),
                )
              }
            />
            <span className="min-w-0 break-words">
              {plan.name} · ¥{(plan.priceCents / 100).toFixed(2)} /{" "}
              {plan.durationDays} 天
            </span>
          </label>
        ))}
        {!plans.length && (
          <p className="text-sm text-muted-foreground">
            请先在套餐管理中创建并上架套餐。
          </p>
        )}
        {content.planIds
          .filter((planId) => !plans.some((plan) => plan.id === planId))
          .map((planId) => (
            <div
              key={planId}
              className="flex items-center justify-between gap-2 text-sm text-destructive"
            >
              <span>原选择的套餐已下架，请移除后发布</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  update(
                    "planIds",
                    content.planIds.filter((id) => id !== planId),
                  )
                }
              >
                移除失效套餐
              </Button>
            </div>
          ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-xs text-muted-foreground">
        {dirty
          ? "有尚未保存的修改；预览仅显示已保存草稿。"
          : "草稿已保存，可以预览或发布。"}{" "}
        {publishedAt
          ? `最近发布：${new Date(publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）`
          : "尚未发布自定义内容，公开首页使用默认内容。"}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "处理中…" : "保存草稿"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            window.open("/home-preview", "_blank", "noopener,noreferrer")
          }
        >
          预览已保存草稿
        </Button>
        <Button
          type="button"
          disabled={pending || dirty || revision === "initial"}
          onClick={async () => {
            setPending(true);
            setError("");
            const result = await callClientAction(
              () => publishHomeAction(revision, publishedRevision),
              "发布失败，请重试",
            );
            setPending(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if ("revision" in result) setPublishedRevision(result.revision);
            setPublishedAt(new Date().toISOString());
            toast.success(result.message);
          }}
        >
          发布到首页
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => setContent(structuredClone(DEFAULT_HOME_CONTENT))}
        >
          填入默认内容
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link href="/" target="_blank" rel="noopener noreferrer">
            查看公开首页
          </Link>
        </Button>
      </div>
    </form>
  );
}
