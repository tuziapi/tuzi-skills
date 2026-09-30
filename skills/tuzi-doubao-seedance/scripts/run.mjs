#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

const MODELS = new Set([
  "doubao-seedance-2-5-260628",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
]);
const DEFAULT_MODEL = "doubao-seedance-2-0-260128";
const DEFAULT_MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_MEDIA_BYTES = 45 * 1024 * 1024;
const DEFAULT_MAX_BASE64_BYTES = 128 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_SECONDS = 15;
const MIN_POLL_INTERVAL_SECONDS = 3;
const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_IMAGE_REFERENCES = 9;
const MAX_VIDEO_REFERENCES = 3;

const MIME_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".m4v", "video/x-m4v"],
  [".avi", "video/x-msvideo"],
  [".mkv", "video/x-matroska"],
]);
const SUPPORTED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);
const SUPPORTED_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

function printHelp() {
  console.log(`Usage:
  node skills/tuzi-doubao-seedance/scripts/run.mjs --model <model> --prompt <text> [options]

Connection:
  --url <url>                 API base URL; default env/global config
  --key <key>                 API key; default env/global config
  --configure                 Save API URL and Key to the global local config
  --config-path               Print the global config path without its contents
  --clear-config              Delete the global local config

Request:
  --model <model>             One of the four supported Seedance models
  --prompt <text>             Text prompt (required unless request JSON has text)
  --image <source>            Reference image; repeatable
  --video <source>            Reference video; repeatable
  --request-json <json>       Extra request fields, merged before CLI fields
  --duration <seconds>        Override duration
  --ratio <ratio>             Override aspect ratio, for example 16:9
  --size <size>               Override size, for example 720p

Media:
  --upload-command <path>     Optional custom uploader: <file> <mime> <image|video> -> URL
  --max-media-bytes <bytes>   Local media/data-video limit, default 20971520

Polling/output:
  --poll-interval <seconds>   Default 15, minimum 3
  --timeout <seconds>         Default 600
  --download                  Stream completed video to disk
  --download-dir <dir>        Download directory (implies --download)
  --base64                    Add completed video Base64 to result JSON
  --preflight                 Check /v1/models before creating a task
  -h, --help                  Show this help
`);
}

function parseArgs(argv) {
  const args = {
    model: DEFAULT_MODEL,
    images: [],
    videos: [],
    media: [],
    download: false,
    base64: false,
    preflight: false,
    pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxMediaBytes: DEFAULT_MAX_MEDIA_BYTES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[i];
    };

    switch (arg) {
      case "--url":
        args.url = next();
        break;
      case "--key":
        args.key = next();
        break;
      case "--configure":
        args.configure = true;
        break;
      case "--config-path":
        args.configPath = true;
        break;
      case "--clear-config":
        args.clearConfig = true;
        break;
      case "--model":
        args.model = next();
        break;
      case "--prompt":
        args.prompt = next();
        break;
      case "--image":
        args.images.push(next());
        args.media.push({ kind: "image", source: args.images.at(-1) });
        break;
      case "--video":
        args.videos.push(next());
        args.media.push({ kind: "video", source: args.videos.at(-1) });
        break;
      case "--request-json":
        args.requestJson = next();
        break;
      case "--duration":
        args.duration = parsePositiveNumber(next(), arg);
        break;
      case "--ratio":
        args.ratio = next();
        break;
      case "--size":
        args.size = next();
        break;
      case "--upload-command":
        args.uploadCommand = next();
        break;
      case "--max-media-bytes":
        args.maxMediaBytes = parsePositiveNumber(next(), arg);
        break;
      case "--poll-interval":
        args.pollIntervalSeconds = parsePositiveNumber(next(), arg);
        break;
      case "--timeout":
        args.timeoutSeconds = parsePositiveNumber(next(), arg);
        break;
      case "--download":
        args.download = true;
        break;
      case "--download-dir":
        args.download = true;
        args.downloadDir = next();
        break;
      case "--base64":
        args.base64 = true;
        break;
      case "--preflight":
        args.preflight = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function log(event, fields = {}) {
  const suffix = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatLogValue(value)}`)
    .join(" ");
  process.stderr.write(`[${new Date().toISOString()}] [${event}]${suffix ? ` ${suffix}` : ""}\n`);
}

function formatLogValue(value) {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function normalizeBaseUrl(value) {
  if (!value) {
    throw new Error("Missing API URL. Provide --url, DOUBAO_SEEDANCE_URL, or TUZI_BASE_URL.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid API URL. Enter a full http(s) URL, for example https://api.example.com/v1.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("API URL must use http or https");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  for (const suffix of ["/v1/videos", "/v1"]) {
    if (!parsed.pathname.endsWith(suffix)) continue;
    parsed.pathname = parsed.pathname.slice(0, -suffix.length).replace(/\/+$/, "");
    break;
  }
  return parsed.toString().replace(/\/$/, "");
}

function globalConfigPath() {
  if (process.env.DOUBAO_SEEDANCE_CONFIG) return resolve(process.env.DOUBAO_SEEDANCE_CONFIG);
  const tuziRoot = process.env.TUZI_SKILLS_HOME || join(homedir(), ".tuzi-skills");
  return join(tuziRoot, "config", "doubao-seedance.json");
}

async function loadTuziEnv() {
  const roots = [
    process.env.TUZI_SKILLS_HOME || join(homedir(), ".tuzi-skills"),
    join(process.cwd(), ".tuzi-skills"),
  ];
  for (const root of [...new Set(roots)]) {
    try {
      const raw = await readFile(join(root, ".env"), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator <= 0) continue;
        const name = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[name]) process.env[name] = value;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function loadGlobalConfig() {
  const path = globalConfigPath();
  try {
    const raw = await readFile(path, "utf8");
    const config = JSON.parse(raw);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("config must be an object");
    return {
      url: typeof config.url === "string" ? config.url.trim() : "",
      key: typeof config.key === "string" ? config.key.trim() : "",
    };
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Global config is invalid at ${path}. Run --configure to replace it.`);
  }
}

async function saveGlobalConfig({ url, key }) {
  const path = globalConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ url, key })}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
  return path;
}

async function promptSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await readline.question(question)).trim();
    } finally {
      readline.close();
    }
  }

  return new Promise((resolvePromise, reject) => {
    let value = "";
    const stdin = process.stdin;
    const stdout = process.stdout;
    const restore = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const finish = (result, error) => {
      restore();
      stdout.write("\n");
      if (error) reject(error);
      else resolvePromise(result.trim());
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === "\u0003") return finish("", new Error("Configuration cancelled"));
        if (char === "\r" || char === "\n") return finish(value);
        if (char === "\u0008" || char === "\u007f") {
          if (value) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        stdout.write("*");
      }
    };
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function configureGlobalConfig(args) {
  let current = {};
  try {
    current = await loadGlobalConfig();
  } catch (error) {
    if (!error.message.startsWith("Global config is invalid")) throw error;
  }
  let url = args.url;
  let enteredKey = args.key;
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    if (!url) process.stdout.write(`API URL（先输入，例如 https://api.example.com/v1）[${current.url || "未设置"}]: `);
    if (!enteredKey) process.stdout.write("API Key（留空保留现有 Key）: ");
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const lines = input.split(/\r?\n/);
    let index = 0;
    if (!url) url = (lines[index++] || "").trim() || current.url;
    if (!enteredKey) enteredKey = (lines[index] || "").trim();
  } else {
    if (!url) {
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        url = (await readline.question(`API URL（先输入，例如 https://api.example.com/v1）[${current.url || "未设置"}]: `)).trim() || current.url;
      } finally {
        readline.close();
      }
    }
  }
  // Validate the URL before collecting the secret so a misplaced key is never echoed in an error.
  normalizeBaseUrl(url);
  if (!enteredKey) enteredKey = await promptSecret("API Key（输入不回显，留空保留现有 Key）: ");
  const key = enteredKey || current.key;
  if (!url || !key) throw new Error("API URL and API Key are required for configuration");
  const path = await saveGlobalConfig({ url, key });
  process.stdout.write(`Global config saved to ${path}\n`);
}

async function clearGlobalConfig() {
  const path = globalConfigPath();
  await rm(path, { force: true });
  process.stdout.write(`Global config removed from ${path}\n`);
}

async function resolveConnection(args) {
  const explicitUrl = args.url || process.env.DOUBAO_SEEDANCE_URL || process.env.TUZI_BASE_URL;
  const explicitKey = args.key || process.env.DOUBAO_SEEDANCE_KEY || process.env.TUZI_API_KEY;
  const config = explicitUrl && explicitKey ? {} : await loadGlobalConfig();
  const rawUrl = explicitUrl || config.url;
  if (!rawUrl) {
    throw new Error("Missing API URL. Provide --url, DOUBAO_SEEDANCE_URL, TUZI_BASE_URL, or run --configure.");
  }
  const resolvedUrl = normalizeBaseUrl(rawUrl);
  const key = explicitKey || config.key;
  if (!key) {
    throw new Error("Missing API key. Provide --key, DOUBAO_SEEDANCE_KEY, TUZI_API_KEY, or run --configure.");
  }
  return { url: resolvedUrl, key };
}

function authHeader(key) {
  return /^Bearer\s+/i.test(key) ? key : `Bearer ${key}`;
}

async function requestJson(url, { key, method = "GET", body, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(key),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok || data?.success === false) {
      const error = typeof data?.error === "string" ? data.error : data?.error?.message;
      const message = error || data?.message || response.statusText;
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertSupportedModel(model) {
  if (!MODELS.has(model)) {
    throw new Error(`Unsupported model: ${model}. Supported models: ${[...MODELS].join(", ")}`);
  }
}

async function buildRequest(args) {
  let request = {};
  if (args.requestJson) {
    try {
      request = JSON.parse(args.requestJson);
    } catch (error) {
      throw new Error(`Invalid --request-json: ${error.message}`);
    }
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("--request-json must contain a JSON object");
    }
  }

  const content = Array.isArray(request.content) ? [...request.content] : [];
  if (args.prompt !== undefined) {
    const textItem = content.find((item) => item?.type === "text");
    if (textItem) {
      textItem.text = args.prompt;
    } else {
      content.unshift({ type: "text", text: args.prompt });
    }
  }
  if (!content.some((item) => item?.type === "text" && String(item.text || "").trim())) {
    throw new Error("Missing prompt. Provide --prompt or a text item in --request-json.");
  }

  const imageCount = content.filter((item) => item?.type === "image_url").length + args.images.length;
  const videoCount = content.filter((item) => item?.type === "video_url").length + args.videos.length;
  if (imageCount > MAX_IMAGE_REFERENCES) throw new Error(`At most ${MAX_IMAGE_REFERENCES} reference images are allowed`);
  if (videoCount > MAX_VIDEO_REFERENCES) throw new Error(`At most ${MAX_VIDEO_REFERENCES} reference videos are allowed`);

  for (const { kind, source } of args.media) {
    const url = await resolveMediaSource(source, kind, args);
    content.push(kind === "image"
      ? { type: "image_url", image_url: { url }, role: "reference_image" }
      : { type: "video_url", video_url: { url }, role: "reference_video" });
  }
  const inlineBytes = content.reduce((total, item) => {
    const value = item?.image_url?.url || item?.video_url?.url;
    return total + dataUrlDecodedBytes(value);
  }, 0);
  if (inlineBytes > DEFAULT_MAX_TOTAL_MEDIA_BYTES) {
    throw new Error(`Inline reference media exceeds ${DEFAULT_MAX_TOTAL_MEDIA_BYTES} bytes in total`);
  }

  request = { ...request, model: args.model, content };
  if (args.duration !== undefined) request.duration = args.duration;
  if (args.ratio !== undefined) request.ratio = args.ratio;
  if (args.size !== undefined) request.size = args.size;
  return request;
}

function dataUrlDecodedBytes(value) {
  if (typeof value !== "string" || !/^data:/i.test(value)) return 0;
  const comma = value.indexOf(",");
  if (comma < 0 || !/;base64$/i.test(value.slice(0, comma))) return 0;
  const payload = value.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
}

async function resolveMediaSource(source, kind, args) {
  if (/^(?:https?:|asset:)/i.test(source)) {
    return source;
  }
  if (/^data:/i.test(source)) {
    if (kind === "image") return source;
    return videoDataUrl(source, args.maxMediaBytes).value;
  }

  const filePath = resolve(process.cwd(), source);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`Media file does not exist: ${source}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`Media source is not a file: ${source}`);
  }

  const mime = mimeForFile(filePath, kind);
  if (kind === "video") {
    const extension = extname(filePath).toLowerCase();
    if (!SUPPORTED_VIDEO_EXTENSIONS.has(extension) || !SUPPORTED_VIDEO_MIMES.has(mime)) {
      throw new Error(`Local video must be MP4, MOV, or WebM: ${source}`);
    }
  }
  if (args.uploadCommand) {
    return runUploader(args.uploadCommand, filePath, mime, kind);
  }
  if (fileStat.size > args.maxMediaBytes) {
    throw new Error(
      `Local ${kind} is ${fileStat.size} bytes, above --max-media-bytes ${args.maxMediaBytes}.`,
    );
  }

  if (kind === "video") {
    const bytes = await readFile(filePath);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  const bytes = await readFile(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function videoDataUrl(value, maxBytes) {
  const comma = value.indexOf(",");
  const header = comma >= 0 ? value.slice(0, comma) : "";
  const payload = comma >= 0 ? value.slice(comma + 1) : "";
  const match = /^data:(video\/(?:mp4|quicktime|webm));base64$/i.exec(header);
  if (!match || !payload || payload.length % 4 === 1 || payload.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error(`Video data URL must be Base64 MP4, MOV, or WebM up to ${maxBytes} bytes`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new Error("Video data URL contains invalid Base64");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = Math.floor(payload.length * 3 / 4) - padding;
  if (bytes > maxBytes) throw new Error(`Video data URL exceeds --max-media-bytes ${maxBytes}`);
  const mime = match[1].toLowerCase();
  return { bytes, mime, extension: mime === "video/quicktime" ? "mov" : mime.slice("video/".length), value: `data:${mime};base64,${payload}` };
}

function mimeForFile(filePath, kind) {
  return MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ||
    (kind === "image" ? "image/png" : "video/mp4");
}

async function runUploader(command, filePath, mime, kind) {
  const child = spawn(command, [filePath, mime, kind], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const output = [];
  let outputBytes = 0;
  child.stdout.on("data", (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes <= 1024 * 1024) output.push(chunk);
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`Uploader exited with code ${code}: ${command}`);
  }
  const url = Buffer.concat(output).toString("utf8").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Uploader must print one http(s) URL to stdout");
  }
  return url;
}

async function pollVideo({ baseUrl, key, taskId, pollIntervalSeconds, timeoutSeconds }) {
  const started = Date.now();
  let latest = null;
  let attempt = 0;
  while (Date.now() - started < timeoutSeconds * 1000) {
    attempt += 1;
    latest = await requestJson(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, { key });
    const status = String(latest?.status || latest?.data?.status || "").toLowerCase();
    log("poll", { task_id: taskId, attempt, status: status || "unknown" });
    if (["completed", "succeeded", "success", "failed", "cancelled", "canceled"].includes(status)) {
      return latest;
    }
    await sleep(pollIntervalSeconds * 1000);
  }
  throw new Error(`Timed out waiting for video task: ${taskId}`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function taskIdFromResponse(response) {
  return response?.id || response?.task_id || response?.data?.id || response?.data?.task_id;
}

function videoUrlFromResponse(response) {
  const candidates = [
    response?.metadata?.url,
    response?.metadata?.video_url,
    response?.video_url,
    response?.url,
    response?.output?.video_url,
    response?.output?.url,
    response?.data?.video_url,
    response?.data?.url,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

function resolveVideoUrl(videoUrl, baseUrl) {
  return new URL(videoUrl, `${baseUrl}/`).toString();
}

function shouldSendDownloadAuth(videoUrl, baseUrl) {
  try {
    const target = new URL(videoUrl);
    const base = new URL(baseUrl);
    return target.origin === base.origin && target.pathname.startsWith("/v1/videos/");
  } catch {
    return false;
  }
}

async function fetchVideoResponse(videoUrl, baseUrl, key) {
  const resolvedUrl = resolveVideoUrl(videoUrl, baseUrl);
  const headers = { Accept: "video/*,application/octet-stream;q=0.9,*/*;q=0.1" };
  if (shouldSendDownloadAuth(resolvedUrl, baseUrl)) headers.Authorization = authHeader(key);
  const response = await fetch(resolvedUrl, { headers });
  if (!response.ok) {
    throw new Error(`Video fetch failed with HTTP ${response.status}: ${resolvedUrl}`);
  }
  if (!response.body) throw new Error(`Video response body is empty: ${resolvedUrl}`);
  return { response, resolvedUrl };
}

async function downloadVideo(videoUrl, baseUrl, key, taskId, directory) {
  const { response, resolvedUrl } = await fetchVideoResponse(videoUrl, baseUrl, key);
  await mkdir(directory, { recursive: true });
  const extension = extensionForVideo(resolvedUrl, response.headers.get("content-type"));
  const finalPath = join(directory, `${safeName(taskId)}${extension}`);
  const tempPath = `${finalPath}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath, { flags: "wx" }));
    await rename(tempPath, finalPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  const fileStat = await stat(finalPath);
  return { path: finalPath, bytes: fileStat.size };
}

async function videoBase64(videoUrl, baseUrl, key) {
  const { response, resolvedUrl } = await fetchVideoResponse(videoUrl, baseUrl, key);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_BASE64_BYTES) {
    throw new Error(`Video is larger than ${DEFAULT_MAX_BASE64_BYTES} bytes; refuse --base64 output`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > DEFAULT_MAX_BASE64_BYTES) {
    throw new Error(`Video is larger than ${DEFAULT_MAX_BASE64_BYTES} bytes; refuse --base64 output`);
  }
  log("base64", { url: resolvedUrl, bytes: buffer.length });
  return buffer.toString("base64");
}

function extensionForVideo(videoUrl, contentType) {
  const type = String(contentType || "").split(";", 1)[0].toLowerCase();
  const byType = new Map([
    ["video/webm", ".webm"],
    ["video/quicktime", ".mov"],
    ["video/x-m4v", ".m4v"],
  ]);
  if (byType.has(type)) return byType.get(type);
  try {
    const extension = extname(new URL(videoUrl).pathname).toLowerCase();
    if (/^\.(mp4|webm|mov|m4v|avi|mkv)$/.test(extension)) return extension;
  } catch {
    // Fall through to the safe default.
  }
  return ".mp4";
}

function safeName(value) {
  return basename(String(value)).replace(/[^a-zA-Z0-9._-]+/g, "_") || "video";
}

async function main() {
  await loadTuziEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.configPath) {
    process.stdout.write(`${globalConfigPath()}\n`);
    return;
  }
  if (args.clearConfig) {
    await clearGlobalConfig();
    return;
  }
  if (args.configure) {
    await configureGlobalConfig(args);
    return;
  }
  assertSupportedModel(args.model);
  if (args.pollIntervalSeconds < MIN_POLL_INTERVAL_SECONDS) {
    throw new Error(`--poll-interval must be at least ${MIN_POLL_INTERVAL_SECONDS} seconds`);
  }
  const { url: baseUrl, key } = await resolveConnection(args);
  if (args.preflight) {
    await requestJson(`${baseUrl}/v1/models`, { key });
  }
  const request = await buildRequest(args);
  log("create.start", { url: `${baseUrl}/v1/videos`, model: args.model });
  const created = await requestJson(`${baseUrl}/v1/videos`, {
    method: "POST",
    key,
    body: request,
    timeoutMs: Math.min(args.timeoutSeconds * 1000, 120000),
  });
  const taskId = taskIdFromResponse(created);
  if (!taskId) throw new Error("Video create response did not contain a task id");
  log("create.done", { task_id: taskId, model: args.model });

  const finalResponse = await pollVideo({
    baseUrl,
    key,
    taskId,
    pollIntervalSeconds: args.pollIntervalSeconds,
    timeoutSeconds: args.timeoutSeconds,
  });
  const status = String(finalResponse?.status || finalResponse?.data?.status || "unknown").toLowerCase();
  const videoUrl = videoUrlFromResponse(finalResponse);
  const result = { task_id: taskId, model: args.model, status, video_url: videoUrl };

  if (["failed", "cancelled", "canceled"].includes(status)) {
    result.error = finalResponse?.error || finalResponse?.message || null;
  }
  if (videoUrl && args.download) {
    const directory = resolve(args.downloadDir || "./doubao-seedance-output");
    result.download = await downloadVideo(videoUrl, baseUrl, key, taskId, directory);
  }
  if (videoUrl && args.base64) {
    result.video_base64 = await videoBase64(videoUrl, baseUrl, key);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!videoUrl && status === "completed") {
    throw new Error("Video task completed but no video URL was found in the response");
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
