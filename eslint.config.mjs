import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

/**
 * eslint-config-next 15.x 仍是 eslintrc 风格，通过 FlatCompat 接入 ESLint 9 的扁平配置。
 * （Next 16 生成的 defineConfig 写法在 15.x 上不可用）
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      ".next-*",
      ".next-*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // 访客端嵌入脚本，刻意使用 ES5 写法以保证兼容性
      "public/widget.js",
      "scripts/**",
      // Test harnesses intentionally exercise CommonJS and hook-like names.
      "tests/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
