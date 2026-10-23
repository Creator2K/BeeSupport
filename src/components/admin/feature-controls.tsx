"use client";
import { FEATURE_LABELS, type TenantFeatures } from "@/lib/entitlements";
export function FeatureControls({
  value,
  onChange,
}: {
  value: TenantFeatures;
  onChange: (value: TenantFeatures) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm">套餐功能授权</legend>
      {Object.entries(FEATURE_LABELS).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value[key as keyof TenantFeatures]}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
