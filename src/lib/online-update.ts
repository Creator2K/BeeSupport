import { z } from "zod";

export const releaseTag = z.string().regex(/^v(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/);

export function isNewerRelease(candidate: string, current: string) {
  const currentParts = current.slice(1).split(".").map(Number);
  for (const [index, part] of candidate.slice(1).split(".").entries()) {
    const difference = Number(part) - currentParts[index];
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export const updateErrors = {
  superseded: "服务器已启用更新的版本，原任务已结束。",
  download: "镜像下载失败，当前应用仍在运行。",
  startup: "新版启动失败，已恢复上一版应用。",
  pin: "部署配置保存失败，已恢复上一版应用。",
  rollback: "应用启动失败，请在服务器检查更新程序日志。",
} as const;

export type UpdateError = keyof typeof updateErrors;
