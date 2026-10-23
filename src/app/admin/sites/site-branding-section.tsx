"use client";

import { BrandingEditor } from "@/components/admin/branding-editor";
import type {
  EffectiveWidgetSettings,
  WidgetSettings,
} from "@/lib/branding";

import type { SiteRecord } from "./sites-client";
import type { UpdateSiteForm } from "./site-form-values";

export function SiteBrandingSection({
  form,
  site,
  defaultSettings,
  canCustomizeFooter,
  update,
}: {
  form: { widgetSettings: WidgetSettings };
  site: SiteRecord | null;
  defaultSettings: EffectiveWidgetSettings;
  canCustomizeFooter: boolean;
  update: UpdateSiteForm;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">访客窗口品牌与功能</h3>
      <BrandingEditor
        canCustomizeFooter={site?.canCustomizeFooter ?? canCustomizeFooter}
        value={form.widgetSettings}
        inherited={site?.inheritedSettings ?? defaultSettings}
        onChange={(value) => update("widgetSettings", value)}
      />
    </section>
  );
}
