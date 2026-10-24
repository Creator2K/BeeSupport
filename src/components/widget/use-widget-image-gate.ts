"use client";

import { useCallback, useEffect, useState } from "react";

import type { ImageGate } from "@/server/services/image-review";

export function useWidgetImageGate(token: string | null) {
  const [imageGate, setImageGate] = useState<ImageGate>({
    enabled: false,
    pending: null,
  });

  const refreshImageGate = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/widget/images", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.ok) setImageGate(await response.json());
    } catch {
      /* Keep the last known gate; the server still enforces it. */
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void refreshImageGate();
    const timer = setInterval(() => void refreshImageGate(), 15000);
    return () => clearInterval(timer);
  }, [token, refreshImageGate]);

  return { imageGate, setImageGate, refreshImageGate };
}
