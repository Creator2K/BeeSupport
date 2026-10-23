"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { HomeContent } from "@/lib/homepage-content";

import type { UpdateHomeContent } from "./home-editor-types";

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

export function HomeCopyFields({
  content,
  update,
  disabled,
}: {
  content: HomeContent;
  update: UpdateHomeContent;
  disabled: boolean;
}) {
  const id = useId();

  return (
    <>
      <fieldset
        disabled={disabled}
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
        disabled={disabled}
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
    </>
  );
}
