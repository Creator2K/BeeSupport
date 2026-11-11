"use client";

import { useSyncExternalStore } from "react";

import { parseTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

// 主题只放在 <html class> 和 localStorage 里，不走根部 React context：水合期间根部 context 一变，
// 还没显示出来的流式内容会被整块丢弃、改在客户端重新渲染。
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

function notify() {
  for (const listener of listeners) listener();
}

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // 切换的这一帧关掉所有过渡，否则每个元素会各自慢慢变色
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(freeze);
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document.body.getBoundingClientRect();
  setTimeout(() => freeze.remove(), 1);
}

function watch() {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) applyTheme(parseTheme(event.newValue));
  };
  window.addEventListener("storage", onStorage);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStorage);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  stopWatching ??= watch();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopWatching?.();
    stopWatching = null;
  };
}

/** 当前主题；服务端渲染和水合期间返回 null。 */
export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, readTheme, () => null);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 无痕模式等写不进 localStorage 时，只在当前页面生效
  }
  applyTheme(theme);
  notify();
}
