"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  mergeWidgetSettings,
  type EffectiveWidgetSettings,
  type WidgetSettings,
} from "@/lib/branding";

import { BrandingPreview } from "./branding-preview";
import { BrandingSettingFields } from "./branding-setting-fields";
import { BrandingStylePicker } from "./branding-style-picker";

export function BrandingEditor({
  value,
  inherited,
  onChange,
  canCustomizeFooter = true,
}: {
  value: WidgetSettings;
  inherited: EffectiveWidgetSettings;
  onChange: (settings: WidgetSettings) => void;
  canCustomizeFooter?: boolean;
}) {
  const [mobile, setMobile] = useState(false);
  const settings = {
    ...mergeWidgetSettings(inherited, value),
    ...(canCustomizeFooter ? {} : { footerText: inherited.footerText }),
  };

  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-muted-foreground">
        勾选后覆盖上一级配置；取消勾选后随上一级更新。配置按平台、商家、站点依次生效。保存后，新打开的聊天窗口使用最新配置。
      </p>
      <BrandingStylePicker
        value={value}
        settings={settings}
        onChange={onChange}
      />
      <BrandingSettingFields
        value={value}
        settings={settings}
        canCustomizeFooter={canCustomizeFooter}
        onChange={onChange}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({})}
        >
          全部恢复继承
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mobile ? "outline" : "secondary"}
            onClick={() => setMobile(false)}
          >
            电脑预览
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mobile ? "secondary" : "outline"}
            onClick={() => setMobile(true)}
          >
            手机预览
          </Button>
        </div>
      </div>
      <BrandingPreview settings={settings} mobile={mobile} />
    </div>
  );
}
