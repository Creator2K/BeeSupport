import type { HomeContent } from "@/lib/homepage-content";

export type UpdateHomeContent = (
  key: keyof HomeContent,
  value: unknown,
) => void;

export type HomePlanOption = {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
};
