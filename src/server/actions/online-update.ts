"use server";

import { HttpError, requirePlatformAdmin } from "@/lib/auth";
import { releaseTag } from "@/lib/online-update";
import { latestPublishedRelease, requestUpdate } from "@/server/online-update";
import { readImageRelease } from "@/server/release-deployment";
import { toActionResult } from "./result";

export async function requestOnlineUpdate(input: string) {
  try {
    await requirePlatformAdmin();
    const version = releaseTag.parse(input);
    const image = await readImageRelease();
    if (!image) throw new HttpError(409, "请先切换到官方发布镜像。");
    const releases = await latestPublishedRelease(image.version, true);
    if (!releases.available) throw new HttpError(503, "暂时无法检查 GitHub 版本，请稍后重试。");
    if (releases.update?.version !== version)
      throw new HttpError(409, "发布版本已变化，请刷新后重新检查。");
    await requestUpdate(version);
    return { ok: true as const, message: "更新已排队，请留在当前页面查看进度。" };
  } catch (error) {
    return toActionResult(error);
  }
}
