import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { PDFDocument } from "pdf-lib";

interface PageInfo {
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
    console.error("用法: bun merge-to-pdf.ts <comic-dir> [--output filename.pdf]");
    process.exit(1);
  }

  return { dir, output };
}

function findComicPages(dir: string): PageInfo[] {
  if (!existsSync(dir)) {
    console.error(`目录未找到: ${dir}`);
    process.exit(1);
  }

  const files = readdirSync(dir);
  const pagePattern = /^(\d+)-(cover|page)(-[\w-]+)?\.(png|jpg|jpeg)$/i;
  const promptsDir = join(dir, "prompts");
  const hasPrompts = existsSync(promptsDir);

  const pages: PageInfo[] = files
    .filter((f) => pagePattern.test(f))
    .map((f) => {
      const match = f.match(pagePattern);
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

  if (pages.length === 0) {
    console.error(`未找到漫画页面: ${dir}`);
    console.error("期望格式: 00-cover-slug.png, 01-page-slug.png 等");
    process.exit(1);
  }

  return pages;
}

async function createPdf(pages: PageInfo[], outputPath: string) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setAuthor("tuzi-comic");
  pdfDoc.setSubject("Generated Comic");

  for (const page of pages) {
    const imageData = readFileSync(page.path);
    const ext = page.filename.toLowerCase();
    const image = ext.endsWith(".png")
      ? await pdfDoc.embedPng(imageData)
      : await pdfDoc.embedJpg(imageData);

    const { width, height } = image;
    const pdfPage = pdfDoc.addPage([width, height]);

    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width,
      height,
    });

    console.log(`已添加: ${page.filename}${page.promptPath ? "（含提示词）" : ""}`);
  }

  const pdfBytes = await pdfDoc.save();
  await Bun.write(outputPath, pdfBytes);

  console.log(`\n已创建: ${outputPath}`);
  console.log(`总页数: ${pages.length}`);
}

async function main() {
  const { dir, output } = parseArgs();
  const pages = findComicPages(dir);

  const dirName = basename(dir) === "comic" ? basename(join(dir, "..")) : basename(dir);
  const outputPath = output || join(dir, `${dirName}.pdf`);

  console.log(`在 ${dir} 中找到 ${pages.length} 个页面\n`);

  await createPdf(pages, outputPath);
}

main().catch((err) => {
  console.error("错误:", err.message);
  process.exit(1);
});
