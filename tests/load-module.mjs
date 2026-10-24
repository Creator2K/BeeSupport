import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const require = createRequire(import.meta.url);
const ts = require("typescript");

/** Execute the real service code with explicit IO doubles; no database or network access. */
export function loadModule(filename, dependencies = {}, compilerOptions = {}) {
  const file = resolve(filename);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      ...compilerOptions,
    },
  }).outputText;
  const module = { exports: {} };
  const dependency = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Unexpected dependency ${name} in ${filename}`);
  };
  new Function("require", "module", "exports", output)(
    dependency,
    module,
    module.exports,
  );
  return module.exports;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const auth = {
  HttpError,
  canAccessSite: (user, siteId) =>
    user.siteIds === null || user.siteIds.includes(siteId),
};

export const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

export const entitlements = loadModule("src/lib/entitlements.ts", {
  zod: { z },
});
const tenantPolicy = loadModule("src/server/services/tenants.ts", {
  "../../lib/entitlements": entitlements,
  "../../lib/auth": auth,
  "../../lib/db": { prisma: {} },
  "../../lib/branding": {},
  "../../lib/env": { env: { UPLOAD_MAX_BYTES: 10485760 } },
});
export const tenants = {
  tenantCanServe: tenantPolicy.tenantCanServe,
  getWidgetSettings: async () => ({ imagesEnabled: true, filesEnabled: true }),
  assertTenantQuota: async () => {},
  assertSiteServing: async () => {},
};

/** Assemble the split AI library with explicit test doubles. */
export function loadAiModule(prisma = {}) {
  const db = { prisma };
  const config = loadModule("src/lib/ai-config.ts", { "./db": db });
  const provider = loadModule("src/lib/ai-provider.ts", {
    "./ai-config": config,
  });
  const text = loadModule("src/lib/ai-text.ts");
  const retrieval = loadModule("src/lib/ai-retrieval.ts", {
    "./db": db,
    "./ai-config": config,
    "./ai-provider": provider,
    "./ai-text": text,
  });
  const prompt = loadModule("src/lib/ai-prompt.ts", {
    "./ai-config": config,
    "./ai-provider": provider,
    "./ai-retrieval": retrieval,
  });
  return { ...config, ...provider, ...text, ...retrieval, ...prompt };
}

/** Assemble the split conversation service with explicit test doubles. */
export function loadConversationService(dependencies = {}) {
  const queries = loadModule(
    "src/server/services/conversation-queries.ts",
    dependencies,
  );
  const actions = loadModule(
    "src/server/services/conversation-actions.ts",
    dependencies,
  );
  const visitor = loadModule(
    "src/server/services/conversation-visitor.ts",
    {
      ...dependencies,
      "./conversation-queries": queries,
    },
  );
  return { ...queries, ...actions, ...visitor };
}

/** Assemble the split message service with explicit test doubles. */
export function loadMessageService(dependencies = {}) {
  const write = loadModule("src/server/services/message-write.ts", dependencies);
  const posting = loadModule("src/server/services/message-posting.ts", {
    ...dependencies,
    "./message-write": write,
  });
  const read = loadModule("src/server/services/message-read.ts", dependencies);
  return { ...write, ...posting, ...read };
}

/** Assemble the split server AI service with explicit test doubles. */
export function loadAiService(dependencies = {}) {
  const runner = loadModule("src/server/services/ai-runner.ts", dependencies);
  const message = loadModule("src/server/services/ai-message.ts", dependencies);
  const autoReply = loadModule("src/server/services/ai-auto-reply.ts", {
    ...dependencies,
    "./ai-runner": runner,
    "./ai-message": message,
  });
  const assistant = loadModule("src/server/services/ai-assistant.ts", {
    ...dependencies,
    "./ai-runner": runner,
  });
  return { ...runner, ...message, ...autoReply, ...assistant };
}

/** Assemble the split webhook module with explicit test doubles. */
export function loadWebhookModule(dependencies = {}) {
  const types = loadModule("src/lib/webhook-types.ts");
  const request = loadModule("src/lib/webhook-request.ts", {
    ...dependencies,
    "./webhook-types": types,
  });
  const delivery = loadModule("src/lib/webhook-delivery.ts", {
    ...dependencies,
    "./webhook-types": types,
    "./webhook-request": request,
  });
  const test = loadModule("src/lib/webhook-test.ts", {
    ...dependencies,
    "./webhook-types": types,
    "./webhook-request": request,
  });
  return { ...types, ...request, ...delivery, ...test };
}

/** Assemble the split realtime socket entry with explicit test doubles. */
export function loadSocketModule(dependencies = {}) {
  const auth = loadModule("src/server/socket-auth.ts", dependencies);
  const session = loadModule("src/server/socket-session.ts", {
    ...dependencies,
    "./socket-auth": auth,
  });
  const lifecycle = loadModule("src/server/socket-lifecycle.ts", {
    ...dependencies,
    "./socket-auth": auth,
  });
  const events = loadModule("src/server/socket-events.ts", {
    ...dependencies,
    "./socket-auth": auth,
    "./socket-session": session,
  });
  return loadModule("src/server/socket.ts", {
    ...dependencies,
    "./socket-auth": auth,
    "./socket-session": session,
    "./socket-lifecycle": lifecycle,
    "./socket-events": events,
  });
}

/** Assemble the split AI tool modules with explicit test doubles. */
export function loadAiToolsModule(dependencies = {}) {
  const types = loadModule("src/server/services/ai-tool-types.ts", dependencies);
  const definitions = loadModule(
    "src/server/services/ai-tool-definitions.ts",
    dependencies,
  );
  const readers = loadModule("src/server/services/ai-tool-readers.ts", {
    ...dependencies,
    "./ai-tool-types": types,
  });
  const actions = loadModule("src/server/services/ai-tool-actions.ts", {
    ...dependencies,
    "./ai-tool-types": types,
  });
  const runner = loadModule("src/server/services/ai-tool-runner.ts", {
    ...dependencies,
    "./ai-tool-types": types,
    "./ai-tool-readers": readers,
    "./ai-tool-actions": actions,
  });
  return { ...types, ...definitions, ...readers, ...actions, ...runner };
}
