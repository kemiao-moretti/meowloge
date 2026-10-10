/**
 * 性能预算门（Phase 0 产出）。
 *
 * 作用：把「别把优化成果吃回去」变成可执行断言，而不是靠人记得。
 *
 * 检查项：
 *   1. **未引用资源 = 0**：产物里的图片/字体，若没有任何文本产物引用它 → 直接失败。
 *      引用判定用「URL 或文件名是否出现在任一文本产物里」，偏宽松（宁可留着也不误删）。
 *   2. **每页渲染阻塞资源不超预算**：解析每页 HTML，统计真正阻塞渲染的样式表与同步脚本字节数，
 *      与 `scripts/perf-budget.baseline.json` 里的记录比较。允许 `--tolerance` 的轻微上浮。
 *   3. **页级包存在性**：HTML 里 `data-solitude-custom-page="x"` 声明的页级包产物必须真实存在。
 *
 * 用法：
 *   node scripts/perf-budget.mjs [构建目录=public]          # 检查
 *   node scripts/perf-budget.mjs public --save-baseline     # 记录当前指标为新基线
 *   node scripts/perf-budget.mjs public --tolerance 0.02    # 允许 2% 上浮
 *
 * 注意：只统计**阻塞**资源。`media="print" onload` 套路与 `<noscript>` 里的回退链接不算阻塞
 * （后者对启用 JS 的浏览器根本不发请求）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 需要检查是否被引用的静态资源类型（体积大、删了会影响页面）。 */
export const ASSET_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".otf"];

/** 可能承载引用的文本产物类型。 */
const TEXT_EXTENSIONS = [".html", ".htm", ".xml", ".json", ".js", ".mjs", ".css", ".txt", ".xsl", ".webmanifest"];

export const walkFiles = (dir, filter = () => true) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkFiles(full, filter);
      return entry.isFile() && filter(full) ? [full] : [];
    })
    .sort();
};

/** 读取整个产物的文本语料（用于引用判定）。 */
export const collectTextCorpus = (root) => {
  const files = walkFiles(root, (file) => TEXT_EXTENSIONS.includes(path.extname(file).toLowerCase()));
  return files.map((file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  });
};

/** 纯函数：某个资源是否被任意一份文本引用（URL 或文件名命中即算）。 */
export const isAssetReferenced = (assetUrl, corpus) =>
  corpus.some((text) => text.includes(assetUrl) || text.includes(path.basename(assetUrl)));

/**
 * 找出产物里从未被引用的静态资源。
 * @returns {{ url: string, bytes: number }[]}
 */
export const findUnreferencedAssets = (root) => {
  const corpus = collectTextCorpus(root);
  const assets = walkFiles(root, (file) => ASSET_EXTENSIONS.includes(path.extname(file).toLowerCase()));
  return assets
    .map((file) => ({ url: "/" + path.relative(root, file).replaceAll(path.sep, "/"), file }))
    .filter((item) => !isAssetReferenced(item.url, corpus))
    .map((item) => ({ url: item.url, bytes: fs.statSync(item.file).size }))
    .sort((a, b) => b.bytes - a.bytes);
};

/**
 * 纯函数：从一页 HTML 里解析出阻塞/非阻塞资源清单。
 * 阻塞 CSS = 没有 `media="print"` 套路、且不在 `<noscript>` 里的 `<link rel=stylesheet>`。
 * 同步 JS = 没有 defer/async/type=module 的 `<script src>`。
 */
export const parsePageResources = (html, resolveSize = () => null) => {
  const noscriptSpans = [...html.matchAll(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi)].map((m) => [m.index, m.index + m[0].length]);
  const inNoscript = (index) => noscriptSpans.some(([start, end]) => index >= start && index < end);

  const result = {
    blockingCss: [], nonBlockingCss: [], blockingJs: [], deferredJs: [], moduleJs: [],
    blockingCssBytes: 0, blockingJsBytes: 0, deferredJsBytes: 0, moduleJsBytes: 0,
  };

  for (const match of html.matchAll(/<link[^>]*rel=["']?stylesheet["']?[^>]*>/gi)) {
    const tag = match[0];
    const href = (tag.match(/href=["']?([^"'\s>]+)/) || [])[1] || "";
    if (!href) continue;
    const bytes = resolveSize(href) ?? 0;
    const nonBlocking = /media=["']?print/i.test(tag) || inNoscript(match.index);
    result[nonBlocking ? "nonBlockingCss" : "blockingCss"].push({ href, bytes });
    if (!nonBlocking) result.blockingCssBytes += bytes;
  }

  /* 注意 `\ssrc=` 的空白边界：否则会把惰性标记的 `data-consent-src="…"` 误判成真的脚本源，
     从而把「未执行的被拦脚本」算成阻塞资源（本站 Umami 就是这种写法）。 */
  for (const match of html.matchAll(/<script\b[^>]*?\ssrc=["']?([^"'\s>]+)[^>]*>/gi)) {
    const tag = match[0];
    const bytes = resolveSize(match[1]) ?? 0;
    if (/type=["']?module/i.test(tag)) {
      result.moduleJs.push({ href: match[1], bytes });
      result.moduleJsBytes += bytes;
    } else if (/\b(defer|async)\b/i.test(tag)) {
      result.deferredJs.push({ href: match[1], bytes });
      result.deferredJsBytes += bytes;
    } else {
      result.blockingJs.push({ href: match[1], bytes });
      result.blockingJsBytes += bytes;
    }
  }
  return result;
};

/** 解析产物里所有页面的阻塞资源指标。 */
export const collectPageMetrics = (root) => {
  const sizeCache = new Map();
  const resolveSize = (href) => {
    if (!href.startsWith("/") && !href.startsWith("http://localhost")) return null; // 外链无法本地计量
    const rel = decodeURIComponent(new URL(href, "http://local/").pathname.replace(/^\//, ""));
    if (sizeCache.has(rel)) return sizeCache.get(rel);
    let bytes = null;
    try {
      bytes = fs.statSync(path.join(root, rel)).size;
    } catch {
      bytes = null;
    }
    sizeCache.set(rel, bytes);
    return bytes;
  };

  return walkFiles(root, (file) => /\.html?$/i.test(file)).map((file) => {
    const html = fs.readFileSync(file, "utf8");
    const resources = parsePageResources(html, resolveSize);
    const pageBundle = (html.match(/data-solitude-custom-page=["']?([^"'\s>]+)/) || [])[1] || null;
    return {
      page: path.relative(root, file).replaceAll(path.sep, "/"),
      blockingCssBytes: resources.blockingCssBytes,
      blockingJsBytes: resources.blockingJsBytes,
      deferredJsBytes: resources.deferredJsBytes,
      moduleJsBytes: resources.moduleJsBytes,
      htmlBytes: Buffer.byteLength(html, "utf8"),
      blockingCss: resources.blockingCss,
      nonBlockingCss: resources.nonBlockingCss,
      blockingJs: resources.blockingJs,
      pageBundle,
      externalBlockingJs: resources.blockingJs.filter((item) => /^https?:/i.test(item.href)).length,
    };
  });
};

/**
 * 页级包校验（比只看属性更强的版本）：
 *   1. 页面里任何指向 `css/custom/pages/<name>.<hash>.css` 的 `<link>`，其产物必须真实存在；
 *   2. 若页面带 `data-solitude-custom-page="x"`，则链接里必须确有 `x.` 开头的产物（属性与实际链接一致）。
 */
export const checkPageBundles = (root, metrics) => {
  const pageDir = path.join(root, "css", "custom", "pages");
  const available = walkFiles(pageDir).map((file) => path.basename(file));
  const problems = [];

  for (const item of metrics) {
    const links = [...item.blockingCss, ...(item.nonBlocking ?? [])]
      .map((entry) => entry.href)
      .filter((href) => href.includes("/css/custom/pages/"));
    for (const href of links) {
      const name = path.basename(href);
      if (!available.includes(name)) problems.push({ page: item.page, kind: "missing", expected: name });
    }
    if (item.pageBundle) {
      const matched = links.some((href) => path.basename(href).startsWith(`${item.pageBundle}.`));
      if (!matched) problems.push({ page: item.page, kind: "mismatch", expected: `${item.pageBundle}.` });
    }
  }
  return problems;
};

/**
 * 清理文本里的「不是本地引用」的内容，避免误报：
 *  - 绝对 URL 与协议相对 URL（注意外链里可能含中文路径，例如图床的 `/博客/主题/xxx.jpg`，
 *    只靠「前一个字符」判断会把 URL 尾部误当成本地路径）
 *  - `<pre>` / `<code>` 里的代码块（文章里演示「图片语法怎么写」的示例不该算引用）
 */
export const sanitizeForLocalRefs = (text) =>
  text
    .replace(/https?:\/\/[^\s"'>)]+/gi, " ")
    .replace(/(^|[\s"'(=,])\/\/[^\s"'>)]+/g, "$1 ")
    .replace(/<pre[\s\S]*?<\/pre>/gi, " ")
    .replace(/<code[\s\S]*?<\/code>/gi, " ")
    /* 搜索索引/Feed 里会带 markdown 原文，代码围栏里的示例同样不是引用 */
    .replace(/```[\s\S]*?```/g, " ");

/**
 * 反向检查：产物里**被引用却不存在**的本地资源（= 运行时会 404 的坏链接）。
 *
 * 这是「未引用资源」的镜像方向。真实案例：`data/links.yaml` 的示例条目引用了
 * `/img/demo/friend-demo-avatar.webp`，而该文件在任何地方都不存在 —— 首页因此一直有一个坏图，
 * 但只看「有没有多余文件」永远发现不了。
 *
 * `search.xml` 是搜索索引：Hugo 会把正文（含「图片语法示例」这类文字）压成纯文本，
 * 里面的 URL 是**内容文本**而不是引用，且必然与正文页重复，故排除。
 */
export const SEARCH_INDEX_FILES = ["search.xml"];

export const findMissingAssets = (root) => {
  const files = walkFiles(root, (file) => {
    if (!TEXT_EXTENSIONS.includes(path.extname(file).toLowerCase())) return false;
    return !SEARCH_INDEX_FILES.includes(path.basename(file));
  });
  const pattern = new RegExp(
    `(/[A-Za-z0-9._~\\-/%]+\\.(?:${ASSET_EXTENSIONS.map((e) => e.slice(1)).join("|")}))\\b`,
    "gi",
  );
  const missing = new Map();
  for (const file of files) {
    const text = sanitizeForLocalRefs(fs.readFileSync(file, "utf8"));
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    for (const match of text.matchAll(pattern)) {
      const url = match[1].split(/[?#]/)[0];
      const target = path.join(root, decodeURIComponent(url.replace(/^\//, "")));
      if (fs.existsSync(target)) continue;
      if (!missing.has(url)) missing.set(url, new Set());
      missing.get(url).add(rel);
    }
  }
  return [...missing.entries()]
    .map(([url, refs]) => ({ url, referencedBy: [...refs].slice(0, 5), referenceCount: refs.size }))
    .sort((a, b) => b.referenceCount - a.referenceCount);
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const usage = `用法:
  node scripts/perf-budget.mjs [构建目录=public]
  node scripts/perf-budget.mjs public --save-baseline
  node scripts/perf-budget.mjs public --tolerance 0.02`;

const kb = (n) => `${(n / 1024).toFixed(1)}K`;

async function main() {
  const argv = process.argv.slice(2);
  const rootArg = argv.find((item) => !item.startsWith("--")) || "public";
  const saveBaseline = argv.includes("--save-baseline");
  const toleranceIndex = argv.indexOf("--tolerance");
  const tolerance = toleranceIndex >= 0 ? Number(argv[toleranceIndex + 1]) : 0.02;
  const strictAssets = argv.includes("--strict-assets");

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const root = path.resolve(repoRoot, rootArg);
  if (!fs.existsSync(root)) {
    console.log(`找不到构建目录 ${root}，先跑 hugo --minify`);
    process.exit(2);
  }
  const baselineFile = path.join(repoRoot, "scripts", "perf-budget.baseline.json");

  const metrics = collectPageMetrics(root);
  const unreferenced = findUnreferencedAssets(root);
  const missingAssets = findMissingAssets(root);
  const brokenBundles = checkPageBundles(root, metrics);

  console.log(`产物目录 ${path.relative(repoRoot, root) || "."}：${metrics.length} 个页面\n`);
  console.log("页型".padEnd(34) + "阻塞CSS".padStart(9) + "外链阻塞".padStart(9) + "阻塞JS".padStart(9) + "defer".padStart(8) + "module".padStart(8) + "HTML".padStart(9));
  const worst = {};
  for (const item of metrics) {
    const key = item.page.replace(/[^/]+$/, "") || "(root)";
    worst[key] = worst[key] || item;
    if (item.blockingCssBytes > worst[key].blockingCssBytes) worst[key] = item;
  }
  for (const item of Object.values(worst)) {
    console.log(
      item.page.padEnd(34) +
        kb(item.blockingCssBytes).padStart(9) +
        String(`${item.externalBlockingJs}个`).padStart(9) +
        kb(item.blockingJsBytes).padStart(9) +
        kb(item.deferredJsBytes).padStart(8) +
        kb(item.moduleJsBytes).padStart(8) +
        kb(item.htmlBytes).padStart(9),
    );
  }

  let failed = false;

  console.log(`\n[未引用资源] ${unreferenced.length} 个 / ${kb(unreferenced.reduce((s, i) => s + i.bytes, 0))}`);
  if (unreferenced.length) {
    failed = true;
    for (const item of unreferenced.slice(0, 12)) console.log(`  ✗ ${kb(item.bytes).padStart(8)}  ${item.url}`);
    if (unreferenced.length > 12) console.log(`  … 其余 ${unreferenced.length - 12} 个`);
  } else {
    console.log("  ✓ 没有未被引用的图片/字体");
  }

  console.log(`\n[坏链接] ${missingAssets.length ? `存在 ${missingAssets.length} 处被引用但不存在的资源` : "无"}`);
  if (missingAssets.length) {
    /* 默认只警告：这些都是**改动前就存在**的内容/主题问题（示例条目、主题期望站点提供的素材等），
       需要站长决定是补素材还是删条目；用 --strict-assets 可让其变成失败。 */
    if (strictAssets) failed = true;
    for (const item of missingAssets.slice(0, 10)) {
      console.log(`  ${strictAssets ? "✗" : "⚠"} ${item.url}（被 ${item.referenceCount} 处引用，例：${item.referencedBy[0]}）`);
    }
    if (missingAssets.length > 10) console.log(`  … 其余 ${missingAssets.length - 10} 个`);
    if (!strictAssets) console.log("  （以上为既有问题，未计入失败；--strict-assets 可强制失败）");
  } else {
    console.log("  ✓ 本地资源引用全部有对应文件");
  }

  console.log(`\n[页级包] ${brokenBundles.length ? "存在断链" : "全部存在"}`);
  for (const item of brokenBundles) {
    failed = true;
    const label = item.kind === "missing" ? "链接指向的产物不存在" : "属性声明的页级包与链接不一致";
    console.log(`  ✗ ${item.page}：${label}（期望包含 ${item.expected}）`);
  }

  if (saveBaseline) {
    const payload = {
      generatedAt: new Date().toISOString(),
      pages: metrics.map((item) => ({
        page: item.page,
        blockingCssBytes: item.blockingCssBytes,
        blockingJsBytes: item.blockingJsBytes,
        externalBlockingJs: item.externalBlockingJs,
        moduleJsBytes: item.moduleJsBytes,
        htmlBytes: item.htmlBytes,
      })),
    };
    fs.writeFileSync(baselineFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`\n已写入基线 ${path.relative(repoRoot, baselineFile)}`);
    if (failed) {
      console.log("注意：当前状态本身未通过（见上），基线只是记录现状用于后续对比。");
      process.exit(1);
    }
    return;
  }

  if (fs.existsSync(baselineFile)) {
    const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    const index = new Map(baseline.pages.map((item) => [item.page, item]));
    const regressions = [];
    for (const item of metrics) {
      const before = index.get(item.page);
      if (!before) continue;
      for (const field of ["blockingCssBytes", "blockingJsBytes", "moduleJsBytes", "externalBlockingJs"]) {
        if (field === "externalBlockingJs") {
          /* 外链阻塞脚本：数量必须不增加（它们各自带来一次握手，且串行阻塞解析） */
          if (item.externalBlockingJs > (before.externalBlockingJs ?? 0)) {
            regressions.push(`${item.page}：外链阻塞脚本 ${item.externalBlockingJs} 个 > 基线 ${before.externalBlockingJs ?? 0} 个`);
          }
          continue;
        }
        const limit = Math.round(before[field] * (1 + tolerance));
        if (item[field] > limit) regressions.push(`${item.page} 的 ${field}：${kb(item[field])} > 预算 ${kb(limit)}（基线 ${kb(before[field])}）`);
      }
    }
    console.log(`\n[预算对比] 基线 ${baseline.generatedAt?.slice(0, 10) || "?"}，容差 ${(tolerance * 100).toFixed(0)}%`);
    if (regressions.length) {
      failed = true;
      for (const item of regressions.slice(0, 12)) console.log(`  ✗ ${item}`);
    } else {
      console.log("  ✓ 所有页面均在预算内");
    }
  } else {
    console.log("\n[预算对比] 尚未记录基线，用 --save-baseline 记录当前指标");
  }

  console.log(failed ? "\n结论：未通过" : "\n结论：通过");
  if (failed) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
