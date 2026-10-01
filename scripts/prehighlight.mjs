#!/usr/bin/env node
/**
 * prehighlight.mjs —— hugo build 后静态 shiki 高亮
 *
 * 遍历 public/**\/*.html，把每个 `figure[data-code-block]` 的代码块用 shiki
 * 预渲染成双主题 HTML（github-light / github-dark），替换 `.code-block__viewport`
 * 里的 fallback，并把源码存到 `data-code-source` 供运行时复制按钮读取。
 *
 * runtime 的 code-highlight.ts 已解耦：预渲染的块 viewport 里已有 `.shiki`，
 * 运行时只补交互（复制/折叠/行号），不再 import shiki —— 消除文章页加载的主线程
 * longtask 与 60+ 模块的网络/解析开销。漏跑脚本的块由运行时 shiki 兜底。
 *
 * 幂等：viewport 已含 `.shiki` 的块跳过。
 */
import { createHighlighter } from "shiki";
import { parse } from "node-html-parser";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // 站点根
const PUBLIC = join(ROOT, "public");
const LIGHT_THEME = "github-light";
const DARK_THEME = "github-dark";

/** 内置语言列表；未覆盖的语言在 codeToHtml 前动态 loadLanguage 兜底。 */
const LANGS = [
  "text", "javascript", "js", "jsx", "typescript", "ts", "tsx", "bash", "sh",
  "shell", "shellscript", "yaml", "yml", "json", "jsonc", "python", "py", "html",
  "css", "scss", "markdown", "md", "sql", "go", "rust", "java", "c", "cpp",
  "csharp", "cs", "docker", "ini", "toml", "xml", "diff", "powershell",
  "kotlin", "swift", "graphql", "regex", "properties", "plaintext", "txt",
];

function* walkHtml(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkHtml(p);
    else if (entry.name.endsWith(".html")) yield p;
  }
}

/** 从 shiki 输出的 style 文本提取 --shiki-*-bg */
function extractBgs(styleText) {
  const light = (styleText.match(/--shiki-light-bg:\s*([^;]+)/) || [])[1];
  const dark = (styleText.match(/--shiki-dark-bg:\s*([^;]+)/) || [])[1];
  return { lightBg: (light || "").trim(), darkBg: (dark || "").trim() };
}

async function main() {
  const files = [...walkHtml(PUBLIC)];
  if (!files.length) {
    console.log(`[prehighlight] public 目录不存在或无 html：${PUBLIC}`);
    return;
  }

  const highlighter = await createHighlighter({ themes: [LIGHT_THEME, DARK_THEME], langs: LANGS });

  let blocksTotal = 0;
  let blocksHighlighted = 0;
  let skipped = 0;

  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const root = parse(html);
    let changed = false;

    for (const block of root.querySelectorAll("figure[data-code-block]")) {
      blocksTotal++;
      const viewport = block.querySelector(".code-block__viewport");
      if (!viewport) continue;
      if (viewport.querySelector(".shiki")) { skipped++; continue; } // 幂等

      const lang = (block.getAttribute("data-language") || "text").trim();
      const code = block.querySelector(".code-block__fallback code");
      const source = (code?.textContent || "").trimEnd();

      // 动态加载语言（未在内置列表时）
      try {
        if (lang && lang !== "text" && !highlighter.getLoadedLanguages().includes(lang)) {
          await highlighter.loadLanguage(lang);
        }
      } catch {
        /* 保留 fallback lang */
      }
      const safeLang = highlighter.getLoadedLanguages().includes(lang) ? lang : "text";

      let out;
      try {
        out = await highlighter.codeToHtml(source, {
          lang: safeLang,
          themes: { light: LIGHT_THEME, dark: DARK_THEME },
          defaultColor: false,
        });
      } catch {
        continue;
      }

      const parsed = parse(out);
      const pre = parsed.querySelector("pre.shiki");
      if (!pre) continue;

      // 提取背景并移除 shiki 自带 style（主题 hugo.css 已统一颜色/背景/暗色切换）
      const styleEl = parsed.querySelector("style");
      const { lightBg, darkBg } = styleEl ? extractBgs(styleEl.textContent) : { lightBg: "", darkBg: "" };

      // figure 写主题背景变量 + 主题属性（与 runtime code-highlight.ts 对齐）
      const bgVars = [];
      if (lightBg) bgVars.push(`--code-block-light-theme-bg:${lightBg}`);
      if (darkBg) bgVars.push(`--code-block-dark-theme-bg:${darkBg}`);
      const existingStyle = (block.getAttribute("style") || "").trim();
      block.setAttribute("style", [existingStyle, bgVars.join(";")].filter(Boolean).join(";"));
      block.setAttribute("data-code-light-theme", LIGHT_THEME);
      block.setAttribute("data-code-dark-theme", DARK_THEME);
      // 源码存起来供复制按钮；fallback 随替换移除
      block.setAttribute("data-code-source", source);

      // 把 pre.shiki 放入 viewport（替换原 fallback）
      viewport.set_content(pre.toString());
      blocksHighlighted++;
      changed = true;
    }

    if (changed) writeFileSync(file, root.toString());
  }

  await highlighter.dispose();
  console.log(`[prehighlight] 完成：扫描 ${files.length} 个 html，代码块 ${blocksTotal}（高亮 ${blocksHighlighted}，跳过 ${skipped}）`);
}

main().catch((e) => {
  console.error("[prehighlight] 失败：", e);
  process.exit(1);
});
