"use client";

import { useRouter } from "next/navigation";
import {
  ChevronDown,
  CircleUserRound,
  LogOut,
  MessagesSquare,
  Settings,
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
import { clearAccountDrafts } from "@/lib/chat-drafts";
import { cn } from "@/lib/utils";
import type { ShellUser } from "./admin-shell-types";

export function AdminNavUserMenu({
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
