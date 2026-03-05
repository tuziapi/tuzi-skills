import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import type { CliArgs, Provider, ExtendConfig } from "./types";

function printUsage(): void {
  console.log(`用法:
  npx -y bun scripts/main.ts --prompt "一只猫" --image cat.png
  npx -y bun scripts/main.ts --prompt "风景画" --image landscape.png --ar 16:9
  npx -y bun scripts/main.ts --promptfiles system.md content.md --image out.png

选项:
  -p, --prompt <text>       提示词文本
  --promptfiles <files...>  从文件读取提示词（多文件拼接）
  --image <path>            输出图片路径（必填）
  --provider tuzi|google|openai|dashscope|replicate  指定服务商（默认自动检测）
  -m, --model <id>          模型 ID
  --ar <ratio>              宽高比（如 16:9、1:1、4:3）
  --size <WxH>              尺寸（如 1024x1024）
  --quality normal|2k       质量预设（默认: 2k）
  --imageSize 1K|2K|4K      图片尺寸（默认: 由 quality 决定）
  --ref <files...>          参考图片
  --n <count>               生成数量（默认: 1）
  --json                    JSON 输出
  -h, --help                显示帮助

环境变量:
  TUZI_API_KEY              Tuzi API 密钥（https://api.tu-zi.com）
  TUZI_IMAGE_MODEL          Tuzi 默认模型（gemini-3-pro-image-preview）
  TUZI_BASE_URL             自定义 Tuzi 端点
  OPENAI_API_KEY            OpenAI API 密钥
  GOOGLE_API_KEY            Google API 密钥
  GEMINI_API_KEY            Gemini API 密钥（GOOGLE_API_KEY 别名）
  DASHSCOPE_API_KEY         DashScope API 密钥（阿里云通义万象）
  REPLICATE_API_TOKEN       Replicate API 令牌
  OPENAI_IMAGE_MODEL        OpenAI 默认模型（gpt-image-1.5）
  GOOGLE_IMAGE_MODEL        Google 默认模型（gemini-3-pro-image-preview）
  DASHSCOPE_IMAGE_MODEL     DashScope 默认模型（z-image-turbo）
  REPLICATE_IMAGE_MODEL     Replicate 默认模型（google/nano-banana-pro）
  OPENAI_BASE_URL           自定义 OpenAI 端点
  OPENAI_IMAGE_USE_CHAT     使用 /chat/completions 替代 /images/generations（true|false）
  GOOGLE_BASE_URL           自定义 Google 端点
  DASHSCOPE_BASE_URL        自定义 DashScope 端点
  REPLICATE_BASE_URL        自定义 Replicate 端点

加载优先级: 命令行参数 > EXTEND.md > 环境变量 > <cwd>/.tuzi-skills/.env > ~/.tuzi-skills/.env`);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    prompt: null,
    promptFiles: [],
    imagePath: null,
    provider: null,
    model: null,
    aspectRatio: null,
    size: null,
    quality: null,
    imageSize: null,
    referenceImages: [],
    n: 1,
    json: false,
    help: false,
  };

  const positional: string[] = [];

  const takeMany = (i: number): { items: string[]; next: number } => {
    const items: string[] = [];
    let j = i + 1;
    while (j < argv.length) {
      const v = argv[j]!;
      if (v.startsWith("-")) break;
      items.push(v);
      j++;
    }
    return { items, next: j - 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }

    if (a === "--json") {
      out.json = true;
      continue;
    }

    if (a === "--prompt" || a === "-p") {
      const v = argv[++i];
      if (!v) throw new Error(`缺少 ${a} 的值`);
      out.prompt = v;
      continue;
    }

    if (a === "--promptfiles") {
      const { items, next } = takeMany(i);
      if (items.length === 0) throw new Error("--promptfiles 缺少文件参数");
      out.promptFiles.push(...items);
      i = next;
      continue;
    }

    if (a === "--image") {
      const v = argv[++i];
      if (!v) throw new Error("缺少 --image 的值");
      out.imagePath = v;
      continue;
    }

    if (a === "--provider") {
      const v = argv[++i];
      if (v !== "google" && v !== "openai" && v !== "dashscope" && v !== "replicate" && v !== "tuzi") throw new Error(`无效的服务商: ${v}`);
      out.provider = v;
      continue;
    }

    if (a === "--model" || a === "-m") {
      const v = argv[++i];
      if (!v) throw new Error(`缺少 ${a} 的值`);
      out.model = v;
      continue;
    }

    if (a === "--ar") {
      const v = argv[++i];
      if (!v) throw new Error("缺少 --ar 的值");
      out.aspectRatio = v;
      continue;
    }

    if (a === "--size") {
      const v = argv[++i];
      if (!v) throw new Error("缺少 --size 的值");
      out.size = v;
      continue;
    }

    if (a === "--quality") {
      const v = argv[++i];
      if (v !== "normal" && v !== "2k") throw new Error(`无效的质量参数: ${v}`);
      out.quality = v;
      continue;
    }

    if (a === "--imageSize") {
      const v = argv[++i]?.toUpperCase();
      if (v !== "1K" && v !== "2K" && v !== "4K") throw new Error(`无效的图片尺寸: ${v}`);
      out.imageSize = v;
      continue;
    }

    if (a === "--ref" || a === "--reference") {
      const { items, next } = takeMany(i);
      if (items.length === 0) throw new Error(`缺少 ${a} 的文件参数`);
      out.referenceImages.push(...items);
      i = next;
      continue;
    }

    if (a === "--n") {
      const v = argv[++i];
      if (!v) throw new Error("缺少 --n 的值");
      out.n = parseInt(v, 10);
      if (isNaN(out.n) || out.n < 1) throw new Error(`无效的数量: ${v}`);
      continue;
    }

    if (a.startsWith("-")) {
      throw new Error(`未知选项: ${a}`);
    }

    positional.push(a);
  }

  if (!out.prompt && out.promptFiles.length === 0 && positional.length > 0) {
    out.prompt = positional.join(" ");
  }

  return out;
}

async function loadEnvFile(p: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(p, "utf8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

async function loadEnv(): Promise<void> {
  const home = homedir();
  const cwd = process.cwd();

  const homeEnv = await loadEnvFile(path.join(home, ".tuzi-skills", ".env"));
  const cwdEnv = await loadEnvFile(path.join(cwd, ".tuzi-skills", ".env"));

  for (const [k, v] of Object.entries(homeEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }
  for (const [k, v] of Object.entries(cwdEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

function extractYamlFrontMatter(content: string): string | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*$/m);
  return match ? match[1] : null;
}

function parseSimpleYaml(yaml: string): Partial<ExtendConfig> {
  const config: Partial<ExtendConfig> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.includes(":") && !trimmed.startsWith("-")) {
      const colonIdx = trimmed.indexOf(":");
      const key = trimmed.slice(0, colonIdx).trim();
      let value = trimmed.slice(colonIdx + 1).trim();

      if (value === "null" || value === "") {
        value = "null";
      }

      if (key === "version") {
        config.version = value === "null" ? 1 : parseInt(value, 10);
      } else if (key === "default_provider") {
        config.default_provider = value === "null" ? null : (value as Provider);
      } else if (key === "default_quality") {
        config.default_quality = value === "null" ? null : (value as "normal" | "2k");
      } else if (key === "default_aspect_ratio") {
        const cleaned = value.replace(/['"]/g, "");
        config.default_aspect_ratio = cleaned === "null" ? null : cleaned;
      } else if (key === "default_image_size") {
        config.default_image_size = value === "null" ? null : (value as "1K" | "2K" | "4K");
      } else if (key === "default_model") {
        config.default_model = { google: null, openai: null, dashscope: null, replicate: null, tuzi: null };
        currentKey = "default_model";
      } else if (currentKey === "default_model" && (key === "google" || key === "openai" || key === "dashscope" || key === "replicate" || key === "tuzi")) {
        const cleaned = value.replace(/['"]/g, "");
        config.default_model![key] = cleaned === "null" ? null : cleaned;
      }
    }
  }

  return config;
}

async function loadExtendConfig(): Promise<Partial<ExtendConfig>> {
  const home = homedir();
  const cwd = process.cwd();

  const paths = [
    path.join(cwd, ".tuzi-skills", "tuzi-image-gen", "EXTEND.md"),
    path.join(home, ".tuzi-skills", "tuzi-image-gen", "EXTEND.md"),
  ];

  for (const p of paths) {
    try {
      const content = await readFile(p, "utf8");
      const yaml = extractYamlFrontMatter(content);
      if (!yaml) continue;

      return parseSimpleYaml(yaml);
    } catch {
      continue;
    }
  }

  return {};
}

function mergeConfig(args: CliArgs, extend: Partial<ExtendConfig>): CliArgs {
  return {
    ...args,
    provider: args.provider ?? extend.default_provider ?? null,
    quality: args.quality ?? extend.default_quality ?? null,
    aspectRatio: args.aspectRatio ?? extend.default_aspect_ratio ?? null,
    imageSize: args.imageSize ?? extend.default_image_size ?? null,
  };
}

async function readPromptFromFiles(files: string[]): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    parts.push(await readFile(f, "utf8"));
  }
  return parts.join("\n\n");
}

async function readPromptFromStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  try {
    const t = await Bun.stdin.text();
    const v = t.trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function normalizeOutputImagePath(p: string): string {
  const full = path.resolve(p);
  const ext = path.extname(full);
  if (ext) return full;
  return `${full}.png`;
}

function detectProvider(args: CliArgs): Provider {
  if (args.referenceImages.length > 0 && args.provider && args.provider !== "google" && args.provider !== "openai" && args.provider !== "replicate" && args.provider !== "tuzi") {
    throw new Error(
      "参考图片需要支持该功能的服务商。请使用 --provider google（Gemini 多模态）、--provider openai（GPT Image 编辑）、--provider replicate 或 --provider tuzi。"
    );
  }

  if (args.provider) return args.provider;

  const hasGoogle = !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  const hasOpenai = !!process.env.OPENAI_API_KEY;
  const hasDashscope = !!process.env.DASHSCOPE_API_KEY;
  const hasReplicate = !!process.env.REPLICATE_API_TOKEN;
  const hasTuzi = !!process.env.TUZI_API_KEY;

  if (args.referenceImages.length > 0) {
    if (hasTuzi) return "tuzi";
    if (hasGoogle) return "google";
    if (hasOpenai) return "openai";
    if (hasReplicate) return "replicate";
    throw new Error(
      "参考图片需要 Tuzi、Google、OpenAI 或 Replicate。请设置 TUZI_API_KEY、GOOGLE_API_KEY/GEMINI_API_KEY、OPENAI_API_KEY 或 REPLICATE_API_TOKEN，或移除 --ref。"
    );
  }

  const available = [hasTuzi && "tuzi", hasGoogle && "google", hasOpenai && "openai", hasDashscope && "dashscope", hasReplicate && "replicate"].filter(Boolean) as Provider[];

  if (available.length === 1) return available[0]!;
  if (available.length > 1) return available[0]!;

  throw new Error(
    "未找到 API 密钥。请设置 TUZI_API_KEY、GOOGLE_API_KEY、GEMINI_API_KEY、OPENAI_API_KEY、DASHSCOPE_API_KEY 或 REPLICATE_API_TOKEN。\n" +
      "在 ~/.tuzi-skills/.env 或 <cwd>/.tuzi-skills/.env 中配置密钥。"
  );
}

async function validateReferenceImages(referenceImages: string[]): Promise<void> {
  for (const refPath of referenceImages) {
    const fullPath = path.resolve(refPath);
    try {
      await access(fullPath);
    } catch {
      throw new Error(`参考图片未找到: ${fullPath}`);
    }
  }
}

type ProviderModule = {
  getDefaultModel: () => string;
  generateImage: (prompt: string, model: string, args: CliArgs) => Promise<Uint8Array>;
};

function isRetryableGenerationError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const nonRetryableMarkers = [
    "Reference image",
    "not supported",
    "only supported",
    "No API key found",
    "is required",
  ];
  return !nonRetryableMarkers.some((marker) => msg.includes(marker));
}

async function loadProviderModule(provider: Provider): Promise<ProviderModule> {
  if (provider === "google") {
    return (await import("./providers/google")) as ProviderModule;
  }
  if (provider === "dashscope") {
    return (await import("./providers/dashscope")) as ProviderModule;
  }
  if (provider === "replicate") {
    return (await import("./providers/replicate")) as ProviderModule;
  }
  if (provider === "tuzi") {
    return (await import("./providers/tuzi")) as ProviderModule;
  }
  return (await import("./providers/openai")) as ProviderModule;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  await loadEnv();
  const extendConfig = await loadExtendConfig();
  const mergedArgs = mergeConfig(args, extendConfig);

  if (!mergedArgs.quality) mergedArgs.quality = "2k";

  let prompt: string | null = mergedArgs.prompt;
  if (!prompt && mergedArgs.promptFiles.length > 0) prompt = await readPromptFromFiles(mergedArgs.promptFiles);
  if (!prompt) prompt = await readPromptFromStdin();

  if (!prompt) {
    console.error("错误: 提示词不能为空");
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!mergedArgs.imagePath) {
    console.error("错误: --image 参数必填");
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (mergedArgs.referenceImages.length > 0) {
    await validateReferenceImages(mergedArgs.referenceImages);
  }

  const provider = detectProvider(mergedArgs);
  const providerModule = await loadProviderModule(provider);

  let model = mergedArgs.model;
  if (!model && extendConfig.default_model) {
    if (provider === "google") model = extendConfig.default_model.google ?? null;
    if (provider === "openai") model = extendConfig.default_model.openai ?? null;
    if (provider === "dashscope") model = extendConfig.default_model.dashscope ?? null;
    if (provider === "replicate") model = extendConfig.default_model.replicate ?? null;
    if (provider === "tuzi") model = extendConfig.default_model.tuzi ?? null;
  }
  model = model || providerModule.getDefaultModel();

  const outputPath = normalizeOutputImagePath(mergedArgs.imagePath);

  let imageData: Uint8Array;
  let retried = false;

  while (true) {
    try {
      imageData = await providerModule.generateImage(prompt, model, mergedArgs);
      break;
    } catch (e) {
      if (!retried && isRetryableGenerationError(e)) {
        retried = true;
        console.error("生成失败，正在重试...");
        continue;
      }
      throw e;
    }
  }

  const dir = path.dirname(outputPath);
  await mkdir(dir, { recursive: true });
  await writeFile(outputPath, imageData);

  if (mergedArgs.json) {
    console.log(
      JSON.stringify(
        {
          savedImage: outputPath,
          provider,
          model,
          prompt: prompt.slice(0, 200),
        },
        null,
        2
      )
    );
  } else {
    console.log(outputPath);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
