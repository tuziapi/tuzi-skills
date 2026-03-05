import path from "node:path";
import { readFile } from "node:fs/promises";
import type { CliArgs } from "../types";

const DEFAULT_MODEL = "gemini-3-pro-image-preview";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 360;

export function getDefaultModel(): string {
  return process.env.TUZI_IMAGE_MODEL || DEFAULT_MODEL;
}

function getApiKey(): string | null {
  return process.env.TUZI_API_KEY || null;
}

function getBaseUrl(): string {
  const base = process.env.TUZI_BASE_URL || "https://api.tu-zi.com/v1";
  return base.replace(/\/+$/g, "");
}

const ASYNC_MODEL_IDS = [
  "gemini-3-pro-image-preview-async",
  "gemini-3-pro-image-preview-2k-async",
  "gemini-3-pro-image-preview-4k-async",
  "mj-imagine",
];

function isAsyncModel(model: string): boolean {
  const lower = model.toLowerCase();
  return ASYNC_MODEL_IDS.some((id) => lower.includes(id.toLowerCase()));
}

const QUALITY_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
];

function supportsQuality(model: string): boolean {
  return QUALITY_MODELS.some((id) => model === id);
}

function arToSize(ar: string | null): string | null {
  if (!ar) return null;
  const match = ar.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const w = Math.round(parseFloat(match[1]!));
  const h = Math.round(parseFloat(match[2]!));
  return `${w}x${h}`;
}

function mapQuality(args: CliArgs): string | null {
  if (args.imageSize) return args.imageSize.toLowerCase();
  if (args.quality === "2k") return "2k";
  if (args.quality === "normal") return "1k";
  return null;
}

type SyncResponse = { data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> };
type AsyncSubmitResponse = { id: string; status: string; progress?: number; error?: unknown };
type AsyncPollResponse = { id: string; status: string; progress?: number; video_url?: string; url?: string; error?: unknown };

async function downloadImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function extractSyncUrl(result: SyncResponse): string {
  const img = result.data?.[0];
  if (img?.revised_prompt?.includes("PROHIBITED_CONTENT")) {
    throw new Error("Content rejected: contains prohibited content");
  }
  if (img?.revised_prompt?.includes("NO_IMAGE")) {
    throw new Error("Model did not generate an image. Try a more explicit prompt.");
  }
  if (img?.url) return img.url;
  if (img?.b64_json) return `data:image/png;base64,${img.b64_json}`;
  throw new Error("No image in response");
}

function parseError(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.code === "string" && typeof e.message === "string") return `${e.code}: ${e.message}`;
  }
  return String(error);
}

async function readImageAsBase64DataUrl(p: string): Promise<string> {
  const buf = await readFile(p);
  const ext = path.extname(p).toLowerCase();
  let mime = "image/png";
  if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
  else if (ext === ".webp") mime = "image/webp";
  else if (ext === ".gif") mime = "image/gif";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function generateImage(
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("TUZI_API_KEY is required. Get one at https://api.tu-zi.com/token (video tutorial: https://www.bilibili.com/video/BV1k4PqzPEKz/)");

  const baseURL = getBaseUrl();

  if (isAsyncModel(model)) {
    return generateAsync(baseURL, apiKey, prompt, model, args);
  }
  return generateSync(baseURL, apiKey, prompt, model, args);
}

async function generateSync(
  baseURL: string,
  apiKey: string,
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    response_format: "url",
  };

  const size = args.size || arToSize(args.aspectRatio);
  if (size) body.size = size;

  if (supportsQuality(model)) {
    const q = mapQuality(args);
    if (q) body.quality = q;
  }

  if (args.referenceImages.length > 0) {
    const refs: string[] = [];
    for (const refPath of args.referenceImages) {
      refs.push(await readImageAsBase64DataUrl(refPath));
    }
    body.image = refs;
  }

  if (args.n > 1) body.n = args.n;

  console.log(`Generating image with Tuzi (${model})...`);

  const res = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tuzi API error (${res.status}): ${err}`);
  }

  const result = (await res.json()) as SyncResponse;
  const url = extractSyncUrl(result);

  console.log("Generation completed.");

  if (url.startsWith("data:")) {
    const b64 = url.split(",")[1]!;
    return Uint8Array.from(Buffer.from(b64, "base64"));
  }
  return downloadImage(url);
}

async function generateAsync(
  baseURL: string,
  apiKey: string,
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const normalizedBase = baseURL.replace(/\/v1\/?$/, "");

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);

  const size = args.size || arToSize(args.aspectRatio) || "1:1";
  form.append("size", size);

  if (args.referenceImages.length > 0) {
    for (let i = 0; i < args.referenceImages.length; i++) {
      const bytes = await readFile(args.referenceImages[i]!);
      const blob = new Blob([bytes], { type: "image/png" });
      form.append("input_reference", blob, `reference-${i}.png`);
    }
  }

  console.log(`Submitting async image task with Tuzi (${model})...`);

  const submitRes = await fetch(`${normalizedBase}/v1/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Tuzi async submit error (${submitRes.status}): ${err}`);
  }

  const submitData = (await submitRes.json()) as AsyncSubmitResponse;

  if (submitData.status === "failed") {
    throw new Error(parseError(submitData.error));
  }

  const taskId = submitData.id;
  if (!taskId) throw new Error("No task ID returned from Tuzi API");

  console.log(`Task submitted (id: ${taskId}). Polling for result...`);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${normalizedBase}/v1/videos/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      const err = await pollRes.text();
      throw new Error(`Tuzi poll error (${pollRes.status}): ${err}`);
    }

    const status = (await pollRes.json()) as AsyncPollResponse;

    if (attempt % 6 === 0) {
      console.log(`Polling... status=${status.status}, progress=${status.progress ?? 0}`);
    }

    if (status.status === "completed") {
      const url = status.video_url || status.url;
      if (!url) throw new Error("Tuzi API returned no image URL");
      console.log("Async generation completed.");
      return downloadImage(url);
    }

    if (status.status === "failed") {
      throw new Error(parseError(status.error));
    }
  }

  throw new Error(`Tuzi async generation timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}