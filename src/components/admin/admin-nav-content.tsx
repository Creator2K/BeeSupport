"use client";

import type { NavigationGroup } from "@/lib/admin-navigation";
import type { ShellUser } from "./admin-shell-types";
import { AdminNavBrand } from "./admin-nav-brand";
import { AdminNavGroups } from "./admin-nav-groups";
import { AdminNavUserMenu } from "./admin-nav-user-menu";

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
  return (
    <>
      <AdminNavBrand
        user={user}
        basePath={basePath}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <AdminNavGroups
        user={user}
        basePath={basePath}
        groups={groups}
        closedGroups={closedGroups}
        toggleGroup={toggleGroup}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <div className="bg-sidebar shrink-0 border-t p-2">
        <AdminNavUserMenu
          user={user}
          basePath={basePath}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </div>
    </>
  );
}
