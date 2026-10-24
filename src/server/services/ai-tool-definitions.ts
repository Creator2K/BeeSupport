import type { OpenAiTool } from "../../lib/ai";

export const TOOL_DEFINITIONS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "在客服知识库里检索资料。回答政策、价格、流程等具体问题前先调用它，再用检索结果作答。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词或访客的原话" },
          top_k: { type: "integer", description: "返回条数，默认 4，最多 8" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_visitor_context",
      description:
        "获取当前访客的资料：邮箱、访问次数、所在页面、语言、设备等，用于判断语境。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "当问题超出知识库范围、涉及退款投诉、或访客明确要求人工时调用，转交人工客服跟进。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "转人工的原因，用中文简短描述",
          },
          priority: {
            type: "integer",
            description: "优先级 1-3，1 最高；投诉或紧急问题用 1",
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_conversation",
      description: "给会话打标签，便于后续统计与筛选，例如「退款」「发票」。",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            description: "1-3 个中文短标签",
          },
        },
        required: ["tags"],
      },
    },
  },
];
export const READ_ONLY_TOOLS = new Set([
  "search_knowledge",
  "get_visitor_context",
]);
