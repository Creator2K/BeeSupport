// Rebuilds the raster brand assets from src/app/icon.svg:
//
//   node scripts/brand-assets.mjs
//
// Writes src/app/favicon.ico, apple-icon.png and opengraph-image.png. The share
// image draws Chinese text with system fonts, so run it where a CJK font such as
// Microsoft YaHei, PingFang SC or Noto Sans CJK SC is installed.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
// sharp comes with Next as an optional dependency rather than a direct one.
const sharp = require(
  require.resolve("sharp", {
    paths: [dirname(require.resolve("next/package.json"))],
  }),
);

const INK = "#16120e";
const PAPER = "#f2f0ec";
const MUTED = "#a9a49c";
const HONEY = "#ecb33c";
const HONEY_LIGHT = "#f1c45e";
const FONT =
  "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans SC', sans-serif";
const HEX_TILE =
  "M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z";

const iconSvg = readFileSync("src/app/icon.svg", "utf8");
const markBody = iconSvg
  .replace(/^\s*<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");
const mark = (x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 32})">${markBody}</g>`;

const hexagon = (cx, cy, r) =>
  Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");

const renderMark = (size) =>
  sharp(Buffer.from(iconSvg), { density: (72 * size) / 32 })
    .resize(size, size)
    .png()
    .toBuffer();

/** Packs PNG frames into an .ico container; every current browser reads PNG entries. */
function ico(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const at = 6 + index * 16;
    header[at] = size;
    header[at + 1] = size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...frames.map((frame) => frame.png)]);
}

const shareImage = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="hex" width="28" height="49" patternUnits="userSpaceOnUse">
      <path d="${HEX_TILE}" fill="${PAPER}" fill-rule="evenodd"/>
    </pattern>
    <radialGradient id="fade" cx="1040" cy="40" r="760" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <mask id="fade-mask"><rect width="1200" height="630" fill="url(#fade)"/></mask>
    <radialGradient id="glow" cx="1000" cy="300" r="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${HONEY}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${HONEY}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${INK}"/>
  <rect width="1200" height="630" fill="url(#hex)" opacity="0.08" mask="url(#fade-mask)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g fill="none" stroke="${HONEY}" stroke-linejoin="round">
    <polygon points="${hexagon(1000, 300, 172)}" stroke-width="2" stroke-opacity="0.3"/>
    <polygon points="${hexagon(1000, 300, 218)}" stroke-width="1.5" stroke-opacity="0.14"/>
  </g>
  ${mark(860, 160, 280)}
  ${mark(80, 70, 52)}
  <g font-family="${FONT}">
    <text x="148" y="108" font-size="34" font-weight="600" fill="${PAPER}">BeeSupport</text>
    <text x="80" y="240" font-size="26" letter-spacing="3" fill="${HONEY_LIGHT}">为多站点业务而设计的客服平台</text>
    <text x="80" y="332" font-size="76" font-weight="700" fill="${PAPER}">把每一次咨询，</text>
    <text x="80" y="428" font-size="76" font-weight="700" fill="${PAPER}">接成<tspan fill="${HONEY}">好体验。</tspan></text>
    <text x="80" y="506" font-size="28" fill="${MUTED}">用一个工作台，连接访客、客服和你的每个站点。</text>
  </g>
</svg>`;

const favicon = ico(
  await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, png: await renderMark(size) })),
  ),
);
const appleIcon = await sharp({
  create: { width: 180, height: 180, channels: 4, background: INK },
})
  .composite([{ input: await renderMark(124), top: 28, left: 28 }])
  .png()
  .toBuffer();
const openGraph = await sharp(Buffer.from(shareImage))
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync("src/app/favicon.ico", favicon);
writeFileSync("src/app/apple-icon.png", appleIcon);
writeFileSync("src/app/opengraph-image.png", openGraph);
console.log(
  `favicon.ico ${favicon.length} B, apple-icon.png ${appleIcon.length} B, opengraph-image.png ${openGraph.length} B`,
);
