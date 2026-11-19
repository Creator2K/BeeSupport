import type { WidgetSettings } from "@/lib/branding";

export type BrandingFieldType =
  | "text"
  | "url"
  | "color"
  | "position"
  | "number"
  | "boolean";

export const brandingFields = [
  ["title", "聊天窗口标题", "text"],
  ["logoUrl", "Logo 图片地址", "url"],
  ["footerText", "底部品牌文字（可留空）", "text"],
  ["primaryColor", "主题色", "color"],
  ["position", "悬浮按钮位置", "position"],
  ["launcherDraggable", "允许拖动悬浮按钮", "boolean"],
  ["launcherLabel", "悬浮按钮文案（最多 20 字）", "text"],
  ["maxUploadMB", "单个附件大小上限 MB", "number"],
  ["imagesEnabled", "允许访客发送图片", "boolean"],
  ["filesEnabled", "允许访客发送文件", "boolean"],
  ["emojiEnabled", "显示表情选择器", "boolean"],
  ["ratingEnabled", "允许服务评价", "boolean"],
] as const satisfies readonly (readonly [
  keyof WidgetSettings,
  string,
  BrandingFieldType,
])[];
