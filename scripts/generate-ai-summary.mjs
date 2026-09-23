#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const envFile = path.join(root, ".env");

const loadEnvFile = async (file) => {
  let source = "";
  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    return;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !(key in process.env)) process.env[key] = value;
  }
};

await loadEnvFile(envFile);

const postsDir = path.join(root, "content", "posts");
const api = process.env.AI_SUMMARY_API || "https://api.siliconflow.cn/v1/chat/completions";
const model = process.env.AI_SUMMARY_MODEL || "Qwen/Qwen3-8B";
const token = process.env.AI_SUMMARY_API_KEY || "";
const maxInput = Number(process.env.AI_SUMMARY_MAX_INPUT || 12000);
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const prompt = process.env.AI_SUMMARY_PROMPT || "你是博客文章摘要工具。请根据文章内容，用中文概括文章的核心主题、关键做法和最终结论。只输出一段自然流畅的摘要，不要标题、列表、Markdown、前缀或解释，控制在 150 到 250 个汉字。";

const walk = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && fullPath.endsWith(".md")) files.push(fullPath);
  }
  return files;
};

const readFrontMatter = (source) => {
  const match = source.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)([\s\S]*)$/);
  if (!match) return null;
  return { prefix: match[1], body: match[2], separator: match[3], content: match[4] };
};

const frontMatterValue = (body, key) => {
  const match = body.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "m"));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : "";
};

const cleanMarkdown = (source) => source
  .replace(/^---[\s\S]*?---\s*/m, "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/~~~[\s\S]*?~~~/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^\s*[-*+]\s+/gm, "")
  .replace(/^\s*\d+[.)]\s+/gm, "")
  .replace(/[>*_`~]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maxInput);

const normalizeSummary = (value) => String(value || "")
  .replace(/<think>[\s\S]*?<\/think>/gi, "")
  .replace(/^```(?:text|markdown)?\s*/i, "")
  .replace(/```$/g, "")
  .replace(/\s+/g, " ")
  .trim();

const requestSummary = async (article) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(api, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.2,
        enable_thinking: false,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: article },
        ],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${payload.error?.message || "AI 接口返回错误"}`);
    }
    const summary = normalizeSummary(payload.choices?.[0]?.message?.content);
    if (!summary) throw new Error("AI 接口返回了空摘要");
    return summary;
  } finally {
    clearTimeout(timeout);
  }
};

const withSummary = (source, summary) => {
  const frontMatter = readFrontMatter(source);
  if (!frontMatter) return source;
  const value = summary.replace(/\r?\n/g, " ").trim();
  const field = `ai_summary: >-\n  ${value}`;
  const body = frontMatter.body.replace(/\r?\nai_summary\s*:[\s\S]*?(?=\r?\n[A-Za-z0-9_-]+\s*:|$)/, "");
  return `${frontMatter.prefix}${body.trimEnd()}\n${field}${frontMatter.separator}${frontMatter.content}`;
};

const main = async () => {
  const files = (await walk(postsDir)).sort();
  let candidates = 0;
  let updated = 0;
  let failed = 0;

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const frontMatter = readFrontMatter(source);
    if (!frontMatter) continue;
    const current = frontMatterValue(frontMatter.body, "ai_summary");
    if (!force && current && current !== "false") continue;
    if (current === "false") continue;

    candidates += 1;
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const article = cleanMarkdown(source);
    if (!article) {
      console.warn(`[skip] ${relative}: 正文为空`);
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] ${relative}: ${article.length} 字符，待生成`);
      continue;
    }
    if (!token) {
      console.error(`[fail] ${relative}: 缺少 AI_SUMMARY_API_KEY，未修改文件`);
      failed += 1;
      continue;
    }

    try {
      const summary = await requestSummary(article);
      await fs.writeFile(file, withSummary(source, summary), "utf8");
      updated += 1;
      console.log(`[ok] ${relative}`);
    } catch (error) {
      failed += 1;
      console.error(`[fail] ${relative}: ${error.message}`);
    }
  }

  console.log(`候选文章: ${candidates}，已更新: ${updated}，失败: ${failed}${dryRun ? "（dry-run，未修改文件）" : ""}`);
  if (failed > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
