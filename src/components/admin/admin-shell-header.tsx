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
  mobileNav: React.ReactNode;
};

export function AdminShellHeader({
  collapsed,
  mobileOpen,
  onMobileOpenChange,
  onToggleCollapsed,
  activeGroup,
  activeItem,
  mobileNav,
}: AdminShellHeaderProps) {
  const { t } = useLocale();

  return (
    <header className="bg-background/90 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
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
          className="bg-sidebar flex h-dvh w-[min(288px,88vw)] flex-col gap-0 p-0"
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
