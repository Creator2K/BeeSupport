import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { env } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { ACCOUNT_TOKEN_PATTERN } from "@/lib/account-links";
import {
  requestAccountMail,
  requestMailMessage,
  consumeAccountToken,
  acceptInvitation,
  inspectAccountToken,
} from "@/server/services/account-access";

const token = z.string().regex(ACCOUNT_TOKEN_PATTERN, "链接无效，请重新申请");
const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("request-reset"), email: emailSchema }),
  z.object({
    operation: z.literal("request-verification"),
    email: emailSchema,
  }),
  z.object({
    operation: z.literal("inspect"),
    token,
    purpose: z.enum(["RESET", "VERIFY", "INVITE"]),
  }),
  z.object({ operation: z.literal("reset"), token, password: passwordSchema }),
  z.object({ operation: z.literal("verify"), token }),
  z.object({
    operation: z.literal("accept"),
    token,
    name: z.string().trim().min(1).max(40),
    password: passwordSchema,
  }),
]);

export async function POST(request: Request) {
  try {
    const ip = clientIp(request.headers);
    const limit = await rateLimit(`account-access:ip:${ip}`, 60, 600);
    if (!limit.ok)
      return NextResponse.json(
        { error: "操作过于频繁，请稍后再试" },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
            ),
          },
        },
      );
    // No cookies are used for authorization here. Credentials come only from an emailed bearer token.
    const origin = request.headers.get("origin");
    if (
      origin &&
      origin !== new URL(env.APP_URL).origin &&
      origin !== new URL(request.url).origin
    )
      throw new HttpError(403, "请求来源不受信任");
    const input = schema.parse(await readJson(request));
    if (
      input.operation === "request-reset" ||
      input.operation === "request-verification"
    ) {
      await requestAccountMail(
        input.operation === "request-reset" ? "RESET" : "VERIFY",
        input.email,
        ip,
      );
      return NextResponse.json(
        { ok: true, message: requestMailMessage },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (input.operation === "inspect")
      return NextResponse.json(
        {
          ok: true,
          details: await inspectAccountToken(input.token, input.purpose),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (input.operation === "accept")
      await acceptInvitation(input.token, input.name, input.password);
    else
      await consumeAccountToken(
        input.token,
        input.operation === "reset" ? "RESET" : "VERIFY",
        input.operation === "reset" ? input.password : undefined,
      );
    return NextResponse.json(
      {
        ok: true,
        message:
          input.operation === "accept"
            ? "已加入团队，请使用邮箱和密码登录"
            : input.operation === "reset"
              ? "密码已重置，请重新登录"
              : "邮箱已验证，平台审核开通后即可登录",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
