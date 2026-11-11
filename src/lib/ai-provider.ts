import {
  AiError,
  isAiReady,
  normalizeBaseUrl,
  resolveModel,
  type AiConfig,
} from "./ai-config";
import { readAiError, readAiJson } from "./ai-response";

/* ---------------- 模型列表 ---------------- */

/** 拉取模型列表，用于后台的模型下拉 */
export async function listAiModels(config: {
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl || !config.apiKey) {
    throw new AiError("请先填写接口地址与 API 密钥");
  }

  const response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    throw new AiError(
      `无法连接接口：${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (!response.ok) {
    const text = await readAiError(response);
    throw new AiError(`接口返回 ${response.status}：${text.slice(0, 200)}`);
  }

  const data = (await readAiJson(response)) as {
    data?: { id?: string; name?: string }[];
    models?: { id?: string; name?: string }[];
  };

  // 兼容 OpenAI 的 { data: [...] } 与部分网关的 { models: [...] }
  const rawItems: { id?: string; name?: string }[] = [
    ...(Array.isArray(data.data) ? data.data : []),
    ...(Array.isArray(data.models) ? data.models : []),
  ];

  const ids = rawItems
    .map((item) => item?.id ?? item?.name ?? "")
    .filter((id): id is string => typeof id === "string" && Boolean(id))
    .sort((a, b) => a.localeCompare(b));

  if (ids.length === 0) throw new AiError("接口没有返回任何模型");
  return ids;
}

/* ---------------- 对话补全（含工具调用） ---------------- */

export type AiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AiChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCallPayload[];
    }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

export type OpenAiToolCallPayload = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiChatResult = {
  content: string;
  toolCalls: AiToolCall[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
  raw: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAiToolCallPayload[];
  };
};

/** 兼容旧签名的一层封装：system/user/assistant 三种角色的普通消息 */
export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatCompletion(
  config: AiConfig,
  messages: AiChatMessage[],
  options: {
    model?: string;
    tools?: OpenAiTool[];
    toolChoice?: "auto" | "none";
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<AiChatResult> {
  if (!config.baseUrl || !config.apiKey)
    throw new AiError("AI 未配置接口地址或密钥");
  const model = resolveModel(config, options.model);
  if (!model) throw new AiError("请先选择模型");

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? config.temperature,
    max_tokens: options.maxTokens ?? config.maxTokens,
    stream: false,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }

  const send = async (payload: Record<string, unknown>): Promise<Response> =>
    fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    }).catch((error: unknown) => {
      throw new AiError(
        `调用失败：${error instanceof Error ? error.message : String(error)}`,
      );
    });

  let response = await send(body);

  // 有些 OpenAI 兼容网关还不支持 tools，这里退一步重试一次普通对话
  if (!response.ok && body.tools && [400, 404, 422].includes(response.status)) {
    const text = await readAiError(response);
    console.warn(
      `[ai] 接口不支持工具调用（${response.status}），已退化为普通对话：${text.slice(0, 120)}`,
    );
    const fallback = { ...body };
    delete fallback.tools;
    delete fallback.tool_choice;
    response = await send(fallback);
  }

  if (!response.ok) {
    const text = await readAiError(response);
    throw new AiError(`模型返回 ${response.status}：${text.slice(0, 300)}`);
  }

  const data = (await readAiJson(response)) as {
    choices?: {
      message?: {
        role?: string;
        content?: string | null;
        tool_calls?: OpenAiToolCallPayload[];
      };
      finish_reason?: string;
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) throw new AiError("模型没有返回内容");
  if (
    (message.content != null && typeof message.content !== "string") ||
    (message.tool_calls != null &&
      (!Array.isArray(message.tool_calls) ||
        message.tool_calls.some(
          (call) =>
            !call ||
            typeof call.id !== "string" ||
            typeof call.function?.name !== "string" ||
            typeof call.function?.arguments !== "string",
        )))
  )
    throw new AiError("模型返回的消息格式无效");

  const toolCalls: AiToolCall[] = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function?.name ?? "",
    arguments: call.function?.arguments ?? "{}",
  }));

  return {
    content: (message.content ?? "").trim(),
    toolCalls,
    finishReason: choice?.finish_reason ?? null,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : null,
    raw: {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    },
  };
}

export async function chatComplete(
  config: AiConfig,
  messages: AiMessage[],
  model?: string,
): Promise<string> {
  if (!isAiReady(config)) throw new AiError("AI 未启用或配置不完整");
  const result = await chatCompletion(config, messages, { model });
  if (!result.content) throw new AiError("模型没有返回内容");
  return result.content;
}

/* ---------------- Embedding ---------------- */

export async function embedTexts(
  config: AiConfig,
  texts: string[],
  model?: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!config.baseUrl || !config.apiKey)
    throw new AiError("AI 未配置接口地址或密钥");

  const embeddingModel = (model || config.embeddingModel).trim();
  if (!embeddingModel) throw new AiError("请先填写向量模型");

  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: embeddingModel, input: texts }),
    signal: AbortSignal.timeout(60_000),
  }).catch((error: unknown) => {
    throw new AiError(
      `向量接口调用失败：${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (!response.ok) {
    const text = await readAiError(response);
    throw new AiError(`向量接口返回 ${response.status}：${text.slice(0, 200)}`);
  }

  const data = (await readAiJson(response, 16 * 1024 * 1024)) as {
    data?: { embedding?: number[]; index?: number }[];
  };

  const items = data.data;
  if (
    !Array.isArray(items) ||
    items.length !== texts.length ||
    items.some(
      (item) =>
        !item ||
        !Array.isArray(item.embedding) ||
        !item.embedding.length ||
        !item.embedding.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    )
  )
    throw new AiError("向量接口返回的数据无效");

  return items
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding ?? []);
}
