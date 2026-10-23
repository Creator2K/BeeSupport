import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 自定义 server 的运行时基线。
 *
 * 必须作为 server.ts 的**第一个** import：Next 的 app-render 在模块求值时
 * 就会读取 `globalThis.AsyncLocalStorage`（见 next/dist/server/app-render/async-local-storage.js），
 * 读不到就退化成 FakeAsyncLocalStorage，渲染时直接抛
 * "Invariant: AsyncLocalStorage accessed in runtime where it is not available"。
 *
 * 正常用 `next dev` / `next start` 时这一步由 Next 自己的 bin 入口完成，
 * 走自定义 server 就得我们自己补上。
 */
const scope = globalThis as typeof globalThis & {
  AsyncLocalStorage?: typeof AsyncLocalStorage;
};

if (typeof scope.AsyncLocalStorage !== "function") {
  scope.AsyncLocalStorage = AsyncLocalStorage;
}

export {};
