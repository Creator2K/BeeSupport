"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import {
  adminNavigation,
  navigationItemActive,
  type NavigationGroup,
} from "@/lib/admin-navigation";
import { cn } from "@/lib/utils";

import { AdminShellHeader } from "./admin-shell-header";
import { NavContent } from "./admin-nav-content";
import type { ShellUser } from "./admin-shell-types";

export type { ShellUser } from "./admin-shell-types";

type Preferences = {
  collapsed: boolean;
  closedGroups: Record<string, boolean>;
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
  const mobileNav = (
    <NavContent
      {...navProps}
      collapsed={false}
      onNavigate={() => setMobileOpen(false)}
    />
  );
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
        <AdminShellHeader
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
          onToggleCollapsed={() =>
            setPreferences((prev) => ({
              ...prev,
              collapsed: !prev.collapsed,
            }))
          }
          activeGroup={activeGroup}
          activeItem={activeItem}
          mobileNav={mobileNav}
        />
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
