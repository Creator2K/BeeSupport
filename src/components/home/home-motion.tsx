"use client";

import { useEffect } from "react";

/**
 * 首页的交互动效，样式都在 home.module.css 的「动效」一节：
 * - [data-reveal]：首屏以下的元素先标为 data-revealed="false"（透明），滚进视口改成 "true" 播放入场。
 *   加载时已经在视口里的不动，免得服务端渲染的内容闪一下。
 * - [data-pointer-field]：把指针位置写成 --px / --py（-1 到 1），首屏用它做视差。
 * - [data-spotlight]：把指针在卡片内的坐标写成 --mx / --my，用于悬停光斑。
 * - [data-scroll-progress]：把页面滚动进度写成 --progress（0 到 1）。
 * - 页内锚点（导航里的 #features 等）平滑滚动到目标区块。
 * 系统开启「减少动态效果」时只保留滚动进度。
 */
export function HomeMotion() {
  useEffect(() => {
    const cleanups = [trackScrollProgress()];
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cleanups.push(observeReveals(), smoothAnchors());
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        cleanups.push(followPointer(), trackSpotlight());
      }
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
  return null;
}

function observeReveals() {
  const fold = window.innerHeight * 0.92;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.revealed = "true";
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-reveal]",
  )) {
    if (element.dataset.revealed) continue;
    if (element.getBoundingClientRect().top < fold) continue;
    element.dataset.revealed = "false";
    observer.observe(element);
  }
  return () => observer.disconnect();
}

// 只在点击页内锚点的这一下打开平滑滚动，跳转仍交给浏览器（焦点起点和地址栏的 # 照常更新）；
// 常驻的 scroll-behavior: smooth 会让路由切换后回到顶部也变成动画
function smoothAnchors() {
  const root = document.documentElement;
  let timer = 0;
  const restore = () => {
    window.clearTimeout(timer);
    window.removeEventListener("scrollend", restore);
    root.style.removeProperty("scroll-behavior");
  };
  const click = (event: MouseEvent) => {
    const link = event.target instanceof Element
      ? event.target.closest('a[href^="#"]') : null;
    if (!link || event.defaultPrevented) return;
    root.style.scrollBehavior = "smooth";
    window.clearTimeout(timer);
    window.addEventListener("scrollend", restore);
    timer = window.setTimeout(restore, 1500);
  };
  document.addEventListener("click", click);
  return () => {
    restore();
    document.removeEventListener("click", click);
  };
}

function trackScrollProgress() {
  const bar = document.querySelector<HTMLElement>("[data-scroll-progress]");
  if (!bar) return () => {};
  let frame = 0;
  const update = () => {
    frame = 0;
    const range =
      document.documentElement.scrollHeight - window.innerHeight || 1;
    const progress = Math.min(1, Math.max(0, window.scrollY / range));
    bar.style.setProperty("--progress", progress.toFixed(4));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}

function followPointer() {
  const field = document.querySelector<HTMLElement>("[data-pointer-field]");
  if (!field) return () => {};
  let frame = 0;
  let point: { x: number; y: number } | null = null;
  const apply = () => {
    frame = 0;
    if (!point) return;
    const rect = field.getBoundingClientRect();
    const x = ((point.x - rect.left) / rect.width) * 2 - 1;
    const y = ((point.y - rect.top) / rect.height) * 2 - 1;
    field.style.setProperty("--px", clamp(x).toFixed(3));
    field.style.setProperty("--py", clamp(y).toFixed(3));
  };
  const move = (event: PointerEvent) => {
    point = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(apply);
  };
  const leave = () => {
    point = null;
    field.style.setProperty("--px", "0");
    field.style.setProperty("--py", "0");
  };
  // 浮卡的入场和视差都写 transform，过渡会压过动画；等入场播完再跟随指针，否则会跳一下
  const start = window.setTimeout(() => {
    field.addEventListener("pointermove", move);
    field.addEventListener("pointerleave", leave);
  }, 2200);
  return () => {
    window.clearTimeout(start);
    cancelAnimationFrame(frame);
    field.removeEventListener("pointermove", move);
    field.removeEventListener("pointerleave", leave);
  };
}

function trackSpotlight() {
  const move = (event: PointerEvent) => {
    const card =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-spotlight]")
        : null;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    card.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };
  document.addEventListener("pointermove", move, { passive: true });
  return () => document.removeEventListener("pointermove", move);
}

function clamp(value: number) {
  return Math.min(1, Math.max(-1, value));
}
