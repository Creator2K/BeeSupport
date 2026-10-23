"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import {
  bindAudioUnlock,
  playSound,
  showDesktopNotification,
  unlockAudio,
} from "@/lib/notify";
import {
  parsePreferences,
  type AgentPreferences,
  type SoundPresetId,
} from "@/lib/preferences";
import { savePreferencesAction } from "@/server/actions/preferences";

export type WorkbenchAlert = {
  title: string;
  body: string;
  tag: string;
  onOpen?: () => void;
};

export function useWorkbenchPreferences(
  initialPreferences: AgentPreferences,
) {
  const t = useT();
  const [prefs, setPrefs] = useState<AgentPreferences>(() =>
    parsePreferences(initialPreferences),
  );
  const prefsRef = useRef<AgentPreferences>(prefs);
  prefsRef.current = prefs;
  const preferenceQueue = useRef<Promise<void>>(Promise.resolve());
  const preferenceVersion = useRef(0);
  const confirmedPreferences = useRef(parsePreferences(initialPreferences));

  const updatePreferences = useCallback(
    (patch: Partial<AgentPreferences>) => {
      const version = ++preferenceVersion.current;
      setPrefs((previous) => parsePreferences({ ...previous, ...patch }));
      preferenceQueue.current = preferenceQueue.current.then(async () => {
        try {
          const result = await savePreferencesAction(patch);
          if (!result.ok) throw new Error(result.error);
          confirmedPreferences.current = result.preferences;
          if (version === preferenceVersion.current) {
            setPrefs(result.preferences);
          }
        } catch {
          toast.error(t("common.operationFailed"));
          if (version === preferenceVersion.current) {
            setPrefs(confirmedPreferences.current);
          }
        }
      });
    },
    [t],
  );

  useEffect(() => bindAudioUnlock(), []);

  useEffect(() => {
    const legacy = window.localStorage.getItem("beesupport:sound");
    if (legacy) window.localStorage.removeItem("beesupport:sound");
    if (legacy === "off") {
      updatePreferences({ soundPreset: "none" });
    }
  }, [updatePreferences]);

  const alertUser = useCallback((payload: WorkbenchAlert) => {
    const current = prefsRef.current;
    playSound(current.soundPreset, current.soundVolume);
    if (current.desktopNotify) {
      showDesktopNotification({
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        onClick: payload.onOpen,
      });
    }
  }, []);

  const toggleMute = useCallback(() => {
    const next: SoundPresetId =
      prefs.soundPreset === "none" ? "chime" : "none";
    unlockAudio();
    updatePreferences({ soundPreset: next });
    if (next !== "none") playSound(next, prefs.soundVolume);
  }, [prefs.soundPreset, prefs.soundVolume, updatePreferences]);

  return { prefs, updatePreferences, alertUser, toggleMute };
}