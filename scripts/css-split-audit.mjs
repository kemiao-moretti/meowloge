/**
 * CSS 分片审计工具。
 *
 * 背景：站点覆盖层 `assets/css/custom.css` 是一条**无 layer** 的规则流，靠「最后加载 +
 * 不分层」压过主题全部 `@layer solitude.*`；因此它的**规则先后顺序就是层叠语义的一部分**。
 * 拆分成分片（`assets/css/custom/**`）后，聚合根的 `@import` 顺序必须与原单文件行序完全一致，
 * 否则同权重选择器的胜负会静默改变 —— 这类问题肉眼极难发现，故用机械审计兜住：
 *
 *  1. 结构审计（默认）：@import 清单与分片目录一一对应（无缺失 / 无孤儿 / 无重复 / 无空片），
 *     且分片里不得出现 `@charset` 与嵌套 `@import`（内联到文件中段后会失效或打乱顺序）。
 *  2. 展开序列：把聚合根展开成有序规则序列，用于与参照产物比对。
 *  3. 产物等价比对（--compare A B）：两份构建产物先比字节，再退化为「有序规则序列」比对，
 *     用来验证一次拆分前后没有规则被增删或重排。
 *  4. 选择器重叠审计（--overlap <组A目录> <组B目录>）：为「真实按页加载」做准备 ——
 *     两组分片的选择器若不相交，则它们的相对顺序不影响层叠结果。
 *
 * 已知边界：`--compare` 适合比对**同一管线产出的两份产物**（这时通常逐字节相等）。
 * 若拿「手写源码」和「构建产物」比，构建管线会插入源码里没有的声明（如按 target 自动补的
 * `-webkit-backdrop-filter`），这属于管线行为而非拆分差异，工具无法也不应把它归一化掉。
 *
 * 用法：
 *   node scripts/css-split-audit.mjs
 *   node scripts/css-split-audit.mjs --compare <旧产物.css> <新产物.css>
 *   node scripts/css-split-audit.mjs --overlap <目录A> <目录B>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 分片目录（相对站点根）。 */
export const FRAGMENT_DIR = "assets/css/custom";
/** 聚合根（相对站点根）：主题 styles.html 固定以这个路径取资源。 */
export const AGGREGATOR_PATH = "assets/css/custom.css";
/** 页级包目录（相对站点根）：文件名必须等于主题 styles.html 的页型键。 */
export const PAGE_DIR = "assets/css/custom/pages";

/* ------------------------------------------------------------------ *
 * 1. 极简 CSS 扫描器
 * ------------------------------------------------------------------ */

const skipComment = (source, index) => {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
};

const skipString = (source, index) => {
  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === "\\") { i += 2; continue; }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return source.length;
};

/** `url(...)`：未加引号的实参里可能出现 `;` `,` `)` 等，必须整体跳过。 */
const skipUrl = (source, index) => {
  let i = index + 4;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'") { i = skipString(source, i); continue; }
    if (ch === ")") return i + 1;
    if (ch === "\\") { i += 2; continue; }
    i += 1;
  }
  return source.length;
};

export const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * 把样式表解析成**有序的叶子规则**序列。
 *
 * 叶子规则 = 体内不再含块的规则（`.a{...}`、`@font-face{...}`、`@keyframes` 里的 `0%{...}`）。
 * 容器（`@media`/`@supports`/`@layer` 等有子块的 at-rule）自身不产出规则，其子规则的
 * `context` 记录容器链，因此「@media 内部的规则」与「顶层同名规则」不会混淆。
 *
 * @returns {{ context: string[], selector: string, body: string }[]}
 */
export function parseCssRules(source) {
  const rules = [];
  /** @type {{ prelude: string, bodyStart: number, rulesAtEntry: number }[]} */
  const stack = [];
  let prelude = "";
  let i = 0;

  /** enclosing = 已弹出的本层之外仍在栈上的容器链（调用方在 pop 之后传入）。 */
  const flushLeaf = (entry, bodyEnd, enclosing) => {
    const body = source.slice(entry.bodyStart, bodyEnd);
    /* 体内还有块 ⇒ 这是容器，子规则已经各自产出，容器本身不再作为规则。 */
    if (rules.length > entry.rulesAtEntry) return;
    rules.push({
      context: enclosing.map((item) => normalizePrelude(item.prelude)),
      selector: normalizeNthSpacing(normalizeAttributeQuotes(normalizePrelude(entry.prelude))),
      body: normalizeBody(body),
    });
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "*") { i = skipComment(source, i); continue; }
    if (ch === '"' || ch === "'") { prelude += source.slice(i, (i = skipString(source, i))); continue; }
    if ((ch === "u" || ch === "U") && /^url\(/i.test(source.slice(i, i + 4))) {
      prelude += source.slice(i, (i = skipUrl(source, i)));
      continue;
    }
    if (ch === "{") {
      stack.push({ prelude, bodyStart: i + 1, rulesAtEntry: rules.length });
      prelude = "";
      i += 1;
      continue;
    }
    if (ch === "}") {
      const entry = stack.pop();
      if (entry) flushLeaf(entry, i, stack);
      prelude = "";
      i += 1;
      continue;
    }
    if (ch === ";") { prelude = ""; i += 1; continue; }
    prelude += ch;
    i += 1;
  }
  return rules;
}

const normalizePrelude = (text) => stripComments(text).replace(/\s+/g, " ").trim();

/**
 * 属性选择器引号规范化：`[a="b"]` 与 `[a=b]` 是同一条规则，但源码与构建产物会各写一种
 * （Hugo 的 CSS 管线会把可省引号省掉）。不归一化就会把纯写法差异误报成规则变化。
 * 只处理可安全去引号的值（合法标识符），需要引号的值（含空格等）保持原样。
 */
const normalizeAttributeQuotes = (text) =>
  text.replace(
    /\[\s*([^\]=]+?)\s*=\s*(["'])([A-Za-z0-9_-]+)\2(\s*[iIsS])?\s*\]/g,
    (_all, name, _quote, value, flag) => `[${name}=${value}${flag || ""}]`,
  );

/**
 * 选择器里的 An+B 写法：`nth-child(3n + 2)` 与 `nth-child(3n+2)` 完全等价，
 * 但源码与构建产物各写一种，需要归一化（只处理 `数n + 数` 这种形态，不碰 `+` 兄弟选择器）。
 */
const normalizeNthSpacing = (text) => text.replace(/([0-9n])\s*\+\s*([0-9])/gi, "$1+$2");

/** 声明体归一化：只压平空白与分隔符周围空隙，**不改动声明顺序**（顺序同样是层叠语义）。 */
const normalizeBody = (text) =>
  stripComments(text)
    .replace(/\s+/g, " ")
    .replace(/\s*([:;,])\s*/g, "$1")
    /* 构建产物的 CSS 打印器会写成 `fn( arg )`，与源码 `fn(arg)` 等价。 */
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/;\s*$/, "")
    .trim();

/** 规则签名：同签名 = 同一条规则；顺序由序列位置表达。 */
export const ruleSignature = (rule) =>
  `${rule.context.join(" || ")} :: ${rule.selector} :: ${rule.body}`;

/**
 * 把选择器列表切成单个选择器，**只在括号外的顶层逗号处切**。
 *
 * 直接用 `split(",")` 是错的：`X :is(pre, figure.highlight, .code-block)` 会被切成
 * `X :is(pre` / `figure.highlight` / `.code-block)`，凭空造出一个并不存在的 `figure.highlight`
 * 规则 —— 按选择器做任何比对（重叠、等价、覆盖率）都会因此得出错误结论。
 */
export const splitSelectorList = (selector) => {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const ch of selector) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
};

/** 把样式表展开成「单选择器 → 声明表」。
 *  必须先展开到单选择器：压缩器会把相邻同声明规则合并/拆开，按规则键比对会误报。 */
export const explodeDeclarations = (rules) => {
  const map = new Map();
  for (const rule of rules) {
    const context = rule.context.join(" || ");
    for (const selector of splitSelectorList(rule.selector)) {
      const key = `${context} :: ${selector}`;
      const merged = map.get(key) || new Map();
      for (const part of rule.body.split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const index = trimmed.indexOf(":");
        if (index === -1) continue;
        merged.set(trimmed.slice(0, index).trim().toLowerCase(), trimmed.slice(index + 1).trim());
      }
      map.set(key, merged);
    }
  }
  return map;
};

/** 有序规则签名序列。 */
export const ruleSequence = (source) => parseCssRules(source).map(ruleSignature);

/* ------------------------------------------------------------------ *
 * 2. @import 清单
 * ------------------------------------------------------------------ */

/** 读取顶层 `@import`，返回有序清单。 */
export function readImports(source) {
  const clean = stripComments(source);
  const found = [];
  const pattern = /@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?\s*([^;]*);/g;
  let match;
  while ((match = pattern.exec(clean)) !== null) {
    const tail = match[3].trim();
    const layer = /layer\(([^)]*)\)/.exec(tail);
    const media = tail.replace(/layer\([^)]*\)/g, "").trim();
    found.push({ target: match[2], layer: layer ? layer[1] : "", media });
  }
  return found;
}

/**
 * 展开一个入口 CSS 的 `@import` 链，返回按内联顺序排列的文件列表（入口在最前）。
 * `hugo:vars` 之类带 scheme 的以及外链一律跳过；用 seen 防循环。
 */
export function expandCssFiles(entryFile, seen = new Set()) {
  const resolved = path.resolve(entryFile);
  if (seen.has(resolved) || !fs.existsSync(resolved)) return [];
  seen.add(resolved);
  const files = [resolved];
  for (const item of readImports(fs.readFileSync(resolved, "utf8"))) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(item.target) || item.target.startsWith("//")) continue;
    const next = path.resolve(path.dirname(resolved), item.target);
    files.push(...expandCssFiles(next, seen));
  }
  return files;
}

/* ------------------------------------------------------------------ *
 * 3. 结构审计
 * ------------------------------------------------------------------ */

const walkCssFiles = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkCssFiles(full);
      return entry.isFile() && entry.name.endsWith(".css") ? [full] : [];
    })
    .sort();
};

/**
 * 审计聚合根与其分片目录的一致性。
 * @param {string} root 站点根目录
 */
export function auditFragments(root = process.cwd()) {
  const aggregatorFile = path.join(root, AGGREGATOR_PATH);
  const aggregatorSource = fs.readFileSync(aggregatorFile, "utf8");
  const imports = readImports(aggregatorSource);
  const fragmentRoot = path.join(root, FRAGMENT_DIR);

  const missing = [];
  const empty = [];
  const nestedCharset = [];
  const nestedImport = [];
  const duplicateImports = [];
  const seen = new Set();
  const referenced = new Set();
  let expandedRuleCount = 0;

  for (const item of imports) {
    if (seen.has(item.target)) duplicateImports.push(item.target);
    seen.add(item.target);
    /* @import "./custom/x.css" 与聚合根同目录基准（assets/css/） */
    const resolved = path.resolve(path.dirname(aggregatorFile), item.target);
    referenced.add(path.resolve(resolved));
    if (!fs.existsSync(resolved)) { missing.push(item.target); continue; }
    const body = fs.readFileSync(resolved, "utf8");
    const fragmentRules = parseCssRules(body).length;
    expandedRuleCount += fragmentRules;
    if (fragmentRules === 0) empty.push(item.target);
    if (/@charset/i.test(stripComments(body))) nestedCharset.push(item.target);
    if (readImports(body).length > 0) nestedImport.push(item.target);
  }

  /* pages/ 子树由主题的页级注入点（按页型加载）引用，不属于聚合根的引用范围，
     否则会被误报成「未被引用的分片」。 */
  const pageDir = path.resolve(fragmentRoot, "pages");
  const orphans = walkCssFiles(fragmentRoot)
    .filter((file) => !referenced.has(path.resolve(file)))
    .filter((file) => !path.resolve(file).startsWith(pageDir + path.sep))
    .map((file) => path.relative(root, file).replaceAll(path.sep, "/"));

  /* 聚合根本身不该直接写规则：那些规则会落在所有分片之前，静默改变层叠顺序。 */
  const aggregatorRuleCount = parseCssRules(aggregatorSource).length;

  return {
    aggregator: AGGREGATOR_PATH,
    importCount: imports.length,
    imports,
    expandedRuleCount,
    aggregatorRuleCount,
    missing,
    empty,
    orphans,
    duplicateImports,
    nestedCharset,
    nestedImport,
    ok:
      missing.length === 0 &&
      empty.length === 0 &&
      orphans.length === 0 &&
      duplicateImports.length === 0 &&
      nestedCharset.length === 0 &&
      nestedImport.length === 0 &&
      aggregatorRuleCount === 0,
  };
}

/* ------------------------------------------------------------------ *
 * 4. 页级包审计（阶段 B：按页型加载）
 * ------------------------------------------------------------------ */

/**
 * 页级包（`assets/css/custom/pages/<页型键>.css`，由主题 styles.html 的注入点按页型加载）审计：
 *
 *  1. 每个包展开后必须至少有一条规则（空包 = 页型键写错或分片搬空了）。
 *  2. **包与「全站包」之间、包彼此之间不得存在层叠冲突**（同一属性被赋不同值）。
 *     理由：swup 无刷新切页时样式表只增不减，同一页里可能同时存在多个页级包，
 *     一旦出现冲突，同一个页面的样式就会随「用户从哪一页走过来」而变化。
 *     这条不变式必须由工具守住，而不是靠人记得。
 */
export function auditPageScope(root = process.cwd()) {
  const alwaysFiles = expandCssFiles(path.join(root, AGGREGATOR_PATH));
  const pageDir = path.join(root, PAGE_DIR);
  /* 只看 pages/ 顶层文件：pages/post/*.css 是包内分片，不是可加载的包。 */
  const bundleFiles = fs.existsSync(pageDir)
    ? fs
        .readdirSync(pageDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
        .map((entry) => path.join(pageDir, entry.name))
        .sort()
    : [];

  const bundles = bundleFiles.map((file) => ({
    name: path.basename(file, ".css"),
    rel: path.relative(root, file).replaceAll(path.sep, "/"),
    files: expandCssFiles(file),
  }));

  const emptyBundles = bundles
    .filter((bundle) => bundle.files.every((file) => parseCssRules(fs.readFileSync(file, "utf8")).length === 0))
    .map((bundle) => bundle.rel);

  const conflicts = [];
  for (const bundle of bundles) {
    for (const item of compareSelectorGroups(bundle.files, alwaysFiles)) {
      if (item.conflict) conflicts.push({ pair: `${bundle.name} × 全站包`, selector: item.selector });
    }
  }
  for (let i = 0; i < bundles.length; i += 1) {
    for (let j = i + 1; j < bundles.length; j += 1) {
      for (const item of compareSelectorGroups(bundles[i].files, bundles[j].files)) {
        if (item.conflict) conflicts.push({ pair: `${bundles[i].name} × ${bundles[j].name}`, selector: item.selector });
      }
    }
  }

  return {
    bundles: bundles.map((bundle) => ({ name: bundle.name, fragments: bundle.files.length - 1 })),
    emptyBundles,
    conflicts,
    ok: emptyBundles.length === 0 && conflicts.length === 0,
  };
}

/* ------------------------------------------------------------------ *
 * 5. 产物等价比对
 * ------------------------------------------------------------------ */

/**
 * 比对两份构建产物。
 * 先比字节；字节不同时退化为有序规则序列比对（压缩器可能改写无关紧要的空白/声明写法）。
 */
export function compareArtifacts(fileA, fileB) {
  const bufA = fs.readFileSync(fileA);
  const bufB = fs.readFileSync(fileB);
  if (bufA.equals(bufB)) {
    return { identical: true, bytes: bufA.length, mode: "byte" };
  }
  const diff = diffRuleSequences(bufA.toString("utf8"), bufB.toString("utf8"));
  return { identical: diff.identical, mode: "rule-sequence", bytesA: bufA.length, bytesB: bufB.length, ...diff };
}

/** 有序规则序列比对：区分「缺规则 / 多规则 / 仅顺序不同」。 */
export function diffRuleSequences(referenceSource, candidateSource) {
  const ref = ruleSequence(referenceSource);
  const cand = ruleSequence(candidateSource);

  if (ref.length === cand.length && ref.every((sig, index) => sig === cand[index])) {
    return { identical: true, ruleCount: ref.length, missing: [], extra: [], reordered: [] };
  }

  const countOf = (list) => {
    const map = new Map();
    for (const sig of list) map.set(sig, (map.get(sig) || 0) + 1);
    return map;
  };
  const refCount = countOf(ref);
  const candCount = countOf(cand);
  const missing = [];
  const extra = [];
  for (const [sig, count] of refCount) {
    const other = candCount.get(sig) || 0;
    for (let i = other; i < count; i += 1) missing.push(sig);
  }
  for (const [sig, count] of candCount) {
    const other = refCount.get(sig) || 0;
    for (let i = other; i < count; i += 1) extra.push(sig);
  }

  const reordered = [];
  if (missing.length === 0 && extra.length === 0) {
    /* 多重集相同 ⇒ 只是顺序变了，报出首个发散点。 */
    let index = 0;
    while (index < ref.length && ref[index] === cand[index]) index += 1;
    const at = (list) => `${list[index] ?? "(end)"}`;
    reordered.push({ index, reference: at(ref), candidate: at(cand) });
  }

  return { identical: false, ruleCount: ref.length, candidateRuleCount: cand.length, missing, extra, reordered };
}

/* ------------------------------------------------------------------ *
 * 6. 选择器重叠审计（为按页加载把关）
 * ------------------------------------------------------------------ */

/** 解析声明体为「属性 → 值」，用于判断同选择器两处规则是否真的会互相覆盖。 */
const declarationsOf = (body) => {
  const map = new Map();
  for (const part of body.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(":");
    if (index === -1) continue;
    map.set(trimmed.slice(0, index).trim().toLowerCase(), trimmed.slice(index + 1).trim());
  }
  return map;
};

/**
 * 把一组文件里的每个选择器按出现顺序合并成「属性 → 值」的最终生效表。
 * 这代表「这组文件排在最后时该选择器的结果」，因此两组对比结果相同 ⇒ 两组谁先谁后都无所谓。
 */
const effectiveDeclarations = (files) => {
  const perSelector = new Map();
  for (const file of files) {
    for (const rule of parseCssRules(fs.readFileSync(file, "utf8"))) {
      const key = `${rule.context.join(" || ")} :: ${rule.selector}`;
      const merged = perSelector.get(key) || new Map();
      for (const [property, value] of declarationsOf(rule.body)) merged.set(property, value);
      perSelector.set(key, merged);
    }
  }
  return perSelector;
};

/**
 * 比对两组分片的同名选择器。
 *
 * `conflict: true` 的判据是「**同一个属性**被两组赋了**不同的值**」——
 * 此时谁排在后面谁就赢，加载顺序会改变结果。
 * 若 B 只是比 A 多写了别的属性、或对同一属性写了相同的值，则顺序无关：
 * 例如 A=`{max-width:none;background:none}` 与 B=`{background:none}`，
 * 无论谁在后，`max-width` 都只由 A 提供、`background` 两边一致，最终结果相同。
 */
export function compareSelectorGroups(filesA, filesB) {
  const a = effectiveDeclarations(filesA);
  const b = effectiveDeclarations(filesB);
  const shared = [];
  for (const [key, mapA] of a) {
    const mapB = b.get(key);
    if (!mapB) continue;
    const conflict = [...mapA.entries()].some(([property, value]) => mapB.has(property) && mapB.get(property) !== value);
    shared.push({ selector: key, conflict, inA: mapA.size, inB: mapB.size });
  }
  return shared;
}

/** 一个 CSS 文件的规则选择器索引（含 context 前缀），用于重叠判断。 */
export function selectorIndex(source) {
  const index = new Map();
  for (const rule of parseCssRules(source)) {
    const key = `${rule.context.join(" || ")} :: ${rule.selector}`;
    index.set(key, (index.get(key) || 0) + 1);
  }
  return index;
}

/**
 * 比对两组分片目录的选择器集合。
 * 两组不相交（或重合但声明一致）⇒ 它们的相对加载顺序不影响层叠结果。
 */
export function findSelectorOverlaps(dirA, dirB) {
  return compareSelectorGroups(walkCssFiles(dirA), walkCssFiles(dirB));
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const usage = `用法:
  node scripts/css-split-audit.mjs
  node scripts/css-split-audit.mjs --compare <参照产物.css> <待检产物.css>
  node scripts/css-split-audit.mjs --overlap <目录A> <目录B>`;

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [flag, ...rest] = process.argv.slice(2);

  if (flag === "--compare") {
    const [fileA, fileB] = rest;
    if (!fileA || !fileB) { console.log(usage); process.exit(2); }
    const result = compareArtifacts(fileA, fileB);
    if (result.identical) {
      console.log(`[ok] 两份产物等价（${result.mode === "byte" ? "逐字节一致" : "规则序列一致"}，${result.ruleCount ?? result.bytes} 项）`);
      return;
    }
    console.log(`[diff] 产物不等价（比对方式 ${result.mode}）`);
    console.log(`  规则数: 参照 ${result.ruleCount} / 待检 ${result.candidateRuleCount}`);
    if (result.missing?.length) console.log(`  缺失规则 ${result.missing.length} 条，例如:\n    - ${result.missing.slice(0, 5).join("\n    - ")}`);
    if (result.extra?.length) console.log(`  多出规则 ${result.extra.length} 条，例如:\n    + ${result.extra.slice(0, 5).join("\n    + ")}`);
    if (result.reordered?.length) console.log(`  顺序变化: 首个发散点 #${result.reordered[0].index}\n    参照: ${result.reordered[0].reference}\n    待检: ${result.reordered[0].candidate}`);
    process.exit(1);
  }

  if (flag === "--overlap") {
    const [dirA, dirB] = rest;
    if (!dirA || !dirB) { console.log(usage); process.exit(2); }
    const overlaps = findSelectorOverlaps(path.resolve(root, dirA), path.resolve(root, dirB));
    const conflicts = overlaps.filter((item) => item.conflict);
    if (overlaps.length === 0) {
      console.log("[ok] 两组分片选择器不相交，相对加载顺序不影响层叠结果");
      return;
    }
    if (conflicts.length === 0) {
      console.log(`[ok] 重合 ${overlaps.length} 个选择器，但声明完全一致 —— 顺序仍不影响结果`);
      return;
    }
    console.log(`[warn] ${conflicts.length} 个选择器两组声明不同，按页加载会因顺序改变结果:`);
    for (const item of conflicts.slice(0, 20)) console.log(`  - ${item.selector}`);
    process.exit(1);
  }

  const report = auditFragments(root);
  const pageScope = auditPageScope(root);
  console.log(`聚合根 ${report.aggregator}：${report.importCount} 个 @import / 展开后 ${report.expandedRuleCount} 条规则`);
  console.log(
    `页级包 ${pageScope.bundles.length} 个：` +
      (pageScope.bundles.map((bundle) => `${bundle.name}(${bundle.fragments} 片)`).join(", ") || "(无)"),
  );
  const problems = [
    ["缺失分片", report.missing],
    ["空分片", report.empty],
    ["未被引用的分片", report.orphans],
    ["重复 @import", report.duplicateImports],
    ["分片内含 @charset", report.nestedCharset],
    ["分片内含嵌套 @import", report.nestedImport],
    ["聚合根里直接写了规则（应移入分片）", report.aggregatorRuleCount ? [`${report.aggregatorRuleCount} 条`] : []],
    ["空页级包", pageScope.emptyBundles],
    [
      "页级包层叠冲突（按页加载会随浏览路径变样）",
      pageScope.conflicts.map((item) => `${item.pair} → ${item.selector}`),
    ],
  ];
  for (const [label, list] of problems) {
    if (list.length) console.log(`  ✗ ${label}（${list.length}）: ${list.slice(0, 5).join(", ")}${list.length > 5 ? " …" : ""}`);
  }
  if (report.ok && pageScope.ok) console.log("[ok] 分片与聚合根一一对应；页级包无空包、与全站包及彼此之间零层叠冲突");
  else process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
