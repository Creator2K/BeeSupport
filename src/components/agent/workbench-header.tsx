"use client";

import { useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  RefreshCw,
  Settings,
  UserRound,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";

import { DueFollowUps } from "@/components/follow-ups/due-follow-ups";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/components/locale-provider";
import { NotificationSettings } from "@/components/agent/notification-settings";
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
import type { AgentPreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

import type { WorkbenchMe } from "./workbench-types";

type WorkbenchHeaderProps = {
  me: WorkbenchMe;
  connected: boolean;
  loadingList: boolean;
  preferences: AgentPreferences;
  agentStatus: WorkbenchMe["status"];
  statusPending: boolean;
  adminPath: string;
  onRefresh: () => void;
  onToggleMute: () => void;
  onPreferencesChange: (patch: Partial<AgentPreferences>) => void;
  onChangeStatus: (status: WorkbenchMe["status"]) => void;
  onLogout: () => void;
};

export function WorkbenchHeader({
  me,
  connected,
  loadingList,
  preferences,
  agentStatus,
  statusPending,
  adminPath,
  onRefresh,
  onToggleMute,
  onPreferencesChange,
  onChangeStatus,
  onLogout,
}: WorkbenchHeaderProps) {
  const t = useT();
  const router = useRouter();
  const statusDot =
    agentStatus === "ONLINE"
      ? "bg-emerald-500"
      : agentStatus === "AWAY"
        ? "bg-amber-500"
        : "bg-zinc-400";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <div className="flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md text-[11px] font-bold">
          B
        </div>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">
          {t("nav.agentTitle")}
        </span>
      </div>

      <span
        className={cn(
          "text-muted-foreground ml-2 inline-flex items-center gap-1 text-[11px]",
          connected ? "text-muted-foreground" : "text-amber-600",
        )}
        title={
          connected
            ? t("workbench.connectionOnline")
            : t("workbench.connectionOffline")
        }
      >
        {connected ? (
          <Wifi className="size-3.5" />
        ) : (
          <WifiOff className="size-3.5" />
        )}
        <span className="hidden md:inline">
          {connected
            ? t("workbench.connectionOnline")
            : t("workbench.connectionOffline")}
        </span>
      </span>

      <div className="ml-auto flex items-center gap-1">
        <DueFollowUps />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          title={t("common.refresh")}
        >
          <RefreshCw className={cn("size-4", loadingList && "animate-spin")} />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          title={
            preferences.soundPreset === "none"
              ? t("workbench.soundOff")
              : t("workbench.soundOn")
          }
          onClick={onToggleMute}
        >
          {preferences.soundPreset === "none" ? (
            <VolumeX className="size-4" />
          ) : (
            <Volume2 className="size-4" />
          )}
        </Button>

        <NotificationSettings
          preferences={preferences}
          onChange={onPreferencesChange}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={statusPending}
              aria-label={
                agentStatus === "ONLINE"
                  ? t("workbench.statusOnline")
                  : agentStatus === "AWAY"
                    ? t("workbench.statusAway")
                    : t("workbench.statusOffline")
              }
            >
              <span className={cn("size-2 rounded-full", statusDot)} />
              <span className="hidden sm:inline">
                {agentStatus === "ONLINE"
                  ? t("workbench.statusOnline")
                  : agentStatus === "AWAY"
                    ? t("workbench.statusAway")
                    : t("workbench.statusOffline")}
              </span>
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{me.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChangeStatus("ONLINE")}>
              <span className="size-2 rounded-full bg-emerald-500" />
              {t("workbench.statusOnline")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChangeStatus("AWAY")}>
              <span className="size-2 rounded-full bg-amber-500" />
              {t("workbench.statusAway")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChangeStatus("OFFLINE")}>
              <span className="size-2 rounded-full bg-zinc-400" />
              {t("workbench.statusOffline")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {me.role !== "AGENT" ? (
              <DropdownMenuItem onSelect={() => router.push(adminPath)}>
                <Settings className="size-4" />
                {t("nav.admin")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => router.push("/agent/settings")}>
              <UserRound className="size-4" />
              {t("settings.profile")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut className="size-4" />
              {t("common.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
