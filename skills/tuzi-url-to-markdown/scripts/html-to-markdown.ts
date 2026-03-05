import { JSDOM } from "jsdom";
import { Defuddle } from "defuddle/node";

export interface PageMetadata {
  url: string;
  title: string;
  description?: string;
  author?: string;
  published?: string;
  coverImage?: string;
  captured_at: string;
}

export interface ConversionResult {
  metadata: PageMetadata;
  markdown: string;
}

export const absolutizeUrlsScript = String.raw`
(function() {
  const baseUrl = document.baseURI || location.href;
  function toAbsolute(url) {
    if (!url) return url;
    try { return new URL(url, baseUrl).href; } catch { return url; }
  }
  function absAttr(sel, attr) {
    document.querySelectorAll(sel).forEach(el => {
      const v = el.getAttribute(attr);
      if (v) { const a = toAbsolute(v); if (a) el.setAttribute(attr, a); }
    });
  }
  function absSrcset(sel) {
    document.querySelectorAll(sel).forEach(el => {
      const s = el.getAttribute("srcset");
      if (!s) return;
      el.setAttribute("srcset", s.split(",").map(p => {
        const t = p.trim(); if (!t) return "";
        const [url, ...d] = t.split(/\s+/);
        return d.length ? toAbsolute(url) + " " + d.join(" ") : toAbsolute(url);
      }).filter(Boolean).join(", "));
    });
  }
  document.querySelectorAll("img[data-src], video[data-src], audio[data-src], source[data-src]").forEach(el => {
    const ds = el.getAttribute("data-src");
    if (ds && (!el.getAttribute("src") || el.getAttribute("src") === "" || el.getAttribute("src")?.startsWith("data:"))) {
      el.setAttribute("src", ds);
    }
  });
  absAttr("a[href]", "href");
  absAttr("img[src], video[src], audio[src], source[src]", "src");
  absSrcset("img[srcset], source[srcset]");
  return { html: document.documentElement.outerHTML };
})()
`;

export async function extractContent(html: string, url: string): Promise<ConversionResult> {
  const dom = new JSDOM(html, { url });
  const result = await Defuddle(dom, url, { markdown: true });

  const metadata: PageMetadata = {
    url,
    title: result.title || "",
    description: result.description || undefined,
    author: result.author || undefined,
    published: result.published || undefined,
    coverImage: result.image || undefined,
    captured_at: new Date().toISOString(),
  };

  return { metadata, markdown: result.content || "" };
}

function escapeYamlValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

export function formatMetadataYaml(meta: PageMetadata): string {
  const lines = ["---"];
  lines.push(`url: ${meta.url}`);
  lines.push(`title: "${escapeYamlValue(meta.title)}"`);
  if (meta.description) lines.push(`description: "${escapeYamlValue(meta.description)}"`);
  if (meta.author) lines.push(`author: "${escapeYamlValue(meta.author)}"`);
  if (meta.published) lines.push(`published: "${escapeYamlValue(meta.published)}"`);
  if (meta.coverImage) lines.push(`coverImage: "${escapeYamlValue(meta.coverImage)}"`);
  lines.push(`captured_at: "${escapeYamlValue(meta.captured_at)}"`);
  lines.push("---");
  return lines.join("\n");
}

export function createMarkdownDocument(result: ConversionResult): string {
  const yaml = formatMetadataYaml(result.metadata);
  const escapedTitle = result.metadata.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const titleRegex = new RegExp(`^#\\s+${escapedTitle}\\s*(\\n|$)`, "i");
  const hasTitle = titleRegex.test(result.markdown.trimStart());
  const title = result.metadata.title && !hasTitle ? `\n\n# ${result.metadata.title}\n\n` : "\n\n";
  return yaml + title + result.markdown;
}
