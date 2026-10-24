import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
export const cannedPolicy = loadModule("src/lib/canned.ts", { zod: { z } });
export function cannedService(prisma) {
  const dependencies = {
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/canned": cannedPolicy,
  };
  const scope = loadModule(
    "src/server/services/canned-scope.ts",
    dependencies,
  );
  const agent = loadModule("src/server/services/canned-agent.ts", {
    ...dependencies,
    "./canned-scope": scope,
  });
  const management = loadModule(
    "src/server/services/canned-management.ts",
    {
      ...dependencies,
      "./canned-scope": scope,
    },
  );
  return { ...scope, ...agent, ...management };
}
