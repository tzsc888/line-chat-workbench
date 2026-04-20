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
  schema: { type: "object" } as Record<string, unknown>,
  validateParsed: (raw: unknown) => {
    const value = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
    const errors: string[] = [];
    if (!value) return ["root must be object"];
    if (!value.reply_a || typeof value.reply_a !== "object") errors.push("reply_a");
    if (!value.reply_b || typeof value.reply_b !== "object") errors.push("reply_b");
    if (typeof value.difference_note !== "string") errors.push("difference_note");
    if (!value.self_check || typeof value.self_check !== "object") errors.push("self_check");
    return errors;
  },
};

type GenerationLike = {
  reply_a: { japanese: string; chinese_meaning: string };
  reply_b: { japanese: string; chinese_meaning: string };
  difference_note: string;
  self_check: Record<string, unknown>;
};

test("structured client should succeed on valid JSON", async () => {
  const rawJson = JSON.stringify(
    buildChoiceContent(
      JSON.stringify({
        reply_a: { japanese: "A", chinese_meaning: "甲" },
        reply_b: { japanese: "B", chinese_meaning: "乙" },
        difference_note: "diff",
        self_check: {},
      }),
    ),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetchSequence([() => new Response(rawJson, { status: 200 })]);
  try {
    const result = await requestStructuredJsonWithContract<GenerationLike>(baseOptions);
    assert.equal(result.mode, "json_schema");
    assert.equal(result.parsed.reply_a.japanese, "A");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured client should handle markdown code block wrapped JSON", async () => {
  const payload = buildChoiceContent(
    "```json\n{\"reply_a\":{\"japanese\":\"A\",\"chinese_meaning\":\"甲\"},\"reply_b\":{\"japanese\":\"B\",\"chinese_meaning\":\"乙\"},\"difference_note\":\"d\",\"self_check\":{}}\n```",
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetchSequence([() => new Response(JSON.stringify(payload), { status: 200 })]);
  try {
    const result = await requestStructuredJsonWithContract<GenerationLike>(baseOptions);
    assert.equal(result.parsed.reply_b.chinese_meaning, "乙");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured client should recover when explanation and JSON are mixed", async () => {
  const unsupportedSchema = new Response(JSON.stringify({ error: "unsupported" }), { status: 400 });
  const mixed = new Response(
    JSON.stringify(
      buildChoiceContent(
        "说明：如下。\n{\"reply_a\":{\"japanese\":\"A\",\"chinese_meaning\":\"甲\"},\"reply_b\":{\"japanese\":\"B\",\"chinese_meaning\":\"乙\"},\"difference_note\":\"d\",\"self_check\":{}}",
      ),
    ),
    { status: 200 },
  );
  const retryValid = new Response(
    JSON.stringify(
      buildChoiceContent(
        "{\"reply_a\":{\"japanese\":\"A\",\"chinese_meaning\":\"甲\"},\"reply_b\":{\"japanese\":\"B\",\"chinese_meaning\":\"乙\"},\"difference_note\":\"d\",\"self_check\":{}}",
      ),
    ),
    { status: 200 },
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetchSequence([() => unsupportedSchema, () => mixed, () => retryValid]);
  try {
    const result = await requestStructuredJsonWithContract<GenerationLike>(baseOptions);
    assert.equal(result.mode, "json_object");
    assert.equal(result.parsed.reply_a.chinese_meaning, "甲");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured client should throw diagnosable error on invalid JSON", async () => {
  const invalid = new Response(JSON.stringify(buildChoiceContent("{\"reply_a\": ")), { status: 200 });
  const invalidRetry = new Response(JSON.stringify(buildChoiceContent("{\"reply_b\": ")), { status: 200 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetchSequence([
    () => invalid,
    () => invalidRetry,
  ]);
  try {
    await assert.rejects(
      () => requestStructuredJsonWithContract<GenerationLike>(baseOptions),
      (error: unknown) => {
        assert.ok(error instanceof AiStructuredOutputError);
        assert.equal(error.code, "MODEL_JSON_PARSE_ERROR");
        assert.ok(error.details.length >= 1);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured client should keep Chinese quotes/newlines/special characters stable", async () => {
  const payload = buildChoiceContent(
    JSON.stringify({
      reply_a: { japanese: "「A」\n次行", chinese_meaning: "中文“引号”\n第二行" },
      reply_b: { japanese: "B✨", chinese_meaning: "乙🙂" },
      difference_note: "A更稳，B更主动",
      self_check: { notes: "ok" },
    }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetchSequence([() => new Response(JSON.stringify(payload), { status: 200 })]);
  try {
    const result = await requestStructuredJsonWithContract<GenerationLike>(baseOptions);
    assert.match(result.parsed.reply_a.chinese_meaning, /中文/);
    assert.match(result.parsed.reply_b.chinese_meaning, /🙂/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured client should fail fast when max attempts budget is reached", async () => {
  const originalFetch = globalThis.fetch;
  const originalMaxAttempts = process.env.AI_STRUCTURED_MAX_ATTEMPTS;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response(
      JSON.stringify(
        buildChoiceContent(
          "{\"reply_a\":{\"japanese\":\"A\",\"chinese_meaning\":\"甲\"},\"reply_b\":{\"japanese\":\"B\",\"chinese_meaning\":\"乙\"}",
        ),
      ),
      { status: 200 },
    );
  }) as FetchImpl;
  process.env.AI_STRUCTURED_MAX_ATTEMPTS = "1";
  try {
    await assert.rejects(
      () => requestStructuredJsonWithContract<GenerationLike>(baseOptions),
      (error: unknown) => {
        assert.ok(error instanceof AiStructuredOutputError);
        assert.ok(error.code === "MODEL_TIMEOUT" || error.code === "MODEL_JSON_PARSE_ERROR");
        return true;
      },
    );
    assert.ok(callCount <= 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMaxAttempts === undefined) {
      delete process.env.AI_STRUCTURED_MAX_ATTEMPTS;
    } else {
      process.env.AI_STRUCTURED_MAX_ATTEMPTS = originalMaxAttempts;
    }
  }
});
