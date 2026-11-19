"use client";

import Link from "next/link";
import {
  ChevronRight,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/components/locale-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type {
  NavigationGroup,
  NavigationItem,
} from "@/lib/admin-navigation";

type AdminShellHeaderProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onToggleCollapsed: () => void;
  activeGroup: NavigationGroup | undefined;
  activeItem: NavigationItem | undefined;
  release?: { version: string; href?: string };
  mobileNav: React.ReactNode;
};

export function AdminShellHeader({
  collapsed,
  mobileOpen,
  onMobileOpenChange,
  onToggleCollapsed,
  activeGroup,
  activeItem,
  release,
  mobileNav,
}: AdminShellHeaderProps) {
  const { t } = useLocale();

  return (
    <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon-sm"
        className="hidden md:inline-flex"
        aria-label={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" />
        ) : (
          <PanelLeftClose className="size-4" />
        )}
      </Button>
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label={t("nav.openMenu")}
          >
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="surface-ink bg-sidebar text-sidebar-foreground flex h-dvh w-[min(288px,88vw)] flex-col gap-0 p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{t("nav.navigation")}</SheetTitle>
          {mobileNav}
        </SheetContent>
      </Sheet>
      <div
        className="flex min-w-0 items-center gap-2 text-sm"
        aria-label={t("nav.navigation")}
      >
        <span className="text-muted-foreground hidden truncate sm:inline">
          {activeGroup ? t(activeGroup.label) : t("nav.adminTitle")}
        </span>
        <ChevronRight className="text-muted-foreground hidden size-3.5 shrink-0 sm:block" />
        <span className="truncate font-medium">
          {activeItem ? t(activeItem.label) : "BeeSupport"}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {release?.href ? (
          <Link
            href={release.href}
            aria-label={t("nav.currentVersion", { version: release.version })}
            className="rounded-md border px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {release.version}
          </Link>
        ) : release && (
          <span className="rounded-md border px-2 py-1 font-mono text-xs text-muted-foreground">
            {release.version}
          </span>
        )}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="hidden lg:inline-flex"
        >
          <Link href="/agent">
            <MessagesSquare className="size-3.5" />
            {t("nav.workbench")}
          </Link>
        </Button>
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
