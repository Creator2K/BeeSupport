/**
 * 站点主题色相关的小工具。
 * 站点主色是用户随便填的，这里统一做归一化、明暗派生与对比度判断，
 * 避免出现「浅色底 + 白字」这类不可读的组合。
 */

export function normalizeHex(
  value: string | null | undefined,
  fallback = "#18181b",
): string {
  const hex = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return (
      "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    ).toLowerCase();
  }
  return fallback;
}

/** percent > 0 提亮，< 0 压暗 */
export function shade(value: string, percent: number): string {
  const color = normalizeHex(value);
  const target = percent < 0 ? 0 : 255;
  const ratio = Math.abs(percent) / 100;

  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round((target - channel) * ratio) + channel;
  });

  return (
    "#" +
    channels
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function hexToRgba(value: string, alpha: number): string {
  const color = normalizeHex(value);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 站点图标用的斜向渐变，与访客端气泡保持同一套观感 */
export function accentGradient(value: string): string {
  const base = normalizeHex(value);
  return `linear-gradient(160deg, ${shade(base, 16)} 0%, ${base} 52%, ${shade(base, -18)} 100%)`;
}

/** 相对亮度，0 是纯黑，1 是纯白 */
export function relativeLuminance(value: string): number {
  const color = normalizeHex(value);
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;

  const toLinear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** 彩色底上应该用白字还是深色字 */
export function readableTextColor(value: string): "#ffffff" | "#18181b" {
  return relativeLuminance(value) > 0.6 ? "#18181b" : "#ffffff";
}
