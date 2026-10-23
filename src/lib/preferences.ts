/**
 * 客服个人偏好（声音、桌面通知）。
 * 服务端读写 User.preferences，客户端也照同一份结构解析，
 * 所以这里只放纯类型与纯函数，不引入任何 server-only 依赖。
 */

export const SOUND_PRESET_IDS = [
  "chime",
  "glass",
  "marimba",
  "drop",
  "triple",
  "none",
] as const;

export type SoundPresetId = (typeof SOUND_PRESET_IDS)[number];

export const DEFAULT_SOUND_PRESET: SoundPresetId = "chime";
export const DEFAULT_SOUND_VOLUME = 0.8;

export type AgentPreferences = {
  soundPreset: SoundPresetId;
  soundVolume: number;
  desktopNotify: boolean;
  /** 工作台里偏好的 AI 模型（空串表示跟随后台默认） */
  preferredModel: string;
};

export const DEFAULT_PREFERENCES: AgentPreferences = {
  soundPreset: DEFAULT_SOUND_PRESET,
  soundVolume: DEFAULT_SOUND_VOLUME,
  desktopNotify: true,
  preferredModel: "",
};

function isSoundPreset(value: unknown): value is SoundPresetId {
  return (
    typeof value === "string" &&
    (SOUND_PRESET_IDS as readonly string[]).includes(value)
  );
}

function clampVolume(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, Math.round(numeric * 100) / 100));
}

/** 把库里的 Json（可能是任何脏数据）解析成合法偏好 */
export function parsePreferences(raw: unknown): AgentPreferences {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    soundPreset: isSoundPreset(source.soundPreset)
      ? source.soundPreset
      : DEFAULT_PREFERENCES.soundPreset,
    soundVolume:
      source.soundVolume === undefined
        ? DEFAULT_PREFERENCES.soundVolume
        : clampVolume(source.soundVolume),
    desktopNotify:
      typeof source.desktopNotify === "boolean"
        ? source.desktopNotify
        : DEFAULT_PREFERENCES.desktopNotify,
    preferredModel:
      typeof source.preferredModel === "string"
        ? source.preferredModel.slice(0, 200)
        : DEFAULT_PREFERENCES.preferredModel,
  };
}

/** 局部更新，返回完整偏好，便于整体回写 */
export function mergePreferences(
  raw: unknown,
  patch: Partial<AgentPreferences>,
): AgentPreferences {
  const current = parsePreferences(raw);
  const next: AgentPreferences = { ...current };

  if (patch.soundPreset !== undefined && isSoundPreset(patch.soundPreset)) {
    next.soundPreset = patch.soundPreset;
  }
  if (patch.soundVolume !== undefined) {
    next.soundVolume = clampVolume(patch.soundVolume);
  }
  if (patch.desktopNotify !== undefined) {
    next.desktopNotify = Boolean(patch.desktopNotify);
  }
  if (patch.preferredModel !== undefined) {
    next.preferredModel = String(patch.preferredModel).slice(0, 200);
  }

  return next;
}
