import assert from "node:assert/strict";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { CliArgs } from "../types.ts";
import {
  generateImage,
  getModelFamily,
  resolveSeedreamSize,
  resolveSyncSize,
  validateArgs,
} from "./tuzi.ts";

function makeArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    prompt: null,
    promptFiles: [],
    imagePath: null,
    provider: null,
    model: null,
    aspectRatio: null,
    size: null,
    quality: "2k",
    imageSize: null,
    imageApiDialect: null,
    referenceImages: [],
    n: 1,
    json: false,
    help: false,
    ...overrides,
  };
}

function useEnv(t: TestContext, values: Record<string, string | null>): void {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  t.after(() => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function createTempPng(t: TestContext): Promise<string> {
  const filePath = path.join(
    tmpdir(),
    `tuzi-test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  );
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axRZQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(filePath, pngBytes);
  t.after(async () => {
    await unlink(filePath).catch(() => {});
  });
  return filePath;
}

test("Tuzi model-family detection recognizes Gemini, GPT Image, and Seedream variants", () => {
  assert.equal(getModelFamily("gemini-3-pro-image-preview"), "gemini");
  assert.equal(getModelFamily("gpt-image-2"), "gpt-image");
  assert.equal(getModelFamily("doubao-seedream-5-0-260128"), "seedream5");
  assert.equal(getModelFamily("doubao-seedream-4-5-251128"), "seedream45");
  assert.equal(getModelFamily("doubao-seedream-4-0-250828"), "seedream40");
  assert.equal(getModelFamily("doubao-seedream-3-0-t2i-250415"), "seedream30");
  assert.equal(getModelFamily("bfl-flux-2-pro"), "unknown");
});

test("Tuzi resolves GPT Image sizes and reuses local gpt-image-2 validation rules", () => {
  assert.equal(
    resolveSyncSize("gpt-image-2", makeArgs({ aspectRatio: "16:9", quality: "2k" })),
    "2048x1152",
  );
  assert.equal(
    resolveSyncSize("gpt-image-2", makeArgs({ aspectRatio: "9:16", quality: "2k" })),
    "1152x2048",
  );

  assert.doesNotThrow(() =>
    validateArgs("gpt-image-2", makeArgs({ size: "3840x2160" })),
  );

  assert.throws(
    () => validateArgs("gpt-image-2", makeArgs({ size: "1234x777" })),
    /16 的倍数/,
  );
  assert.throws(
    () => validateArgs("gpt-image-2", makeArgs({ aspectRatio: "4:1" })),
    /3:1/,
  );
});

test("Tuzi Seedream size selection follows family-specific rules", () => {
  assert.equal(
    resolveSeedreamSize("doubao-seedream-5-0-260128", makeArgs({ imageSize: "3K" })),
    "3K",
  );
  assert.equal(
    resolveSeedreamSize("doubao-seedream-4-5-251128", makeArgs({ size: "4K" })),
    "4K",
  );
  assert.equal(
    resolveSeedreamSize("doubao-seedream-4-0-250828", makeArgs({ quality: "normal" })),
    "1K",
  );
  assert.equal(
    resolveSeedreamSize("doubao-seedream-3-0-t2i-250415", makeArgs({ size: "1024x1024" })),
    "1024x1024",
  );

  assert.throws(
    () => resolveSeedreamSize("doubao-seedream-5-0-260128", makeArgs({ imageSize: "4K" })),
    /2K、3K/,
  );
  assert.throws(
    () => resolveSeedreamSize("doubao-seedream-3-0-t2i-250415", makeArgs({ imageSize: "2K" })),
    /显式 WxH/,
  );
  assert.throws(
    () => validateArgs("doubao-seedream-4-5-251128", makeArgs({ aspectRatio: "16:9" })),
    /不直接支持 --ar/,
  );
});

test("Tuzi Seedream reference-image validation matches supported families", () => {
  assert.doesNotThrow(() =>
    validateArgs(
      "doubao-seedream-4-5-251128",
      makeArgs({ referenceImages: ["a.png", "b.png"], imageSize: "2K" }),
    ),
  );

  assert.throws(
    () =>
      validateArgs(
        "doubao-seedream-3-0-t2i-250415",
        makeArgs({ referenceImages: ["a.png"], size: "1024x1024" }),
      ),
    /不支持参考图片/,
  );

  assert.throws(
    () =>
      validateArgs(
        "doubao-seedream-5-0-260128",
        makeArgs({ referenceImages: new Array(15).fill("a.png"), imageSize: "2K" }),
      ),
    /最多支持 14 张参考图/,
  );

  assert.throws(
    () =>
      validateArgs(
        "doubao-seededit-3-0-i2i-250628",
        makeArgs({ size: "1024x1024" }),
      ),
    /已不再受支持/,
  );
});

test("Tuzi generateImage uses resolved GPT Image sizes in the sync request body", async (t) => {
  useEnv(t, { TUZI_API_KEY: "test-key", TUZI_BASE_URL: null });

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: Array<{ input: string; init?: RequestInit }> = [];

  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json({
      data: [
        {
          url: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
        },
      ],
    });
  };

  const image = await generateImage(
    "A cinematic skyline",
    "gpt-image-2",
    makeArgs({ aspectRatio: "16:9", quality: "2k" }),
  );

  assert.deepEqual([...image], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "https://api.tu-zi.com/v1/images/generations");

  const requestBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(requestBody.model, "gpt-image-2");
  assert.equal(requestBody.size, "2048x1152");
  assert.equal("response_format" in requestBody, false);
});

test("Tuzi gpt-image reference images use OpenAI-style edits multipart requests", async (t) => {
  useEnv(t, { TUZI_API_KEY: "test-key", TUZI_BASE_URL: null });

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const refPath = await createTempPng(t);
  const calls: Array<{ input: string; init?: RequestInit }> = [];

  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json({
      data: [
        {
          b64_json: Buffer.from([1, 2, 3]).toString("base64"),
        },
      ],
    });
  };

  const image = await generateImage(
    "Turn this into a watercolor illustration",
    "gpt-image-2",
    makeArgs({ aspectRatio: "16:9", quality: "2k", referenceImages: [refPath] }),
  );

  assert.deepEqual([...image], [1, 2, 3]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "https://api.tu-zi.com/v1/images/edits");

  const form = calls[0]?.init?.body as FormData;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("model"), "gpt-image-2");
  assert.equal(form.get("prompt"), "Turn this into a watercolor illustration");
  assert.equal(form.get("size"), "2048x1152");
  assert.equal(form.get("quality"), "2k");

  const images = form.getAll("image");
  assert.equal(images.length, 1);
  assert.equal(images[0] instanceof File, true);
});

test("Tuzi keeps response_format for non-GPT sync models and decodes raw base64 image payloads", async (t) => {
  useEnv(t, { TUZI_API_KEY: "test-key", TUZI_BASE_URL: null });

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: Array<{ input: string; init?: RequestInit }> = [];

  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json({
      data: [
        {
          url: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString("base64"),
        },
      ],
    });
  };

  const image = await generateImage(
    "A cozy cafe interior",
    "gemini-3-pro-image-preview",
    makeArgs({ aspectRatio: "4:3" }),
  );

  assert.deepEqual([...image], [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.equal(calls.length, 1);

  const requestBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(requestBody.model, "gemini-3-pro-image-preview");
  assert.equal(requestBody.size, "4x3");
  assert.equal(requestBody.response_format, "url");
});
