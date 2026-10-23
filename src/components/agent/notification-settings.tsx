"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Play, Volume2, VolumeX } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { MessageKey } from "@/lib/i18n/translate";
import {
  SOUND_PRESET_IDS,
  type AgentPreferences,
  type SoundPresetId,
} from "@/lib/preferences";
import {
  audioState,
  notificationPermission,
  playSound,
  requestNotificationPermission,
  showDesktopNotification,
  subscribeAudioState,
  unlockAudio,
  type AudioState,
} from "@/lib/notify";
import { cn } from "@/lib/utils";

const PRESET_LABEL_KEY: Record<SoundPresetId, MessageKey> = {
  chime: "notify.preset.chime",
  glass: "notify.preset.glass",
  marimba: "notify.preset.marimba",
  drop: "notify.preset.drop",
  triple: "notify.preset.triple",
  none: "notify.preset.none",
};

export function NotificationSettings({
  preferences,
  onChange,
}: {
  preferences: AgentPreferences;
  onChange: (patch: Partial<AgentPreferences>) => void;
}) {
  const t = useT();
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [audio, setAudio] = useState<AudioState>("suspended");

  useEffect(() => {
    setPermission(notificationPermission());
    const sync = () => setAudio(audioState());
    sync();
    return subscribeAudioState(sync);
  }, []);

  const muted = preferences.soundPreset === "none";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("notify.title")}
          className="relative"
        >
          {preferences.desktopNotify && permission === "granted" ? (
            <BellRing className="size-4" />
          ) : (
            <Bell className="size-4" />
          )}
          {muted && !preferences.desktopNotify ? (
            <span className="bg-muted-foreground/70 absolute right-1 bottom-1 size-1 rounded-full" />
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-medium">{t("notify.title")}</p>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("notify.sound")}</Label>
            <div className="flex items-center gap-1.5">
              {muted ? (
                <VolumeX className="text-muted-foreground size-3.5" />
              ) : (
                <Volume2 className="text-muted-foreground size-3.5" />
              )}
              <Switch
                aria-label={t("notify.sound")}
                checked={!muted}
                onCheckedChange={(checked) => {
                  const preset: SoundPresetId = checked
                    ? preferences.soundPreset === "none"
                      ? "chime"
                      : preferences.soundPreset
                    : "none";
                  unlockAudio();
                  onChange({ soundPreset: preset });
                  if (checked) playSound(preset, preferences.soundVolume);
                }}
              />
            </div>
          </div>

          <div className="space-y-1">
            {SOUND_PRESET_IDS.map((preset) => {
              const active = preferences.soundPreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    // 这次点击本身就是用户手势，顺手解锁音频
                    unlockAudio();
                    onChange({ soundPreset: preset });
                    playSound(preset, preferences.soundVolume);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      active ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <span className="flex-1 truncate">
                    {t(PRESET_LABEL_KEY[preset])}
                  </span>
                  {active && preset !== "none" ? (
                    <Play className="text-muted-foreground size-3" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t("notify.volume")}</Label>
              <span className="text-muted-foreground text-[11px] tabular-nums">
                {Math.round(preferences.soundVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              aria-label={t("notify.volume")}
              min={0}
              max={100}
              step={5}
              value={Math.round(preferences.soundVolume * 100)}
              disabled={muted}
              onChange={(event) =>
                onChange({ soundVolume: Number(event.target.value) / 100 })
              }
              onPointerUp={() =>
                playSound(preferences.soundPreset, preferences.soundVolume)
              }
              className="accent-primary h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 disabled:opacity-40 dark:bg-zinc-700"
            />
          </div>

          {audio === "suspended" && !muted ? (
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {t("notify.audioHint")}
            </p>
          ) : null}

          <div className="border-t pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t("notify.desktop")}</Label>
              <Switch
                aria-label={t("notify.desktop")}
                checked={preferences.desktopNotify}
                onCheckedChange={(checked) =>
                  onChange({ desktopNotify: checked })
                }
              />
            </div>

            {preferences.desktopNotify ? (
              permission === "granted" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 w-full text-[11px]"
                  onClick={() =>
                    showDesktopNotification({
                      title: t("notify.testTitle"),
                      body: t("notify.testBody"),
                      tag: "beesupport-test",
                    })
                  }
                >
                  {t("notify.test")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 w-full gap-1.5 text-[11px]"
                  onClick={async () => {
                    await requestNotificationPermission();
                    setPermission(notificationPermission());
                  }}
                >
                  <BellOff className="size-3" />
                  {permission === "denied"
                    ? t("notify.permissionDenied")
                    : t("workbench.enableNotify")}
                </Button>
              )
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
