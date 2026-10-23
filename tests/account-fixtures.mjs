import { z } from "zod";
import bcrypt from "bcryptjs";
import { loadModule, HttpError } from "./load-module.mjs";

export const accountLinks = loadModule("src/lib/account-links.ts");
export const accountValidation = loadModule("src/lib/validation.ts", {
  zod: { z },
});
export const accountSecret = "isolated-account-mail-test-secret";

export function accountService(prisma, options = {}) {
  return loadModule("src/server/services/account-access.ts", {
    zod: { z },
    "../../lib/auth": {
      HttpError,
      hashPassword: (password) => bcrypt.hash(password, 10),
    },
    "../../lib/db": { prisma },
    "../../lib/env": { env: { AUTH_SECRET: accountSecret } },
    "../../lib/mail": {
      getSmtpConfig:
        options.smtp ?? (async () => ({ host: "isolated.invalid" })),
    },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/realtime/emit": {
      revokeAgentConnections: options.revoke ?? (() => {}),
    },
    "../../lib/validation": accountValidation,
    "../../lib/account-links": accountLinks,
    "./tenants": {
      assertTenantQuota:
        options.quota ??
        (() => {
          throw Error("Unexpected quota operation");
        }),
    },
  });
}

export function accountMail(prisma, sendMail) {
  return loadModule("src/server/services/account-mail.ts", {
    zod: { z },
    "../../lib/db": { prisma },
    "../../lib/env": {
      env: {
        AUTH_SECRET: accountSecret,
        APP_URL: "http://account.test.local:3000",
      },
    },
    "../../lib/mail": { sendMail },
    "../../lib/account-links": accountLinks,
  });
}
