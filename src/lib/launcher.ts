export const LAUNCHER_STYLES = [
  "bubble",
  "rounded",
  "pill",
  "outline",
  "soft",
  "avatar",
] as const;
export type LauncherStyle = (typeof LAUNCHER_STYLES)[number];
export const launcherStyleOptions: {
  value: LauncherStyle;
  label: string;
  description: string;
}[] = [
  {
    value: "bubble",
    label: "经典圆形",
    description: "简洁气泡，适合大多数页面",
  },
  {
    value: "rounded",
    label: "圆角方形",
    description: "轮廓利落，适合产品与工具站",
  },
  {
    value: "pill",
    label: "文字胶囊",
    description: "图标搭配文案，让咨询入口更清楚",
  },
  {
    value: "outline",
    label: "轻盈描边",
    description: "白底描边，适合内容与品牌站",
  },
  {
    value: "soft",
    label: "柔和底色",
    description: "浅色底与品牌文字，视觉更轻",
  },
  {
    value: "avatar",
    label: "品牌头像",
    description: "使用品牌 Logo，无 Logo 时显示耳机图标",
  },
];

export function launcherShowsLabel(style: string) {
  return ["pill", "outline", "soft"].includes(style);
}

function shade(hex: string, percent: number) {
  return (
    "#" +
    [1, 3, 5]
      .map((offset) => {
        const channel = parseInt(hex.slice(offset, offset + 2), 16);
        const value = Math.round(
          channel +
            (((percent < 0 ? 0 : 255) - channel) * Math.abs(percent)) / 100,
        );
        return value.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

/** Choose legible text for arbitrary merchant theme colors, including white/yellow. */
export function launcherForeground(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function launcherAppearance(
  style: string,
  color: string,
  forceLabel = false,
) {
  const text = launcherShowsLabel(style) || forceLabel;
  const light = style === "outline" || style === "soft";
  return {
    backgroundColor:
      style === "outline"
        ? "#ffffff"
        : style === "soft"
          ? shade(color, 92)
          : color,
    color: light ? shade(color, -65) : launcherForeground(color),
    border:
      style === "outline"
        ? `2px solid ${color}`
        : style === "avatar"
          ? "3px solid #ffffff"
          : "0px solid transparent",
    borderRadius: style === "rounded" ? "18px" : "9999px",
    boxShadow:
      "0 8px 24px -6px rgba(15,23,42,.24), 0 2px 8px rgba(15,23,42,.08)",
    height: "58px",
    width: text ? "auto" : "58px",
    maxWidth: "100%",
    padding: text ? "0 20px" : "0",
  };
}
