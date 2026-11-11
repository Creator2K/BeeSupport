"use client";

import Link from "next/link";
import { MessagesSquare, Store } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { useLocale } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { ShellUser } from "./admin-shell-types";

export function AdminNavBrand({
  user,
  basePath,
  collapsed,
  onNavigate,
}: {
  user: ShellUser;
  basePath: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const { t } = useLocale();
  return (
    <>
      <Link
        href={basePath}
        onClick={onNavigate}
        aria-label="BeeSupport"
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 border-b px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <BrandMark className="size-8" />
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight">
            BeeSupport
          </span>
        )}
      </Link>
      {!collapsed && (
        <div className="bg-sidebar-accent/50 mx-3 mt-3 flex shrink-0 items-center gap-2.5 rounded-xl border p-2.5">
          <span className="bg-sidebar-accent text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Store className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">
              {user.role === "ADMIN"
                ? t("nav.platformConsole")
                : user.tenantName || t("nav.merchantConsole")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {t(
                user.role === "ADMIN"
                  ? "nav.platformAdmin"
                  : "nav.merchantAdmin",
              )}
            </p>
          </div>
        </div>
      )}
      <div className={cn("shrink-0 px-3 pt-3 pb-1", collapsed && "px-2")}>
        <Link
          href="/agent"
          onClick={onNavigate}
          title={t("nav.workbench")}
          className="bg-sidebar-accent focus-visible:ring-ring flex h-9 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-colors hover:bg-white/[0.13] focus-visible:ring-2 focus-visible:outline-none"
        >
          <MessagesSquare className="size-4 shrink-0" />
          <span className={collapsed ? "sr-only" : ""}>
            {t("nav.workbench")}
          </span>
        </Link>
      </div>
    </>
  );
}
