"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  ContactRound,
  CreditCard,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { clearAccountDrafts } from "@/lib/chat-drafts";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/components/locale-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  adminNavigation,
  navigationItemActive,
  type NavigationGroup,
} from "@/lib/admin-navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  merchants: Store,
  plans: CreditCard,
  orders: ScrollText,
  conversations: MessagesSquare,
  visitors: ContactRound,
  sites: Globe,
  agents: Users,
  canned: Sparkles,
  risk: ShieldCheck,
  webhooks: Bell,
  ai: Bot,
  branding: Palette,
  settings: Settings,
  organization: Store,
  audit: ScrollText,
};
type Preferences = {
  collapsed: boolean;
  closedGroups: Record<string, boolean>;
};
export type ShellUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantExpired?: boolean;
  tenantName?: string;
  counts?: {
    merchants?: number;
    orders?: number;
    conversations?: number;
    notices?: number;
  };
};

export function AdminShell({
  user,
  basePath,
  children,
}: {
  user: ShellUser;
  basePath: string;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>({
    collapsed: false,
    closedGroups: {},
  });
  const [loadedKey, setLoadedKey] = useState("");
  const storageKey = `beesupport:navigation:v1:${user.id}:${user.role}`;
  const groups = useMemo(() => adminNavigation(user.role), [user.role]);
  const activeGroup = groups.find((group) =>
    group.items.some((item) =>
      navigationItemActive(pathname, basePath, item.path),
    ),
  );
  const activeGroupId = activeGroup?.id;
  const activeGroupDefaultOpen = activeGroup?.defaultOpen;
  const activeItem = activeGroup?.items.find((item) =>
    navigationItemActive(pathname, basePath, item.path),
  );
  useEffect(() => {
    let next: Preferences = { collapsed: false, closedGroups: {} };
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (stored && typeof stored === "object")
        next = {
          collapsed: stored.collapsed === true,
          closedGroups: Object.fromEntries(
            Object.entries(stored.closedGroups ?? {}).filter(
              ([key, value]) =>
                groups.some((group) => group.id === key) &&
                typeof value === "boolean",
            ),
          ) as Record<string, boolean>,
        };
    } catch {
      /* Preference storage is optional. */
    }
    setPreferences(next);
    setLoadedKey(storageKey);
  }, [storageKey, groups]);
  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      /* Work in memory when storage is blocked. */
    }
  }, [loadedKey, storageKey, preferences]);
  useEffect(() => {
    if (!activeGroupId || loadedKey !== storageKey) return;
    setPreferences((prev) =>
      (prev.closedGroups[activeGroupId] ?? !activeGroupDefaultOpen)
        ? {
            ...prev,
            closedGroups: { ...prev.closedGroups, [activeGroupId]: false },
          }
        : prev,
    );
  }, [pathname, activeGroupId, activeGroupDefaultOpen, loadedKey, storageKey]);
  const collapsed = preferences.collapsed;
  const toggleGroup = (group: NavigationGroup) =>
    setPreferences((prev) => ({
      ...prev,
      closedGroups: {
        ...prev.closedGroups,
        [group.id]: !(prev.closedGroups[group.id] ?? !group.defaultOpen),
      },
    }));
  const navProps = {
    user,
    basePath,
    groups,
    closedGroups: preferences.closedGroups,
    toggleGroup,
  };
  return (
    <div className="flex min-h-dvh w-full">
      <aside
        data-testid="desktop-sidebar"
        data-collapsed={collapsed}
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground md:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <NavContent
          {...navProps}
          collapsed={collapsed}
          onNavigate={() => undefined}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            aria-label={t(
              collapsed ? "nav.expandSidebar" : "nav.collapseSidebar",
            )}
            aria-expanded={!collapsed}
            onClick={() =>
              setPreferences((prev) => ({
                ...prev,
                collapsed: !prev.collapsed,
              }))
            }
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
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
              className="flex h-dvh w-[min(288px,88vw)] flex-col gap-0 bg-sidebar p-0"
              aria-describedby={undefined}
            >
              <SheetTitle className="sr-only">{t("nav.navigation")}</SheetTitle>
              <NavContent
                {...navProps}
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <div
            className="flex min-w-0 items-center gap-2 text-sm"
            aria-label={t("nav.navigation")}
          >
            <span className="hidden truncate text-muted-foreground sm:inline">
              {activeGroup ? t(activeGroup.label) : t("nav.adminTitle")}
            </span>
            <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
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
        <main className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">
          {user.role !== "ADMIN" && user.tenantExpired && (
            <div
              role="status"
              className="mb-5 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
            >
              服务已到期，访客接待已暂停。请联系平台管理员续期。历史记录可继续查看。
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function NavContent({
  user,
  basePath,
  groups,
  closedGroups,
  toggleGroup,
  collapsed,
  onNavigate,
}: {
  user: ShellUser;
  basePath: string;
  groups: NavigationGroup[];
  closedGroups: Record<string, boolean>;
  toggleGroup: (group: NavigationGroup) => void;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const id = useId();
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
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
          B
        </span>
        {!collapsed && (
          <span className="font-semibold tracking-tight">BeeSupport</span>
        )}
      </Link>
      {!collapsed && (
        <div className="mx-3 mt-3 flex shrink-0 items-center gap-2.5 rounded-lg border bg-background/60 p-3">
          <Store className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">
              {user.role === "ADMIN"
                ? t("nav.platformConsole")
                : user.tenantName || t("nav.merchantConsole")}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t(
                user.role === "ADMIN"
                  ? "nav.platformAdmin"
                  : "nav.merchantAdmin",
              )}
            </p>
          </div>
        </div>
      )}
      <div className={cn("shrink-0 px-3 pb-1 pt-3", collapsed && "px-2")}>
        <Link
          href="/agent"
          onClick={onNavigate}
          title={t("nav.workbench")}
          className="flex h-9 items-center justify-center gap-2 rounded-lg border bg-background text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessagesSquare className="size-4 shrink-0" />
          <span className={collapsed ? "sr-only" : ""}>
            {t("nav.workbench")}
          </span>
        </Link>
      </div>
      <nav
        aria-label={t("nav.navigation")}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-2 pb-4 pt-2"
      >
        {groups.map((group) => {
          const open =
            collapsed ||
            group.id === "overview" ||
            !(closedGroups[group.id] ?? !group.defaultOpen);
          const groupId = `${id}-${group.id}`;
          return (
            <div key={group.id}>
              {group.id !== "overview" &&
                (collapsed ? (
                  <div className="mx-3 mb-2 border-t" />
                ) : (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={groupId}
                    onClick={() => toggleGroup(group)}
                    className="mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>{t(group.label)}</span>
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        !open && "-rotate-90",
                      )}
                    />
                  </button>
                ))}
              <div id={groupId} hidden={!open} className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? Settings;
                  const active = navigationItemActive(
                    pathname,
                    basePath,
                    item.path,
                  );
                  const count = item.count
                    ? (user.counts?.[item.count] ?? 0)
                    : 0;
                  const label = t(item.label);
                  return (
                    <Link
                      key={item.path}
                      href={`${basePath}${item.path}`}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={
                        count
                          ? `${label} · ${t("nav.pendingCount", { count })}`
                          : label
                      }
                      className={cn(
                        "relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span
                        className={collapsed ? "sr-only" : "min-w-0 truncate"}
                      >
                        {label}
                      </span>
                      {count > 0 && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 px-1 text-[10px] font-medium text-primary",
                            collapsed &&
                              "absolute right-1 top-1 ml-0 size-1.5 min-w-0 rounded-full bg-primary p-0",
                          )}
                        >
                          {collapsed ? "" : count > 99 ? "99+" : count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="shrink-0 border-t bg-sidebar p-2">
        <UserMenu
          user={user}
          basePath={basePath}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </div>
    </>
  );
}

function UserMenu({
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
  const router = useRouter();
  async function handleLogout() {
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(
      () => null,
    );
    if (!response?.ok) {
      toast.error(t("common.operationFailed"));
      return;
    }
    clearAccountDrafts(user.id);
    toast.success(t("common.logout"));
    router.replace("/login");
    router.refresh();
  }
  function navigate(path: string) {
    onNavigate();
    router.push(path);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${user.name} · ${t("nav.accountSettings")}`}
          title={user.name}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {user.name.slice(0, 1)}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-tight">
                  {user.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {user.email}
                </span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>
          {t(user.role === "ADMIN" ? "nav.platformAdmin" : "nav.merchantAdmin")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/agent/settings")}>
          <CircleUserRound className="size-4" />
          {t("nav.accountSettings")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/agent")}>
          <MessagesSquare className="size-4" />
          {t("nav.workbench")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            navigate(
              `${basePath}${user.role === "ADMIN" ? "/settings" : "/organization"}`,
            )
          }
        >
          <Settings className="size-4" />
          {t(user.role === "ADMIN" ? "nav.settings" : "nav.organization")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleLogout()}>
          <LogOut className="size-4" />
          {t("common.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
