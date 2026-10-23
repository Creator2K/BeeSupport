"use client";

/**
 * 提醒相关的小工具：浏览器桌面通知 + 提示音。
 *
 * 提示音用 WebAudio 现场合成（不需要额外音频文件），提供多种音色供客服挑选。
 * 注意浏览器的自动播放策略：AudioContext 在首次用户手势之前是 suspended 的，
 * 直接调用会静音。因此这里提供 unlockAudio()，由页面在第一次点击/按键时接管解锁。
 */

import {
  DEFAULT_SOUND_PRESET,
  DEFAULT_SOUND_VOLUME,
  type SoundPresetId,
} from "./preferences";

/* ---------------- 桌面通知 ---------------- */

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function showDesktopNotification(options: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
      silent: true,
    });
    notification.onclick = () => {
      window.focus();
      options.onClick?.();
      notification.close();
    };
  } catch {
    // 部分浏览器在非安全上下文下会抛错，忽略即可
  }
}

/* ---------------- 提示音 ---------------- */

type Tone = {
  /** 基频（Hz） */
  freq: number;
  /** 相对本次播放起点的偏移（秒） */
  start: number;
  /** 时长（秒） */
  duration: number;
  type?: OscillatorType;
  /** 相对音量，0-1 */
  gain?: number;
  /** 有值时做滑音（水滴感） */
  sweepTo?: number;
};

/** 五种音色 + 静音，刻意做出明显区别，方便客服挑一个顺耳的 */
const PRESET_TONES: Record<SoundPresetId, Tone[]> = {
  // 清脆：一声铃 + 高八度泛音
  chime: [
    { freq: 880, start: 0, duration: 0.5, type: "sine", gain: 0.95 },
    { freq: 1318.51, start: 0.07, duration: 0.42, type: "sine", gain: 0.45 },
  ],
  // 玻璃：三枚高频短音，清亮
  glass: [
    { freq: 1568, start: 0, duration: 0.34, type: "sine", gain: 0.7 },
    { freq: 1046.5, start: 0.09, duration: 0.38, type: "sine", gain: 0.6 },
    { freq: 2093, start: 0.15, duration: 0.28, type: "sine", gain: 0.22 },
  ],
  // 木琴：中频三角波，温和不刺耳
  marimba: [
    { freq: 523.25, start: 0, duration: 0.3, type: "triangle", gain: 0.9 },
    { freq: 1046.5, start: 0.04, duration: 0.34, type: "sine", gain: 0.42 },
    { freq: 783.99, start: 0.17, duration: 0.4, type: "triangle", gain: 0.5 },
  ],
  // 水滴：一声下滑音
  drop: [
    { freq: 1280, start: 0, duration: 0.3, type: "sine", gain: 0.85, sweepTo: 340 },
  ],
  // 三连音：do-sol-do 上行
  triple: [
    { freq: 659.25, start: 0, duration: 0.14, type: "sine", gain: 0.8 },
    { freq: 880, start: 0.13, duration: 0.14, type: "sine", gain: 0.8 },
    { freq: 1174.66, start: 0.26, duration: 0.24, type: "sine", gain: 0.75 },
  ],
  none: [],
};

let audioContext: AudioContext | null = null;
let unlockBound = false;
const listeners = new Set<(state: AudioState) => void>();

export type AudioState = "unsupported" | "suspended" | "running";

function audioCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ??
    null
  );
}

function ensureContext(): AudioContext | null {
  const Ctor = audioCtor();
  if (!Ctor) return null;
  if (!audioContext) {
    try {
      audioContext = new Ctor();
      audioContext.onstatechange = () => emitState();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function emitState(): void {
  const state = audioState();
  listeners.forEach((listener) => listener(state));
}

export function audioState(): AudioState {
  if (!audioCtor()) return "unsupported";
  if (!audioContext) return "suspended";
  return audioContext.state === "running" ? "running" : "suspended";
}

export function subscribeAudioState(listener: (state: AudioState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 在用户手势里调用（点击、按键），把 AudioContext 从 suspended 拉到 running。
 * 返回当前是否已经可以出声。
 */
export function unlockAudio(): boolean {
  const context = ensureContext();
  if (!context) return false;
  if (context.state === "suspended") {
    void context.resume().then(emitState).catch(() => undefined);
  }
  return context.state === "running";
}

/**
 * 首次用户手势自动解锁：挂一次性的 pointerdown / keydown / touchstart。
 * 页面卸载时调用返回的函数即可摘掉监听。
 */
export function bindAudioUnlock(): () => void {
  if (typeof window === "undefined" || unlockBound) return () => undefined;
  unlockBound = true;

  const handler = () => {
    unlockAudio();
    if (audioState() === "running") {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("touchstart", handler);
    }
  };

  window.addEventListener("pointerdown", handler);
  window.addEventListener("keydown", handler);
  window.addEventListener("touchstart", handler);

  return () => {
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
    window.removeEventListener("touchstart", handler);
    unlockBound = false;
  };
}

/** 播放指定音色；静音预设直接跳过 */
export function playSound(
  preset: SoundPresetId = DEFAULT_SOUND_PRESET,
  volume: number = DEFAULT_SOUND_VOLUME,
): void {
  if (preset === "none") return;

  const context = ensureContext();
  if (!context) return;
  // 被自动播放策略挡住时顺手 resume 一次，用户下次点击后就正常了
  if (context.state === "suspended") void context.resume().then(emitState).catch(() => undefined);

  const tones = PRESET_TONES[preset] ?? PRESET_TONES[DEFAULT_SOUND_PRESET];
  const level = Math.min(1, Math.max(0, volume));
  if (level === 0) return;

  const now = context.currentTime;
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);

  for (const tone of tones) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const peak = 0.22 * level * (tone.gain ?? 1);
    const startAt = now + tone.start;
    const endAt = startAt + tone.duration;

    oscillator.type = tone.type ?? "sine";
    oscillator.frequency.setValueAtTime(tone.freq, startAt);
    if (tone.sweepTo) {
      oscillator.frequency.exponentialRampToValueAtTime(tone.sweepTo, endAt);
    }

    // 12ms 起音 + 指数衰减，听起来像敲击而不是「咔」
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
  }

  // 播完把临时节点断开，避免长期累积
  if (tones.length > 0) {
    const total =
      Math.max(...tones.map((tone) => tone.start + tone.duration)) + 0.1;
    window.setTimeout(() => master.disconnect(), total * 1000);
  }
}
