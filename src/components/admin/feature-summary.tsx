import { FEATURE_LABELS, readFeatures } from "@/lib/entitlements";
export function FeatureSummary({ features }: { features: unknown }) {
  const values = readFeatures(features);
  return (
    <ul
      className="space-y-1 text-xs leading-5 text-muted-foreground"
      aria-label="套餐功能清单"
    >
      {Object.entries(FEATURE_LABELS).map(([key, label]) => (
        <li key={key}>
          {values[key as keyof typeof values] ? "包含" : "未包含"}：{label}
        </li>
      ))}
    </ul>
  );
}
