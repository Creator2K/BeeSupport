import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
import { accountValidation } from "./account-fixtures.mjs";
export const deliveryPolicy = loadModule("src/lib/deliveries.ts", {
  zod: { z },
});
export function deliveryService(prisma, options = {}) {
  return loadModule("src/server/services/deliveries.ts", {
    "@prisma/client": { Prisma },
    zod: { z },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/mail": {
      getSmtpConfig:
        options.smtp ?? (async () => ({ host: "isolated.invalid" })),
    },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/validation": accountValidation,
    "../../lib/deliveries": deliveryPolicy,
    "../../lib/operations": loadModule("src/lib/operations.ts"),
    "./account-mail": {
      prepareAccountMail:
        options.account ?? (async () => ({ ok: false, skipped: true })),
    },
    "./subscription-reminders": {
      prepareExpiryMail:
        options.expiry ?? (async () => ({ ok: false, skipped: true })),
    },
  });
}
