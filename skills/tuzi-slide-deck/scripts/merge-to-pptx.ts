import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename, extname } from "path";
import PptxGenJS from "pptxgenjs";

interface SlideInfo {
  filename: string;
  path: string;
  index: number;
  promptPath?: string;
}

function parseArgs(): { dir: string; output?: string } {
  const args = process.argv.slice(2);
  let dir = "";
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      output = args[++i];
    } else if (!args[i].startsWith("-")) {
      dir = args[i];
    }
  }

  if (!dir) {
    console.error("用法: bun merge-to-pptx.ts <slide-deck-dir> [--output filename.pptx]");
    process.exit(1);
  }

  return { dir, output };
}

function findSlideImages(dir: string): SlideInfo[] {
  if (!existsSync(dir)) {
    console.error(`目录未找到: ${dir}`);
    process.exit(1);
  }

  const files = readdirSync(dir);
  const slidePattern = /^(\d+)-slide-.*\.(png|jpg|jpeg)$/i;
  const promptsDir = join(dir, "prompts");
  const hasPrompts = existsSync(promptsDir);

  const slides: SlideInfo[] = files
    .filter((f) => slidePattern.test(f))
    .map((f) => {
      const match = f.match(slidePattern);
      const baseName = f.replace(/\.(png|jpg|jpeg)$/i, "");
      const promptPath = hasPrompts ? join(promptsDir, `${baseName}.md`) : undefined;

      return {
        filename: f,
        path: join(dir, f),
        index: parseInt(match![1], 10),
        promptPath: promptPath && existsSync(promptPath) ? promptPath : undefined,
      };
    })
    .sort((a, b) => a.index - b.index);

  if (slides.length === 0) {
    console.error(`未找到幻灯片图片: ${dir}`);
    console.error("期望格式: 01-slide-*.png, 02-slide-*.png 等");
    process.exit(1);
  }

  return slides;
}

function findBasePrompt(): string | undefined {
  const scriptDir = import.meta.dir;
  const basePromptPath = join(scriptDir, "..", "references", "base-prompt.md");
  if (existsSync(basePromptPath)) {
    return readFileSync(basePromptPath, "utf-8");
  }
  return undefined;
}

async function createPptx(slides: SlideInfo[], outputPath: string) {
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_16x9";
  pptx.author = "tuzi-slide-deck";
  pptx.subject = "Generated Slide Deck";

  const basePrompt = findBasePrompt();
  let notesCount = 0;

  for (const slide of slides) {
    const s = pptx.addSlide();
    const imageData = readFileSync(slide.path);
    const base64 = imageData.toString("base64");
    const ext = extname(slide.filename).toLowerCase().replace(".", "");
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";

    s.addImage({
      data: `data:${mimeType};base64,${base64}`,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      sizing: { type: "cover", w: "100%", h: "100%" },
    });

    if (slide.promptPath) {
      const slidePrompt = readFileSync(slide.promptPath, "utf-8");
      const fullNotes = basePrompt ? `${basePrompt}\n\n---\n\n${slidePrompt}` : slidePrompt;
      s.addNotes(fullNotes);
      notesCount++;
    }

    console.log(`已添加: ${slide.filename}${slide.promptPath ? "（含备注）" : ""}`);
  }

  await pptx.writeFile({ fileName: outputPath });
  console.log(`\n已创建: ${outputPath}`);
  console.log(`总幻灯片数: ${slides.length}`);
  if (notesCount > 0) {
    console.log(`含备注的幻灯片: ${notesCount}${basePrompt ? "（包含基础提示词）" : ""}`);
  }
}

async function main() {
  const { dir, output } = parseArgs();
  const slides = findSlideImages(dir);

  const dirName = basename(dir) === "slide-deck" ? basename(join(dir, "..")) : basename(dir);
  const outputPath = output || join(dir, `${dirName}.pptx`);

  console.log(`在 ${dir} 中找到 ${slides.length} 张幻灯片\n`);

  await createPptx(slides, outputPath);
}

main().catch((err) => {
  console.error("错误:", err.message);
  process.exit(1);
});
