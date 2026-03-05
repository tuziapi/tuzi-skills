import type { CliOptions, ThemeName } from "./types.js";
import {
  FONT_FAMILY_MAP,
  FONT_SIZE_OPTIONS,
  COLOR_PRESETS,
  CODE_BLOCK_THEMES,
} from "./constants.js";
import { THEME_NAMES } from "./themes.js";
import { loadExtendConfig } from "./extend-config.js";

export function printUsage(): void {
  console.error(
    [
      "用法:",
      "  npx tsx src/md/render.ts <markdown_file> [选项]",
      "",
      "选项:",
      `  --theme <name>        主题 (${THEME_NAMES.join(", ")})`,
      `  --color <name|hex>    主色调: ${Object.keys(COLOR_PRESETS).join(", ")}, 或十六进制值`,
      `  --font-family <name>  字体: ${Object.keys(FONT_FAMILY_MAP).join(", ")}, 或 CSS 值`,
      `  --font-size <N>       字号: ${FONT_SIZE_OPTIONS.join(", ")}（默认: 16px）`,
      `  --code-theme <name>   代码高亮主题（默认: github）`,
      `  --mac-code-block      显示 Mac 风格代码块头部`,
      `  --line-number         显示代码行号`,
      `  --cite                启用脚注引用`,
      `  --count               显示阅读时间/字数统计`,
      `  --legend <value>      图片说明: title-alt, alt-title, title, alt, none`,
      `  --keep-title          保留输出中的第一个标题`,
    ].join("\n")
  );
}

function parseArgValue(argv: string[], i: number, flag: string): string | null {
  const arg = argv[i]!;
  if (arg.includes("=")) {
    return arg.slice(flag.length + 1);
  }
  const next = argv[i + 1];
  return next ?? null;
}

function resolveFontFamily(value: string): string {
  return FONT_FAMILY_MAP[value] ?? value;
}

function resolveColor(value: string): string {
  return COLOR_PRESETS[value] ?? value;
}

export function parseArgs(argv: string[]): CliOptions | null {
  const ext = loadExtendConfig();

  let inputPath = "";
  let theme: ThemeName = ext.default_theme ?? "default";
  let keepTitle = ext.keep_title ?? false;
  let primaryColor: string | undefined = ext.default_color ? resolveColor(ext.default_color) : undefined;
  let fontFamily: string | undefined = ext.default_font_family ? resolveFontFamily(ext.default_font_family) : undefined;
  let fontSize: string | undefined = ext.default_font_size ?? undefined;
  let codeTheme = ext.default_code_theme ?? "github";
  let isMacCodeBlock = ext.mac_code_block ?? true;
  let isShowLineNumber = ext.show_line_number ?? false;
  let citeStatus = ext.cite ?? false;
  let countStatus = ext.count ?? false;
  let legend = ext.legend ?? "alt";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (!arg.startsWith("--") && !inputPath) {
      inputPath = arg;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg === "--keep-title") { keepTitle = true; continue; }
    if (arg === "--mac-code-block") { isMacCodeBlock = true; continue; }
    if (arg === "--no-mac-code-block") { isMacCodeBlock = false; continue; }
    if (arg === "--line-number") { isShowLineNumber = true; continue; }
    if (arg === "--cite") { citeStatus = true; continue; }
    if (arg === "--count") { countStatus = true; continue; }

    if (arg === "--theme" || arg.startsWith("--theme=")) {
      const val = parseArgValue(argv, i, "--theme");
      if (!val) { console.error("缺少 --theme 的值"); return null; }
      theme = val as ThemeName;
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg === "--color" || arg.startsWith("--color=")) {
      const val = parseArgValue(argv, i, "--color");
      if (!val) { console.error("缺少 --color 的值"); return null; }
      primaryColor = resolveColor(val);
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg === "--font-family" || arg.startsWith("--font-family=")) {
      const val = parseArgValue(argv, i, "--font-family");
      if (!val) { console.error("缺少 --font-family 的值"); return null; }
      fontFamily = resolveFontFamily(val);
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg === "--font-size" || arg.startsWith("--font-size=")) {
      const val = parseArgValue(argv, i, "--font-size");
      if (!val) { console.error("缺少 --font-size 的值"); return null; }
      fontSize = val.endsWith("px") ? val : `${val}px`;
      if (!FONT_SIZE_OPTIONS.includes(fontSize)) {
        console.error(`无效的字号: ${fontSize}。可选: ${FONT_SIZE_OPTIONS.join(", ")}`);
        return null;
      }
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg === "--code-theme" || arg.startsWith("--code-theme=")) {
      const val = parseArgValue(argv, i, "--code-theme");
      if (!val) { console.error("缺少 --code-theme 的值"); return null; }
      codeTheme = val;
      if (!CODE_BLOCK_THEMES.includes(codeTheme)) {
        console.error(`未知的代码主题: ${codeTheme}`);
        return null;
      }
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg === "--legend" || arg.startsWith("--legend=")) {
      const val = parseArgValue(argv, i, "--legend");
      if (!val) { console.error("缺少 --legend 的值"); return null; }
      const valid = ["title-alt", "alt-title", "title", "alt", "none"];
      if (!valid.includes(val)) {
        console.error(`无效的图片说明: ${val}。可选: ${valid.join(", ")}`);
        return null;
      }
      legend = val;
      if (!arg.includes("=")) i += 1;
      continue;
    }

    console.error(`未知参数: ${arg}`);
    return null;
  }

  if (!inputPath) {
    return null;
  }

  if (!THEME_NAMES.includes(theme)) {
    console.error(`未知主题: ${theme}`);
    return null;
  }

  return {
    inputPath, theme, keepTitle, primaryColor, fontFamily, fontSize,
    codeTheme, isMacCodeBlock, isShowLineNumber, citeStatus, countStatus, legend,
  };
}
