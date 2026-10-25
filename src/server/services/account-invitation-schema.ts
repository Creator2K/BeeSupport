import { z } from "zod";

import { HttpError, type SessionUser } from "../../lib/auth";
import { emailSchema } from "../../lib/validation";

export const invitationSchema = z.object({
  email: emailSchema,
  role: z.enum(["AGENT", "MERCHANT_ADMIN"]).default("AGENT"),
  siteIds: z.array(z.string().min(1)).max(200).default([]),
});

export function assertInviteAdmin(actor: SessionUser) {
  if (actor.role !== "ADMIN" && actor.role !== "MERCHANT_ADMIN")
    throw new HttpError(403, "需要管理员权限");
}

export type InvitationInput = z.input<typeof invitationSchema>;
