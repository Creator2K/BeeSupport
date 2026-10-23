"use client";

import { useEffect, useRef } from "react";

type EmbeddedWindow = Window & { BeeSupport?: { destroy: () => void } };

/** Mount the real embed after hydration and dispose it on client-side navigation. */
export function PreviewWidget({ src }: { src: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    container.current?.appendChild(script);
    return () => {
      (window as EmbeddedWindow).BeeSupport?.destroy();
      script.remove();
    };
  }, [src]);
  return <div ref={container} data-preview-embed="true" />;
}
