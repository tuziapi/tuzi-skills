import { readFileSync, writeFileSync } from "fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import { visit } from "unist-util-visit";
import YAML from "yaml";
import { replaceQuotes } from "./quotes";
import { applyAutocorrect } from "./autocorrect";

export interface FormatOptions {
  quotes?: boolean;
  spacing?: boolean;
  emphasis?: boolean;
}

export interface FormatResult {
  success: boolean;
  filePath: string;
  quotesFixed: boolean;
  spacingApplied: boolean;
  emphasisFixed: boolean;
  error?: string;
}

const DEFAULT_OPTIONS: Required<FormatOptions> = {
  quotes: false,
  spacing: true,
  emphasis: true,
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
}

function formatFrontmatter(value: string): string | null {
  try {
    const doc = YAML.parseDocument(value);
    return doc.toString({ lineWidth: 0 }).trimEnd();
  } catch {
    return null;
  }
}

function formatMarkdownContent(
  content: string,
  options: Required<FormatOptions>
): string {
  const processor = unified()
    .use(remarkParse)
    .use(options.emphasis ? remarkCjkFriendly : [])
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkStringify, {
      wrap: false,
    });

  const tree = processor.parse(content);

  visit(tree, (node) => {
    if (node.type === "text" && options.quotes) {
      const textNode = node as { value: string };
      textNode.value = replaceQuotes(textNode.value);
      return;
    }
    if (node.type === "yaml") {
      const yamlNode = node as { value: string };
      const formatted = formatFrontmatter(yamlNode.value);
      if (formatted !== null) {
        yamlNode.value = formatted;
      }
      return;
    }
  });

  let result = processor.stringify(tree);
  if (options.emphasis) {
    result = decodeHtmlEntities(result);
  }
  return result;
}

export function formatMarkdown(
  filePath: string,
  options?: FormatOptions
): FormatResult {
  const opts: Required<FormatOptions> = { ...DEFAULT_OPTIONS, ...options };

  const result: FormatResult = {
    success: false,
    filePath,
    quotesFixed: false,
    spacingApplied: false,
    emphasisFixed: false,
  };

  try {
    const content = readFileSync(filePath, "utf-8");
    const formattedContent = formatMarkdownContent(content, opts);

    result.quotesFixed = opts.quotes;
    result.emphasisFixed = opts.emphasis;

    writeFileSync(filePath, formattedContent, "utf-8");

    if (opts.spacing) {
      result.spacingApplied = applyAutocorrect(filePath);
    }

    result.success = true;
    console.log(`✓ 已格式化: ${filePath}`);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error(`✗ 格式化失败: ${result.error}`);
  }

  return result;
}

function parseArgs(args: string[]): { filePath: string; options: FormatOptions } {
  const options: FormatOptions = {};
  let filePath = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--quotes" || arg === "-q") {
      options.quotes = true;
    } else if (arg === "--no-quotes") {
      options.quotes = false;
    } else if (arg === "--spacing" || arg === "-s") {
      options.spacing = true;
    } else if (arg === "--no-spacing") {
      options.spacing = false;
    } else if (arg === "--emphasis" || arg === "-e") {
      options.emphasis = true;
    } else if (arg === "--no-emphasis") {
      options.emphasis = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`用法: npx -y bun scripts/main.ts <file.md> [选项]

选项:
  -q, --quotes       将 ASCII 引号替换为全角引号（默认: false）
      --no-quotes    不替换引号
  -s, --spacing      添加中英文间距（默认: true）
      --no-spacing   不添加中英文间距
  -e, --emphasis     修复中文强调标点问题（默认: true）
      --no-emphasis  不修复中文强调问题
  -h, --help         显示帮助信息`);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      filePath = arg;
    }
  }

  return { filePath, options };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { filePath, options } = parseArgs(process.argv.slice(2));

  if (!filePath) {
    console.error("用法: npx -y bun scripts/main.ts <file.md> [选项]");
    console.error("使用 --help 查看更多信息。");
    process.exit(1);
  }

  const result = formatMarkdown(filePath, options);
  if (!result.success) {
    process.exit(1);
  }
}
