"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Bot,
  ChevronDown,
  CircleUserRound,
  ContactRound,
  CreditCard,
  Globe,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  navigationItemActive,
  type NavigationGroup,
} from "@/lib/admin-navigation";
import { clearAccountDrafts } from "@/lib/chat-drafts";
import { cn } from "@/lib/utils";

import type { ShellUser } from "./admin-shell-types";

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

type NavContentProps = {
  user: ShellUser;
  basePath: string;
  groups: NavigationGroup[];
  closedGroups: Record<string, boolean>;
  toggleGroup: (group: NavigationGroup) => void;
  collapsed: boolean;
  onNavigate: () => void;
};

export function NavContent({
  user,
  basePath,
  groups,
  closedGroups,
  toggleGroup,
  collapsed,
  onNavigate,
}: NavContentProps) {
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
        <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold">
          B
        </span>
        {!collapsed && (
          <span className="font-semibold tracking-tight">BeeSupport</span>
        )}
      </Link>
      {!collapsed && (
        <div className="bg-background/60 mx-3 mt-3 flex shrink-0 items-center gap-2.5 rounded-lg border p-3">
          <Store className="text-muted-foreground size-4 shrink-0" />
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
          className="bg-background hover:bg-accent focus-visible:ring-ring flex h-9 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <MessagesSquare className="size-4 shrink-0" />
          <span className={collapsed ? "sr-only" : ""}>
            {t("nav.workbench")}
          </span>
        </Link>
      </div>
      <nav
        aria-label={t("nav.navigation")}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-2 pt-2 pb-4"
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
                    className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-ring mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
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
                          ? `${label} ? ${t("nav.pendingCount", { count })}`
                          : label
                      }
                      className={cn(
                        "focus-visible:ring-ring relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
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
                            "bg-primary/10 text-primary ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[10px] font-medium",
                            collapsed &&
                              "bg-primary absolute top-1 right-1 ml-0 size-1.5 min-w-0 rounded-full p-0",
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
      <div className="bg-sidebar shrink-0 border-t p-2">
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
          aria-label={`${user.name} ? ${t("nav.accountSettings")}`}
          title={user.name}
          className={cn(
            "hover:bg-sidebar-accent focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {user.name.slice(0, 1)}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-tight">
                  {user.name}
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                  {user.email}
                </span>
              </span>
              <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
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
