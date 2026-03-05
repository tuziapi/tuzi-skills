import { createInterface } from "node:readline";
import { writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { CdpConnection, getFreePort, launchChrome, waitForChromeDebugPort, waitForNetworkIdle, waitForPageLoad, autoScroll, evaluateScript, killChrome } from "./cdp.js";
import { absolutizeUrlsScript, extractContent, createMarkdownDocument, type ConversionResult } from "./html-to-markdown.js";
import { localizeMarkdownMedia, countRemoteMedia } from "./media-localizer.js";
import { resolveUrlToMarkdownDataDir } from "./paths.js";
import { DEFAULT_TIMEOUT_MS, CDP_CONNECT_TIMEOUT_MS, NETWORK_IDLE_TIMEOUT_MS, POST_LOAD_DELAY_MS, SCROLL_STEP_WAIT_MS, SCROLL_MAX_STEPS } from "./constants.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface Args {
  url: string;
  output?: string;
  wait: boolean;
  timeout: number;
  downloadMedia: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { url: "", wait: false, timeout: DEFAULT_TIMEOUT_MS, downloadMedia: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--wait" || arg === "-w") {
      args.wait = true;
    } else if (arg === "-o" || arg === "--output") {
      args.output = argv[++i];
    } else if (arg === "--timeout" || arg === "-t") {
      args.timeout = parseInt(argv[++i], 10) || DEFAULT_TIMEOUT_MS;
    } else if (arg === "--download-media") {
      args.downloadMedia = true;
    } else if (!arg.startsWith("-") && !args.url) {
      args.url = arg;
    }
  }
  return args;
}

function generateSlug(title: string, url: string): string {
  const text = title || new URL(url).pathname.replace(/\//g, "-");
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "page";
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function generateOutputPath(url: string, title: string): Promise<string> {
  const domain = new URL(url).hostname.replace(/^www\./, "");
  const slug = generateSlug(title, url);
  const dataDir = resolveUrlToMarkdownDataDir();
  const basePath = path.join(dataDir, domain, `${slug}.md`);

  if (!(await fileExists(basePath))) {
    return basePath;
  }

  const timestampSlug = `${slug}-${formatTimestamp()}`;
  return path.join(dataDir, domain, `${timestampSlug}.md`);
}

async function waitForUserSignal(): Promise<void> {
  console.log("页面已打开。准备好后按回车键开始抓取...");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.once("line", () => { rl.close(); resolve(); });
  });
}

async function captureUrl(args: Args): Promise<ConversionResult> {
  const port = await getFreePort();
  const chrome = await launchChrome(args.url, port, false);

  let cdp: CdpConnection | null = null;
  try {
    const wsUrl = await waitForChromeDebugPort(port, 30_000);
    cdp = await CdpConnection.connect(wsUrl, CDP_CONNECT_TIMEOUT_MS);

    const targets = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>("Target.getTargets");
    const pageTarget = targets.targetInfos.find(t => t.type === "page" && t.url.startsWith("http"));
    if (!pageTarget) throw new Error("未找到页面目标");

    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
    await cdp.send("Network.enable", {}, { sessionId });
    await cdp.send("Page.enable", {}, { sessionId });

    if (args.wait) {
      await waitForUserSignal();
    } else {
      console.log("正在等待页面加载...");
      await Promise.race([
        waitForPageLoad(cdp, sessionId, 15_000),
        sleep(8_000)
      ]);
      await waitForNetworkIdle(cdp, sessionId, NETWORK_IDLE_TIMEOUT_MS);
      await sleep(POST_LOAD_DELAY_MS);
      console.log("正在滚动页面以触发懒加载...");
      await autoScroll(cdp, sessionId, SCROLL_MAX_STEPS, SCROLL_STEP_WAIT_MS);
      await sleep(POST_LOAD_DELAY_MS);
    }

    console.log("正在抓取页面内容...");
    const { html } = await evaluateScript<{ html: string }>(
      cdp, sessionId, absolutizeUrlsScript, args.timeout
    );

    return await extractContent(html, args.url);
  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close", {}, { timeoutMs: 5_000 }); } catch {}
      cdp.close();
    }
    killChrome(chrome);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args.url) {
    console.error("用法: bun main.ts <url> [-o output.md] [--wait] [--timeout ms]");
    process.exit(1);
  }

  try {
    new URL(args.url);
  } catch {
    console.error(`无效的 URL: ${args.url}`);
    process.exit(1);
  }

  console.log(`正在获取: ${args.url}`);
  console.log(`模式: ${args.wait ? "等待用户" : "自动"}`);

  const result = await captureUrl(args);
  const outputPath = args.output || await generateOutputPath(args.url, result.metadata.title);
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  let document = createMarkdownDocument(result);

  if (args.downloadMedia) {
    const mediaResult = await localizeMarkdownMedia(document, {
      markdownPath: outputPath,
      log: console.log,
    });
    document = mediaResult.markdown;
    if (mediaResult.downloadedImages > 0 || mediaResult.downloadedVideos > 0) {
      console.log(`已下载: ${mediaResult.downloadedImages} 张图片, ${mediaResult.downloadedVideos} 个视频`);
    }
  } else {
    const { images, videos } = countRemoteMedia(document);
    if (images > 0 || videos > 0) {
      console.log(`发现远程媒体: ${images} 张图片, ${videos} 个视频`);
    }
  }

  await writeFile(outputPath, document, "utf-8");

  console.log(`已保存: ${outputPath}`);
  console.log(`标题: ${result.metadata.title || "(无标题)"}`);
}

main().catch((err) => {
  console.error("错误:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
