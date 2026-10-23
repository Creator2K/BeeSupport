/**
 * 统一的 className 合并工具。
 *
 * 新版 shadcn registry 的组件直接从 `cn` 包导入，这里再导出一份，
 * 让 `@/lib/utils` 与 `cn` 两种写法都能工作。
 */
export { cn } from "cn";
