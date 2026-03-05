import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { PDFDocument, rgb } from "pdf-lib";

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
    console.error("用法: bun merge-to-pdf.ts <slide-deck-dir> [--output filename.pdf]");
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

async function createPdf(slides: SlideInfo[], outputPath: string) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setAuthor("tuzi-slide-deck");
  pdfDoc.setSubject("Generated Slide Deck");

  for (const slide of slides) {
    const imageData = readFileSync(slide.path);
    const ext = slide.filename.toLowerCase();
    const image = ext.endsWith(".png")
      ? await pdfDoc.embedPng(imageData)
      : await pdfDoc.embedJpg(imageData);

    const { width, height } = image;
    const page = pdfDoc.addPage([width, height]);

    page.drawImage(image, {
      x: 0,
      y: 0,
      width,
      height,
    });

    console.log(`已添加: ${slide.filename}${slide.promptPath ? "（含提示词）" : ""}`);
  }

  const pdfBytes = await pdfDoc.save();
  await Bun.write(outputPath, pdfBytes);

  console.log(`\n已创建: ${outputPath}`);
  console.log(`总页数: ${slides.length}`);
}

async function main() {
  const { dir, output } = parseArgs();
  const slides = findSlideImages(dir);

  const dirName = basename(dir) === "slide-deck" ? basename(join(dir, "..")) : basename(dir);
  const outputPath = output || join(dir, `${dirName}.pdf`);

  console.log(`在 ${dir} 中找到 ${slides.length} 张幻灯片\n`);

  await createPdf(slides, outputPath);
}

main().catch((err) => {
  console.error("错误:", err.message);
  process.exit(1);
});
