/**
 * 第三方脚本加载分布巡检。
 *
 * 作用：找出「每个页面都加载、但只有少数页面真正用得上」的外链库 —— 这类浪费很隐蔽，
 * 因为门控条件通常写成 `{{ if $cfg.xxx }}`（配置为真即全局加载），而不是按消费方登记。
 *
 * 用法：node scripts/lib-survey.mjs [构建目录=public] [额外库名...]
 *
 * ⚠️ 踩过的坑：**不要**用「库名是否出现在 HTML 里」判断是否加载 —— 站点的
 * `#site-config` 会把 cdn 映射表（含所有库的 URL）内联到每一页，于是每页都会命中，
 * 得出「37/40 页加载」的假结果。必须只解析真正的 `<script src=...>` 标签。
 *
 * 判定「是否需要」不属于本脚本职责：节省前必须找到**全部**消费方（模板、短代码、TS 运行时事件路径），
 * 只找到一半就门控 = 静默的功能回归。已知反例见 docs/agents.md §7。
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_LIBS = [
  "typeit", "colorthief", "APlayer", "Meting", "fancybox", "snackbar", "lazyload",
  "Swup.umd", "giscus", "artalk", "mermaid", "chart.js", "abcjs", "algoliasearch", "shiki",
];

const root = process.argv[2] || "public";
const extra = process.argv.slice(3);
if (!fs.existsSync(root)) {
  console.log(`找不到构建目录 ${root}，先跑 hugo --minify`);
  process.exit(2);
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });

const files = walk(root);
const libs = [...new Set([...DEFAULT_LIBS, ...extra])];

console.log(`产物 ${files.length} 个页面；只统计真实 <script src> 标签（排除内嵌的 cdn 配置 JSON）\n`);
console.log("库".padEnd(16) + "加载页数".padStart(10) + "  示例页面");

const suspicious = [];
for (const lib of libs) {
  const hits = [];
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    const srcs = [...html.matchAll(/<script[^>]*\ssrc=["']?([^"'\s>]+)[^>]*>/gi)].map((m) => m[1]);
    if (srcs.some((src) => src.includes(lib))) hits.push(path.relative(root, file).replaceAll(path.sep, "/"));
  }
  if (!hits.length) continue;
  /* 「几乎全站加载」比「严格等于页数」更有意义：实际会有少数页面（404/相册等）跳过某些脚本，
     用严格相等会把 37/40 这种明显全站加载的情况漏报。 */
  if (hits.length >= files.length * 0.8) suspicious.push({ lib, count: hits.length, total: files.length });
  console.log(lib.padEnd(16) + String(hits.length).padStart(10) + "  " + (hits.length <= 5 ? hits.join(", ") : `${hits.slice(0, 4).join(", ")} …`));
}

console.log("");
if (suspicious.length) {
  console.log("⚠️ 以下库在**几乎每个页面**（≥80%）都加载，建议逐个核对是否真有必要（改前必须找全消费方）：");
  for (const item of suspicious) console.log(`   ${item.lib}（${item.count}/${item.total} 页）`);
} else {
  console.log("没有「几乎全站加载」的外链库。");
}
