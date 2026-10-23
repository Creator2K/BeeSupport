import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
};

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return requestStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

export function requestPath(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}
