"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { HomeContent } from "@/lib/homepage-content";

import type { UpdateHomeContent } from "./home-editor-types";

export function HomeFaqFields({
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
                  content.faqs.filter((_, position) => position !== index),
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
                content.faqs.map((item, position) =>
                  position === index
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
                content.faqs.map((item, position) =>
                  position === index
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
  );
}
