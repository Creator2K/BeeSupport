"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bot,
  ChevronDown,
  ContactRound,
  CreditCard,
  Globe,
  LayoutDashboard,
  MessagesSquare,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import {
  navigationItemActive,
  type NavigationGroup,
} from "@/lib/admin-navigation";
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

export function AdminNavGroups({
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
  );
}
