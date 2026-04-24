import test from "node:test";
import assert from "node:assert/strict";
import {
  AiStructuredOutputError,
  requestStructuredJsonWithContract,
} from "../../lib/ai/model-client";

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function buildChoiceContent(content: string) {
  return {
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  };
}

function mockFetchSequence(handlers: Array<() => Response>) {
  let index = 0;
  const impl: FetchImpl = async () => {
    const next = handlers[index];
    index += 1;
    if (!next) {
      return new Response(JSON.stringify(buildChoiceContent("{}")), { status: 200 });
    }
    return next();
  };
  return impl;
}

type FlatReply = {
  reply_a_ja: string;
  reply_b_ja: string;
};

const baseOptions = {
  apiKey: "k",
  baseUrl: "https://mock-main",
  backupBaseUrl: "",
  model: "m",
  system: "s",
  user: "u",
  temperature: 0.2,
  stage: "generation",
  schemaName: "reply_generation_result",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply_a_ja", "reply_b_ja"],
    properties: {
      reply_a_ja: { type: "string" },
      reply_b_ja: { type: "string" },
    },
  } as Record<string, unknown>,
  validateParsed: (raw: unknown) => {
    const value = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
    const errors: string[] = [];
    if (!value) return ["root must be object"];
    if (typeof value.reply_a_ja !== "string" || !value.reply_a_ja.trim()) errors.push("reply_a_ja");
    if (typeof value.reply_b_ja !== "string" || !value.reply_b_ja.trim()) errors.push("reply_b_ja");
    return errors;
  },
};

test("structured client should succeed on valid JSON", async () => {
  const rawJson = JSON.stringify(
    buildChoiceContent(
      JSON.stringify({
        reply_a_ja: "A",
        reply_b_ja: "B",
      }),
    ),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetchSequence([() => new Response(rawJson, { status: 200 })]);
  try {
    const result = await requestStructuredJsonWithContract<FlatReply>(baseOptions);
    assert.equal(result.mode, "json_object");
    assert.equal(result.parsed.reply_a_ja, "A");
    assert.equal(result.parsed.reply_b_ja, "B");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured client should throw diagnosable error on invalid JSON", async () => {
  const invalid = new Response(JSON.stringify(buildChoiceContent("{\"reply_a_ja\": ")), { status: 200 });
  const invalidRetry = new Response(JSON.stringify(buildChoiceContent("{\"reply_b_ja\": ")), { status: 200 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetchSequence([
    () => invalid,
    () => invalidRetry,
  ]);
  try {
    await assert.rejects(
      () => requestStructuredJsonWithContract<FlatReply>(baseOptions),
      (error: unknown) => {
        assert.ok(error instanceof AiStructuredOutputError);
        assert.ok(error.code === "MODEL_JSON_PARSE_ERROR" || error.code === "MODEL_TIMEOUT");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
