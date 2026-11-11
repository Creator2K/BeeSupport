import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAiModule, loadModule } from "./load-module.mjs";

const ai = loadAiModule();
const config = { ...ai.defaultAiConfig(), enabled: true, apiKey: "test", model: "test" };
const responseReader = loadModule("src/lib/ai-response.ts", { "./ai-config": ai });

test("AI response reader preserves UTF-8 across chunks and rejects invalid JSON objects", async () => {
  const bytes = new TextEncoder().encode('{"text":"中文回复"}');
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(await responseReader.readAiJson(new Response(stream)), { text: "中文回复" });
  for (const body of ["<html>bad gateway</html>", "null", "[]", '"text"'])
    await assert.rejects(responseReader.readAiJson(new Response(body)), /有效 JSON/);
});

test("oversized chunked AI responses are cancelled even without Content-Length", async () => {
  for (const errors of [false, true]) {
    let cancelled = false;
    let reads = 0;
    const response = new Response(new ReadableStream({
      pull(controller) { reads += 1; controller.enqueue(new Uint8Array(4096).fill(65)); },
      cancel() { cancelled = true; },
    }));
    if (errors) assert.equal((await responseReader.readAiError(response)).length, 16 * 1024);
    else await assert.rejects(responseReader.readAiJson(response, 8192), /响应过大/);
    assert.equal(cancelled, true);
    assert.ok(reads < 10, `stopped after ${reads} chunks`);
  }
});

test("unsupported tools fall back once without cloning or buffering the error response", async (t) => {
  const requests = [];
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      const response = new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(20_000).fill(65)); },
        cancel() { cancelled = true; },
      }), { status: 422 });
      response.clone = () => { throw new Error("must not clone"); };
      return response;
    }
    return Response.json({ choices: [{ message: { content: "回答" } }] });
  });
  const result = await ai.chatCompletion(config, [], { tools: [{ type: "function", function: { name: "test" } }] });
  assert.equal(result.content, "回答");
  assert.equal(requests.length, 2);
  assert.ok(requests[0].tools);
  assert.equal(requests[1].tools, undefined);
  assert.equal(cancelled, true);
});

test("model and embedding endpoints enforce response limits and validate payloads", async (t) => {
  let payload;
  t.mock.method(globalThis, "fetch", async () => typeof payload === "string" ? new Response(payload) : Response.json(payload));
  payload = { data: [{ id: "b" }, null, { id: 42 }, { name: "a" }] };
  assert.deepEqual(await ai.listAiModels(config), ["a", "b"]);
  payload = "x".repeat(1024 * 1024 + 1);
  await assert.rejects(ai.chatCompletion(config, []), /响应过大/);
  await assert.rejects(ai.listAiModels(config), /响应过大/);
  payload = { choices: [{ message: { content: { invalid: true } } }] };
  await assert.rejects(ai.chatCompletion(config, []), /格式无效/);
  for (const data of [[], [null], [{ embedding: [] }], [{ embedding: ["bad"] }]]) {
    payload = { data };
    await assert.rejects(ai.embedTexts(config, ["query"]), /数据无效/);
  }
  payload = { data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] };
  assert.deepEqual(await ai.embedTexts(config, ["one", "two"]), [[1, 0], [0, 1]]);
});

test("keyword retrieval skips vector columns and keeps separate caches when embeddings are enabled", async (t) => {
  const selections = [];
  let queries = 0;
  const version = new Date();
  const library = loadAiModule({ aiKnowledge: {
    findMany: async ({ select }) => {
      queries += 1;
      if (!select.content) return [{ id: "k", updatedAt: version }];
      selections.push(select.chunks.select);
      return [{ id: "k", title: "退款", content: "退款流程", keywords: ["退款"], updatedAt: version,
        chunks: [{ id: "chunk", content: "退款流程", ...(select.chunks.select.embedding ? { embedding: [1, 0], embeddingModel: config.embeddingModel } : {}) }],
      }];
    },
  } });
  let embeddings = 0;
  t.mock.method(globalThis, "fetch", async () => { embeddings += 1; return Response.json({ data: [{ embedding: [1, 0] }] }); });
  const input = { siteId: "s", query: "退款", topK: 3 };
  for (const patch of [{ siteId: null }, { query: " " }, { topK: 0 }])
    assert.deepEqual(await library.retrieveKnowledge({ ...input, ...patch }), []);
  assert.equal(queries, 0);
  const keyword = await library.retrieveKnowledge(input);
  assert.equal(keyword[0].via, "keyword");
  assert.equal(selections[0].embedding, false);
  assert.equal(selections[0].embeddingModel, false);
  const vector = await library.retrieveKnowledge({ ...input, config: { ...config, enableEmbeddings: true } });
  assert.equal(vector[0].via, "hybrid");
  assert.equal(selections[1].embedding, true);
  assert.deepEqual(await library.retrieveKnowledge(input), keyword);
  assert.equal(selections.length, 2);
  assert.equal(embeddings, 1);
});
