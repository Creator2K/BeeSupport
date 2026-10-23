"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HomeContent } from "@/lib/homepage-content";

import type { UpdateHomeContent } from "./home-editor-types";

export function HomeFeatureFields({
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
    <fieldset
      disabled={disabled}
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
                      content.features.map((item, position) =>
                        position === index
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
  );
}
