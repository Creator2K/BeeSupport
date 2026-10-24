import { z } from "zod";
import bcrypt from "bcryptjs";
import { loadModule, HttpError } from "./load-module.mjs";

export const accountLinks = loadModule("src/lib/account-links.ts");
export const accountValidation = loadModule("src/lib/validation.ts", {
  zod: { z },
});
export const accountSecret = "isolated-account-mail-test-secret";

export function accountService(prisma, options = {}) {
  const dependencies = {
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
  };
  const credentials = loadModule(
    "src/server/services/account-credentials.ts",
    dependencies,
  );
  const tokens = loadModule("src/server/services/account-tokens.ts", dependencies);
  const invitations = loadModule(
    "src/server/services/account-invitations.ts",
    {
      ...dependencies,
      "./account-credentials": credentials,
      "./account-tokens": tokens,
    },
  );
  return { ...credentials, ...tokens, ...invitations };
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
