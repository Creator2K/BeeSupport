import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError, requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/rate-limit";
import { exportInputSchema } from "@/lib/reporting";
import { generateDataExport } from "@/server/services/reporting";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const origin = request.headers.get("origin");
    if (
      !origin ||
      (origin !== new URL(env.APP_URL).origin &&
        origin !== new URL(request.url).origin)
    )
      throw new HttpError(403, "请求来源不受信任");
    const input = exportInputSchema.parse(await readJson(request));
    const report = await generateDataExport(
      actor,
      input,
      clientIp(request.headers),
    );
    return new Response(report.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Rows": String(report.rowCount),
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
