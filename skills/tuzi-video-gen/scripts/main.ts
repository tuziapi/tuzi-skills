import path from "node:path"
import process from "node:process"
import { homedir } from "node:os"
import { access, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import type { CliArgs, ExtendConfig } from "./types"

function printUsage(): void {
  console.log(`用法:
  npx -y bun scripts/main.ts --prompt "一只猫在走路" --video cat.mp4
  npx -y bun scripts/main.ts --promptfiles prompt.md --video out.mp4 --model veo3
  npx -y bun scripts/main.ts --prompt "..." --video long.mp4 --segments 3

选项:
  -p, --prompt <text>              提示词文本
  --promptfiles <files...>         从文件读取提示词（多文件拼接）
  --video <path>                   输出视频路径（必填）
  -m, --model <id>                 模型 ID（默认 veo3.1）
  -s, --seconds <n>                时长（秒）
  --size <WxH>                     尺寸（如 1280x720、16x9）
  --ref <files...>                 参考图片
  --ref-mode reference|frames|components  参考图模式
  --segments <n>                   长视频段数
  --segment-prompts <files...>     每段独立提示词文件
  --json                           JSON 输出
  -h, --help                       显示帮助

环境变量:
  TUZI_API_KEY                     Tuzi API 密钥（https://api.tu-zi.com）
  TUZI_VIDEO_MODEL                 默认视频模型（veo3.1）
  TUZI_BASE_URL                    自定义 Tuzi 端点

加载优先级: 命令行参数 > EXTEND.md > 环境变量 > <cwd>/.tuzi-skills/.env > ~/.tuzi-skills/.env`)
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    prompt: null,
    promptFiles: [],
    videoPath: null,
    model: null,
    seconds: null,
    size: null,
    referenceImages: [],
    refMode: null,
    segments: null,
    segmentPrompts: [],
    json: false,
    help: false,
  }

  const positional: string[] = []

  const takeMany = (i: number): { items: string[]; next: number } => {
    const items: string[] = []
    let j = i + 1
    while (j < argv.length) {
      const v = argv[j]!
      if (v.startsWith("-")) break
      items.push(v)
      j++
    }
    return { items, next: j - 1 }
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!

    if (a === "--help" || a === "-h") { out.help = true; continue }
    if (a === "--json") { out.json = true; continue }

    if (a === "--prompt" || a === "-p") {
      const v = argv[++i]
      if (!v) throw new Error(`缺少 ${a} 的值`)
      out.prompt = v
      continue
    }

    if (a === "--promptfiles") {
      const { items, next } = takeMany(i)
      if (items.length === 0) throw new Error("--promptfiles 缺少文件参数")
      out.promptFiles.push(...items)
      i = next
      continue
    }

    if (a === "--video") {
      const v = argv[++i]
      if (!v) throw new Error("缺少 --video 的值")
      out.videoPath = v
      continue
    }

    if (a === "--model" || a === "-m") {
      const v = argv[++i]
      if (!v) throw new Error(`缺少 ${a} 的值`)
      out.model = v
      continue
    }

    if (a === "--seconds" || a === "-s") {
      const v = argv[++i]
      if (!v) throw new Error(`缺少 ${a} 的值`)
      out.seconds = v
      continue
    }

    if (a === "--size") {
      const v = argv[++i]
      if (!v) throw new Error("缺少 --size 的值")
      out.size = v
      continue
    }

    if (a === "--ref" || a === "--reference") {
      const { items, next } = takeMany(i)
      if (items.length === 0) throw new Error(`缺少 ${a} 的文件参数`)
      out.referenceImages.push(...items)
      i = next
      continue
    }

    if (a === "--ref-mode") {
      const v = argv[++i]
      if (v !== "reference" && v !== "frames" && v !== "components") throw new Error(`无效的 ref-mode: ${v}`)
      out.refMode = v
      continue
    }

    if (a === "--segments") {
      const v = argv[++i]
      if (!v) throw new Error("缺少 --segments 的值")
      out.segments = parseInt(v, 10)
      if (isNaN(out.segments) || out.segments < 2) throw new Error(`无效的段数: ${v}（最少 2 段）`)
      continue
    }

    if (a === "--segment-prompts") {
      const { items, next } = takeMany(i)
      if (items.length === 0) throw new Error("--segment-prompts 缺少文件参数")
      out.segmentPrompts.push(...items)
      i = next
      continue
    }

    if (a.startsWith("-")) throw new Error(`未知选项: ${a}`)
    positional.push(a)
  }

  if (!out.prompt && out.promptFiles.length === 0 && positional.length > 0) {
    out.prompt = positional.join(" ")
  }

  return out
}

async function loadEnvFile(p: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(p, "utf8")
    const env: Record<string, string> = {}
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const idx = trimmed.indexOf("=")
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      env[key] = val
    }
    return env
  } catch {
    return {}
  }
}

async function loadEnv(): Promise<void> {
  const home = homedir()
  const cwd = process.cwd()
  const homeEnv = await loadEnvFile(path.join(home, ".tuzi-skills", ".env"))
  const cwdEnv = await loadEnvFile(path.join(cwd, ".tuzi-skills", ".env"))
  for (const [k, v] of Object.entries(homeEnv)) {
    if (!process.env[k]) process.env[k] = v
  }
  for (const [k, v] of Object.entries(cwdEnv)) {
    if (!process.env[k]) process.env[k] = v
  }
}

function extractYamlFrontMatter(content: string): string | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*$/m)
  return match ? match[1] : null
}

function parseSimpleYaml(yaml: string): Partial<ExtendConfig> {
  const config: Partial<ExtendConfig> = {}
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let value = trimmed.slice(colonIdx + 1).trim()
    if (value === "null" || value === "") value = "null"
    if (key === "version") config.version = value === "null" ? 1 : parseInt(value, 10)
    else if (key === "default_model") config.default_model = value === "null" ? null : value
    else if (key === "default_seconds") config.default_seconds = value === "null" ? null : value
    else if (key === "default_size") config.default_size = value === "null" ? null : value
  }
  return config
}

async function loadExtendConfig(): Promise<Partial<ExtendConfig>> {
  const home = homedir()
  const cwd = process.cwd()
  const paths = [
    path.join(cwd, ".tuzi-skills", "tuzi-video-gen", "EXTEND.md"),
    path.join(home, ".tuzi-skills", "tuzi-video-gen", "EXTEND.md"),
  ]
  for (const p of paths) {
    try {
      const content = await readFile(p, "utf8")
      const yaml = extractYamlFrontMatter(content)
      if (!yaml) continue
      return parseSimpleYaml(yaml)
    } catch {
      continue
    }
  }
  return {}
}

function mergeConfig(args: CliArgs, extend: Partial<ExtendConfig>): CliArgs {
  return {
    ...args,
    model: args.model ?? extend.default_model ?? null,
    seconds: args.seconds ?? extend.default_seconds ?? null,
    size: args.size ?? extend.default_size ?? null,
  }
}

async function readPromptFromFiles(files: string[]): Promise<string> {
  const parts: string[] = []
  for (const f of files) {
    parts.push(await readFile(f, "utf8"))
  }
  return parts.join("\n\n")
}

async function readPromptFromStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null
  try {
    const t = await Bun.stdin.text()
    const v = t.trim()
    return v.length > 0 ? v : null
  } catch {
    return null
  }
}

function normalizeOutputPath(p: string): string {
  const full = path.resolve(p)
  const ext = path.extname(full)
  if (ext) return full
  return `${full}.mp4`
}

async function validateReferenceImages(refs: string[]): Promise<void> {
  for (const r of refs) {
    try {
      await access(path.resolve(r))
    } catch {
      throw new Error(`参考图片未找到: ${path.resolve(r)}`)
    }
  }
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

async function extractLastFrame(videoPath: string, outputPath: string): Promise<void> {
  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-sseof", "-0.1", "-i", videoPath, "-frames:v", "1", outputPath],
    { stdout: "pipe", stderr: "pipe" }
  )
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`ffmpeg 提取尾帧失败: ${err}`)
  }
}

async function concatVideos(segments: string[], outputPath: string): Promise<void> {
  const tmpDir = path.dirname(outputPath)
  const listFile = path.join(tmpDir, ".concat-list.txt")
  const lines = segments.map((s) => `file '${s}'`).join("\n")
  await writeFile(listFile, lines)

  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath],
    { stdout: "pipe", stderr: "pipe" }
  )
  const exitCode = await proc.exited
  await rm(listFile, { force: true })
  if (exitCode !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`ffmpeg 合并失败: ${err}`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  await loadEnv()
  const extendConfig = await loadExtendConfig()
  const mergedArgs = mergeConfig(args, extendConfig)

  let prompt: string | null = mergedArgs.prompt
  if (!prompt && mergedArgs.promptFiles.length > 0) prompt = await readPromptFromFiles(mergedArgs.promptFiles)
  if (!prompt) prompt = await readPromptFromStdin()

  const hasSegmentPrompts = mergedArgs.segmentPrompts.length > 0

  if (!prompt && !hasSegmentPrompts) {
    console.error("错误: 提示词不能为空（使用 --prompt、--promptfiles 或 --segment-prompts）")
    printUsage()
    process.exitCode = 1
    return
  }

  if (!mergedArgs.videoPath) {
    console.error("错误: --video 参数必填")
    printUsage()
    process.exitCode = 1
    return
  }

  if (mergedArgs.referenceImages.length > 0) {
    await validateReferenceImages(mergedArgs.referenceImages)
  }

  const { generateVideo } = await import("./providers/tuzi")
  const { getDefaultModel } = await import("./providers/tuzi")
  const model = mergedArgs.model || getDefaultModel()
  const outputPath = normalizeOutputPath(mergedArgs.videoPath)

  if (mergedArgs.segments && mergedArgs.segments >= 2) {
    const hasFfmpeg = await checkFfmpeg()
    if (!hasFfmpeg) {
      console.error("错误: 长视频模式需要 ffmpeg。请安装 ffmpeg 后重试。\n  macOS: brew install ffmpeg\n  Ubuntu: sudo apt install ffmpeg")
      process.exitCode = 1
      return
    }

    const tmpDir = path.join(path.dirname(outputPath), ".segments-tmp")
    await mkdir(tmpDir, { recursive: true })

    const segPaths: string[] = []
    const n = mergedArgs.segments

    for (let i = 0; i < n; i++) {
      let segPrompt: string | null = null
      if (mergedArgs.segmentPrompts[i]) {
        segPrompt = await readFile(mergedArgs.segmentPrompts[i]!, "utf8")
      } else {
        segPrompt = prompt
      }

      if (!segPrompt) {
        console.error(`错误: 第 ${i + 1} 段缺少提示词（需要 --prompt 或对应的 --segment-prompts）`)
        process.exitCode = 1
        return
      }

      const segArgs: CliArgs = { ...mergedArgs }

      if (i > 0 && segPaths.length > 0) {
        const lastFramePath = path.join(tmpDir, `frame-${i - 1}.png`)
        try {
          await extractLastFrame(segPaths[i - 1]!, lastFramePath)
          segArgs.referenceImages = [lastFramePath]
          segArgs.refMode = segArgs.refMode || "frames"
        } catch (e) {
          console.error(`警告: 提取第 ${i} 段尾帧失败，跳过首帧参考: ${e instanceof Error ? e.message : e}`)
        }
      }

      const segPath = path.join(tmpDir, `seg-${String(i + 1).padStart(2, "0")}.mp4`)
      console.log(`\n生成第 ${i + 1}/${n} 段...`)

      let data: Uint8Array
      let retried = false
      while (true) {
        try {
          data = await generateVideo(segPrompt, model, segArgs)
          break
        } catch (e) {
          if (!retried) {
            retried = true
            console.error("生成失败，正在重试...")
            continue
          }
          throw e
        }
      }

      await writeFile(segPath, data)
      segPaths.push(segPath)
      console.log(`第 ${i + 1}/${n} 段完成`)
    }

    console.log("\n正在合并视频...")
    const dir = path.dirname(outputPath)
    await mkdir(dir, { recursive: true })
    await concatVideos(segPaths, outputPath)
    await rm(tmpDir, { recursive: true, force: true })
    console.log("合并完成。")
  } else {
    if (!prompt) {
      console.error("错误: 单视频模式需要 --prompt 或 --promptfiles")
      process.exitCode = 1
      return
    }
    let data: Uint8Array
    let retried = false
    while (true) {
      try {
        data = await generateVideo(prompt, model, mergedArgs)
        break
      } catch (e) {
        if (!retried) {
          retried = true
          console.error("生成失败，正在重试...")
          continue
        }
        throw e
      }
    }

    const dir = path.dirname(outputPath)
    await mkdir(dir, { recursive: true })
    await writeFile(outputPath, data)
  }

  if (mergedArgs.json) {
    console.log(JSON.stringify({ savedVideo: outputPath, model, prompt: prompt.slice(0, 200) }, null, 2))
  } else {
    console.log(outputPath)
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(msg)
  process.exit(1)
})
