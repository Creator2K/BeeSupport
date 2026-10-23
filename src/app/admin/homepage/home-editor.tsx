"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { callClientAction } from "@/lib/client-action";
import { DEFAULT_HOME_CONTENT, type HomeContent } from "@/lib/homepage-content";
import {
  publishHomeAction,
  saveHomeDraftAction,
} from "@/server/actions/homepage";

import { HomeCopyFields } from "./home-copy-fields";
import type { HomePlanOption } from "./home-editor-types";
import { HomeFaqFields } from "./home-faq-fields";
import { HomeFeatureFields } from "./home-feature-fields";
import { HomePlanFields } from "./home-plan-fields";

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
  plans: HomePlanOption[];
}) {
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
    setContent((previous) => ({ ...previous, [key]: value }));

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
      <HomeCopyFields content={content} update={update} disabled={pending} />
      <HomeFeatureFields
        content={content}
        update={update}
        disabled={pending}
      />
      <HomeFaqFields content={content} update={update} disabled={pending} />
      <HomePlanFields
        content={content}
        plans={plans}
        update={update}
        disabled={pending}
      />
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
