"use client";

import { House, RotateCw } from "lucide-react";

import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { createTranslator } from "@/lib/i18n/translate";

import "./globals.css";

const zh = createTranslator("zh-CN");
const en = createTranslator("en");

/**
 * 根布局本身出错时的兜底页。这时没有语言、主题这些上下文，
 * 所以自带 html/body，文案中英文同时给出；按钮都走整页加载。
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <StatusScreen
          code="500"
          title={
            <>
              {zh("status.errorTitle")}
              <span
                lang="en"
                className="text-muted-foreground mt-2 block text-base font-normal tracking-normal"
              >
                {en("status.errorTitle")}
              </span>
            </>
          }
          description={
            <>
              {zh("status.errorBody")}
              <span lang="en" className="mt-2 block">
                {en("status.errorBody")}
              </span>
            </>
          }
          footnote={
            error.digest ? zh("status.errorId", { id: error.digest }) : undefined
          }
          actions={
            <>
              <Button size="lg" onClick={() => window.location.reload()}>
                <RotateCw aria-hidden="true" />
                {zh("common.retry")} / {en("common.retry")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => window.location.assign("/")}
              >
                <House aria-hidden="true" />
                {zh("auth.backHome")} / {en("auth.backHome")}
              </Button>
            </>
          }
        />
      </body>
    </html>
  );
}
