import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { CliArgs } from "../types";
import { getOpenAISize, validateArgs as validateOpenAIArgs } from "./openai";

const DEFAULT_MODEL = "gemini-3-pro-image-preview";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 360;

export type TuziModelFamily =
  | "gemini"
  | "gpt-image"
  | "seedream5"
  | "seedream45"
  | "seedream40"
  | "seedream30"
  | "unknown";

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

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

export function getModelFamily(model: string): TuziModelFamily {
  const normalized = normalizeModelId(model);

  if (/^doubao-seedream-5-0(?:-lite)?-\d+$/.test(normalized)) return "seedream5";
  if (/^doubao-seedream-4-5-\d+$/.test(normalized)) return "seedream45";
  if (/^doubao-seedream-4-0-\d+$/.test(normalized)) return "seedream40";
  if (/^doubao-seedream-3-0-t2i-\d+$/.test(normalized)) return "seedream30";
  if (normalized.includes("gpt-image")) return "gpt-image";
  if (normalized.includes("gemini")) return "gemini";

  return "unknown";
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

function parsePixelSize(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!match) return null;

  const width = parseInt(match[1]!, 10);
  const height = parseInt(match[2]!, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function normalizePixelSize(value: string): string | null {
  const parsed = parsePixelSize(value);
  if (!parsed) return null;
  return `${parsed.width}x${parsed.height}`;
}

function normalizeSizePreset(value: string): string | null {
  const upper = value.trim().toUpperCase();
  if (upper === "ADAPTIVE") return "adaptive";
  if (upper === "1K" || upper === "2K" || upper === "3K" || upper === "4K") return upper;
  return null;
}

function normalizeSizeValue(value: string): string | null {
  return normalizeSizePreset(value) ?? normalizePixelSize(value);
}

function mapQuality(args: CliArgs): string | null {
  if (args.imageSize) return args.imageSize.toLowerCase();
  if (args.quality === "2k") return "2k";
  if (args.quality === "normal") return "1k";
  return null;
}

function isRemovedSeededitModel(model: string): boolean {
  return /^doubao-seededit-3-0-i2i-\d+$/.test(normalizeModelId(model));
}

function assertSupportedSeedreamModel(model: string): void {
  if (isRemovedSeededitModel(model)) {
    throw new Error(
      `${model} 已不再受支持。当前工具仅支持 Seedream 5.0 / 4.5 / 4.0 / 3.0。`
    );
  }
}

function isSeedreamFamily(family: TuziModelFamily): boolean {
  return family === "seedream5" || family === "seedream45" || family === "seedream40" || family === "seedream30";
}

function supportsSeedreamReferenceImages(model: string): boolean {
  const family = getModelFamily(model);
  return family === "seedream5" || family === "seedream45" || family === "seedream40";
}

function getDefaultSeedreamSize(model: string, args: CliArgs): string {
  assertSupportedSeedreamModel(model);

  const family = getModelFamily(model);
  if (family === "seedream5") return "2K";
  if (family === "seedream45") return "2K";
  if (family === "seedream40") return args.quality === "normal" ? "1K" : "2K";
  if (family === "seedream30") return args.quality === "2k" ? "2048x2048" : "1024x1024";
  return "2K";
}

export function resolveSeedreamSize(model: string, args: CliArgs): string {
  assertSupportedSeedreamModel(model);

  const family = getModelFamily(model);
  const requested = args.size || args.imageSize || null;
  const normalized = requested ? normalizeSizeValue(requested) : null;

  if (args.aspectRatio && !args.size && !args.imageSize) {
    throw new Error(
      "Tuzi Seedream 模型不直接支持 --ar。请改用 --size 2048x1152 这类显式尺寸，或使用 --imageSize 2K/3K/4K。"
    );
  }

  if (!normalized) {
    return getDefaultSeedreamSize(model, args);
  }

  if (family === "seedream30") {
    const pixelSize = normalizePixelSize(normalized);
    if (!pixelSize) {
      throw new Error("Tuzi Seedream 3.0 仅支持显式 WxH 尺寸，例如 1024x1024。");
    }
    return pixelSize;
  }

  if (family === "seedream5") {
    if (normalized === "4K" || normalized === "1K" || normalized === "adaptive") {
      throw new Error("Tuzi Seedream 5.0 仅支持 2K、3K 或显式 WxH 尺寸。");
    }
    return normalized;
  }

  if (family === "seedream45") {
    if (normalized === "1K" || normalized === "3K" || normalized === "adaptive") {
      throw new Error("Tuzi Seedream 4.5 仅支持 2K、4K 或显式 WxH 尺寸。");
    }
    return normalized;
  }

  if (family === "seedream40") {
    if (normalized === "3K" || normalized === "adaptive") {
      throw new Error("Tuzi Seedream 4.0 仅支持 1K、2K、4K 或显式 WxH 尺寸。");
    }
    return normalized;
  }

  if (normalized === "adaptive") {
    throw new Error("Tuzi Seedream 当前不支持 adaptive size。");
  }

  if (normalized === "1K" || normalized === "3K" || normalized === "4K") {
    throw new Error("未知的 Tuzi Seedream 模型 ID。请使用已知模型，或改用显式 WxH 尺寸。");
  }

  return normalized;
}

export function validateArgs(model: string, args: CliArgs): void {
  const family = getModelFamily(model);

  if (family === "gpt-image") {
    validateOpenAIArgs(model, args);
    return;
  }

  if (!isSeedreamFamily(family) && !isRemovedSeededitModel(model)) {
    return;
  }

  assertSupportedSeedreamModel(model);

  const refCount = args.referenceImages.length;
  if (refCount === 0) {
    resolveSeedreamSize(model, args);
    return;
  }

  if (family === "unknown") {
    throw new Error(
      "Tuzi Seedream 参考图需要明确的 Seedream 模型 ID。请使用 Seedream 5.0 / 4.5 / 4.0 的正式模型名。"
    );
  }

  if (!supportsSeedreamReferenceImages(model)) {
    throw new Error(`${model} 不支持参考图片。`);
  }

  if (refCount > 14) {
    throw new Error(`${model} 最多支持 14 张参考图。`);
  }

  resolveSeedreamSize(model, args);
}

export function resolveSyncSize(model: string, args: CliArgs): string | null {
  const family = getModelFamily(model);

  if (family === "gpt-image") {
    return args.size || getOpenAISize(model, args.aspectRatio, args.quality);
  }

  if (isSeedreamFamily(family) || isRemovedSeededitModel(model)) {
    return resolveSeedreamSize(model, args);
  }

  return args.size || arToSize(args.aspectRatio);
}

type SyncResponse = { data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> };
type AsyncSubmitResponse = { id: string; status: string; progress?: number; error?: unknown };
type AsyncPollResponse = { id: string; status: string; progress?: number; video_url?: string; url?: string; error?: unknown };
type SyncImageResult = { kind: "bytes"; bytes: Uint8Array } | { kind: "url"; url: string };
type PreparedReferenceImage = { bytes: Buffer; mime: string; filename: string };

async function downloadImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片下载失败: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function decodeBase64Bytes(value: string): Uint8Array | null {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) return null;

  const remainder = normalized.length % 4;
  if (remainder === 1) return null;

  const padded = remainder === 0 ? normalized : `${normalized}${"=".repeat(4 - remainder)}`;

  try {
    const bytes = Uint8Array.from(Buffer.from(padded, "base64"));
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

function looksLikeImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return true;
  if (
    bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61
  ) return true;
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return true;
  return false;
}

function decodeDataUrlImage(value: string): Uint8Array | null {
  const match = value.match(/^data:image\/[^;]+;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return decodeBase64Bytes(match[1]!);
}

function extractSyncImage(result: SyncResponse): SyncImageResult {
  const img = result.data?.[0];
  if (img?.revised_prompt?.includes("PROHIBITED_CONTENT")) {
    throw new Error("内容被拒绝：包含违规内容");
  }
  if (img?.revised_prompt?.includes("NO_IMAGE")) {
    throw new Error("模型未生成图片，请尝试更明确的提示词。");
  }
  if (img?.b64_json) {
    const bytes = decodeBase64Bytes(img.b64_json);
    if (!bytes) throw new Error("响应中的 b64_json 无法解析");
    return { kind: "bytes", bytes };
  }
  if (img?.url) {
    const dataUrlBytes = decodeDataUrlImage(img.url);
    if (dataUrlBytes) return { kind: "bytes", bytes: dataUrlBytes };

    const rawBase64Bytes = decodeBase64Bytes(img.url);
    if (rawBase64Bytes && looksLikeImageBytes(rawBase64Bytes)) {
      return { kind: "bytes", bytes: rawBase64Bytes };
    }

    if (/^https?:\/\//i.test(img.url)) {
      return { kind: "url", url: img.url };
    }

    throw new Error("响应中的图片字段既不是有效 URL，也不是可识别的 base64 图片数据");
  }
  throw new Error("响应中无图片数据");
}

function parseError(error: unknown): string {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.code === "string" && typeof e.message === "string") return `${e.code}: ${e.message}`;
  }
  return String(error);
}

const MAX_REF_IMAGE_BYTES = 1024 * 1024;

function runCmd(cmd: string, args: string[]): Promise<{ code: number }> {
  return new Promise((res) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    proc.on("close", (code) => res({ code: code ?? 1 }));
    proc.on("error", () => res({ code: 1 }));
  });
}

async function compressToJpeg(filePath: string): Promise<Buffer | null> {
  const tmp = path.join(tmpdir(), `tuzi-ref-${Date.now()}.jpg`);
  try {
    if (process.platform === "darwin") {
      const { code } = await runCmd("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", filePath, "--out", tmp]);
      if (code === 0) return await readFile(tmp);
    }
    const { code } = await runCmd("convert", [filePath, "-quality", "70", tmp]);
    if (code === 0) return await readFile(tmp);
    return null;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

function getImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

async function prepareReferenceImage(filePath: string): Promise<PreparedReferenceImage> {
  let bytes = await readFile(filePath);
  let mime = getImageMimeType(filePath);
  let filename = path.basename(filePath);

  if (bytes.length > MAX_REF_IMAGE_BYTES && mime !== "image/gif") {
    const compressed = await compressToJpeg(filePath);
    if (compressed && compressed.length < bytes.length) {
      console.log(`参考图 ${path.basename(filePath)} 已压缩: ${bytes.length} → ${compressed.length} bytes`);
      bytes = compressed;
      mime = "image/jpeg";
      filename = `${path.parse(filename).name}.jpg`;
    }
  }

  return { bytes, mime, filename };
}

async function readImageAsBase64DataUrl(filePath: string): Promise<string> {
  const prepared = await prepareReferenceImage(filePath);
  return `data:${prepared.mime};base64,${prepared.bytes.toString("base64")}`;
}

function getGptImageEditSize(model: string, args: CliArgs): string {
  return args.size || getOpenAISize(model, args.aspectRatio, args.quality);
}

function getGptImageEditQuality(args: CliArgs): string | null {
  if (args.imageSize) return args.imageSize.toLowerCase();
  if (args.quality === "2k") return "2k";
  return null;
}

async function extractSyncResult(result: SyncResponse): Promise<Uint8Array> {
  const image = extractSyncImage(result);

  console.log("生成完成。");

  if (image.kind === "bytes") return image.bytes;
  return downloadImage(image.url);
}

async function generateGptImageEdits(
  baseURL: string,
  apiKey: string,
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", getGptImageEditSize(model, args));

  const quality = getGptImageEditQuality(args);
  if (quality) form.append("quality", quality);

  for (const refPath of args.referenceImages) {
    const prepared = await prepareReferenceImage(refPath);
    const blob = new Blob([prepared.bytes], { type: prepared.mime });
    form.append("image", blob, prepared.filename);
  }

  console.log(`正在使用 Tuzi 生成图片 (${model})...`);

  const res = await fetch(`${baseURL}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tuzi API 错误 (${res.status}): ${err}`);
  }

  const result = (await res.json()) as SyncResponse;
  return extractSyncResult(result);
}

export async function generateImage(
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("TUZI_API_KEY 未配置。请前往 https://api.tu-zi.com/token 获取（视频教程：https://www.bilibili.com/video/BV1k4PqzPEKz/）");

  const baseURL = getBaseUrl();
  validateArgs(model, args);
  const family = getModelFamily(model);

  if (family === "gpt-image" && args.referenceImages.length > 0) {
    return generateGptImageEdits(baseURL, apiKey, prompt, model, args);
  }
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
  };
  const family = getModelFamily(model);

  if (family !== "gpt-image") {
    body.response_format = "url";
  }

  const size = resolveSyncSize(model, args);
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

  console.log(`正在使用 Tuzi 生成图片 (${model})...`);

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
    throw new Error(`Tuzi API 错误 (${res.status}): ${err}`);
  }

  const result = (await res.json()) as SyncResponse;
  return extractSyncResult(result);
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
      const refPath = args.referenceImages[i]!;
      const prepared = await prepareReferenceImage(refPath);
      const blob = new Blob([prepared.bytes], { type: prepared.mime });
      const ext = path.extname(prepared.filename) || ".png";
      form.append("input_reference", blob, `reference-${i + 1}${ext}`);
    }
  }

  console.log(`正在提交 Tuzi 异步图片任务 (${model})...`);

  const submitRes = await fetch(`${normalizedBase}/v1/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Tuzi 异步提交错误 (${submitRes.status}): ${err}`);
  }

  const submitData = (await submitRes.json()) as AsyncSubmitResponse;

  if (submitData.status === "failed") {
    throw new Error(parseError(submitData.error));
  }

  const taskId = submitData.id;
  if (!taskId) throw new Error("Tuzi API 未返回任务 ID");

  console.log(`任务已提交 (id: ${taskId})，正在轮询结果...`);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${normalizedBase}/v1/videos/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      const err = await pollRes.text();
      throw new Error(`Tuzi 轮询错误 (${pollRes.status}): ${err}`);
    }

    const status = (await pollRes.json()) as AsyncPollResponse;

    if (attempt % 6 === 0) {
      console.log(`轮询中... 状态=${status.status}, 进度=${status.progress ?? 0}`);
    }

    if (status.status === "completed") {
      const url = status.video_url || status.url;
      if (!url) throw new Error("Tuzi API 未返回图片 URL");
      console.log("异步生成完成。");
      return downloadImage(url);
    }

    if (status.status === "failed") {
      throw new Error(parseError(status.error));
    }
  }

  throw new Error(`Tuzi 异步生成超时，已等待 ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000} 秒`);
}
