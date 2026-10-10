import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  auditFragments,
  auditPageScope,
  compareArtifacts,
  diffRuleSequences,
  expandCssFiles,
  explodeDeclarations,
  findSelectorOverlaps,
  parseCssRules,
  readImports,
  ruleSequence,
  selectorIndex,
  splitSelectorList,
} from "./css-split-audit.mjs";

/** 在临时目录里搭一棵最小站点树，避免测试依赖真实仓库内容。 */
const makeTree = (aggregator, fragments) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "css-split-audit-"));
  fs.mkdirSync(path.join(root, "assets/css/custom"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets/css/custom.css"), aggregator, "utf8");
  for (const [rel, body] of Object.entries(fragments)) {
    const target = path.join(root, "assets/css/custom", rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf8");
  }
  return root;
};

test("parses flat rules in source order", () => {
  const rules = parseCssRules("a{color:red}\n.b{color:blue}");
  assert.deepEqual(rules, [
    { context: [], selector: "a", body: "color:red" },
    { context: [], selector: ".b", body: "color:blue" },
  ]);
});

test("keeps declaration order inside a body", () => {
  const [rule] = parseCssRules(".a{margin:0;padding:1px;color:red}");
  assert.equal(rule.body, "margin:0;padding:1px;color:red");
});

test("strips comments including ones that contain braces", () => {
  const rules = parseCssRules("/* { not a block } */a{color:red}/* } */");
  assert.equal(rules.length, 1);
  assert.equal(ruleSequence("/* { not a block } */a{color:red}")[0], " :: a :: color:red");
});

test("ignores braces and semicolons inside strings", () => {
  const rules = parseCssRules('.a{content:"}{;"}');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, ".a");
  assert.match(rules[0].body, /content:"\}\{;"$/);
});

test("ignores semicolons and parens inside unquoted url()", () => {
  const css = ".a{background:url(data:image/svg+xml;charset=utf8,<svg/>)}.b{color:red}";
  const rules = parseCssRules(css);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].selector, ".a");
  assert.equal(rules[1].selector, ".b");
});

test("records at-rule containers as context instead of emitting them", () => {
  const rules = parseCssRules("@media (max-width:768px){.a{color:red}.b{color:blue}}");
  assert.deepEqual(rules.map((rule) => rule.selector), [".a", ".b"]);
  assert.deepEqual(rules.map((rule) => rule.context), [
    ["@media (max-width:768px)"],
    ["@media (max-width:768px)"],
  ]);
});

test("keeps nested keyframe stops distinct from top-level rules", () => {
  const rules = parseCssRules("@keyframes spin{0%{opacity:0}100%{opacity:1}}.a{color:red}");
  assert.deepEqual(rules.map((rule) => [rule.context.join(""), rule.selector]), [
    ["@keyframes spin", "0%"],
    ["@keyframes spin", "100%"],
    ["", ".a"],
  ]);
});

test("emits block at-rules without children as leaf rules", () => {
  const rules = parseCssRules('@font-face{font-family:"x";src:url(x.woff2)}');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, "@font-face");
});

test("discards statement at-rules and stray declarations", () => {
  assert.deepEqual(parseCssRules('@charset "UTF-8";@import "x.css";@layer a,b;'), []);
});

test("normalizes whitespace without merging distinct rules", () => {
  const a = ruleSequence("a{color:red}\nb{color:blue}");
  const b = ruleSequence("a { color : red ; }\n\nb{color:blue;}");
  assert.deepEqual(a, b);
});

test("reads imports with layer and media tails", () => {
  const imports = readImports(`
    @import "./a.css";
    @import "./b.css" layer(base);
    @import url("./c.css") layer(site) screen and (min-width: 40em);
    @import "external.css" print;
  `);
  assert.deepEqual(imports, [
    { target: "./a.css", layer: "", media: "" },
    { target: "./b.css", layer: "base", media: "" },
    { target: "./c.css", layer: "site", media: "screen and (min-width: 40em)" },
    { target: "external.css", layer: "", media: "print" },
  ]);
});

test("does not treat commented-out imports as real imports", () => {
  assert.deepEqual(readImports('/* @import "./gone.css"; */\n@import "./kept.css";'), [
    { target: "./kept.css", layer: "", media: "" },
  ]);
});

test("audit passes when fragments and aggregator match one to one", () => {
  const root = makeTree('@import "./custom/foundation/tokens.css";\n@import "./custom/pages/post.css";\n', {
    "foundation/tokens.css": ":root{--paper-ink:#000}",
    "pages/post.css": ".post-content{margin:0}",
  });
  const report = auditFragments(root);
  assert.equal(report.ok, true);
  assert.equal(report.importCount, 2);
  assert.equal(report.expandedRuleCount, 2);
  assert.equal(report.aggregatorRuleCount, 0);
});

test("audit reports missing, empty, orphaned and duplicated fragments", () => {
  const root = makeTree(
    '@import "./custom/a.css";\n@import "./custom/a.css";\n@import "./custom/empty.css";\n@import "./custom/gone.css";\n',
    { "a.css": ".a{color:red}", "empty.css": "/* 只有注释 */", "orphan.css": ".o{color:red}" },
  );
  const report = auditFragments(root);
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ["./custom/gone.css"]);
  assert.deepEqual(report.empty, ["./custom/empty.css"]);
  assert.deepEqual(report.orphans, ["assets/css/custom/orphan.css"]);
  assert.deepEqual(report.duplicateImports, ["./custom/a.css"]);
});

test("audit rejects @charset and nested @import inside a fragment", () => {
  const root = makeTree('@import "./custom/a.css";\n@import "./custom/b.css";\n', {
    "a.css": '@charset "UTF-8";\n.a{color:red}',
    "b.css": '@import "./nested.css";\n.b{color:blue}',
  });
  const report = auditFragments(root);
  assert.equal(report.ok, false);
  assert.deepEqual(report.nestedCharset, ["./custom/a.css"]);
  assert.deepEqual(report.nestedImport, ["./custom/b.css"]);
});

test("audit flags rules written directly in the aggregator", () => {
  const root = makeTree('@import "./custom/a.css";\n.loose{color:red}\n', { "a.css": ".a{color:red}" });
  const report = auditFragments(root);
  assert.equal(report.ok, false);
  assert.equal(report.aggregatorRuleCount, 1);
  assert.equal(report.expandedRuleCount, 1);
});

test("normalizes attribute-selector quoting to avoid false rule diffs", () => {
  assert.deepEqual(
    ruleSequence('[data-theme="dark"]{color:red}[data-x=y]{color:blue}[data-z="a b"]{color:green}'),
    ruleSequence("[data-theme=dark]{color:red}[data-x=y]{color:blue}[data-z=\"a b\"]{color:green}"),
  );
  /* 需要引号的值（含空格）不得被去引号 */
  assert.equal(ruleSequence('[data-z="a b"]{color:green}')[0], ' :: [data-z="a b"] :: color:green');
});

test("does not touch quoted strings inside declaration bodies", () => {
  const [rule] = parseCssRules('.a{content:"[data-theme=dark]"}[data-theme="dark"]{color:red}');
  assert.equal(rule.body, 'content:"[data-theme=dark]"');
  assert.equal(parseCssRules('[data-theme="dark"]{color:red}')[0].selector, "[data-theme=dark]");
});

test("normalizes An+B spacing and function-call padding", () => {
  assert.equal(
    ruleSequence(".a:nth-child(3n + 2){background:repeating-linear-gradient( 0deg,red 0 1px)}")[0],
    ruleSequence(".a:nth-child(3n+2){background:repeating-linear-gradient(0deg,red 0 1px)}")[0],
  );
  /* `+` 作为兄弟选择器时不得被吞掉空格 */
  assert.equal(ruleSequence(".a + .b{color:red}")[0], " :: .a + .b :: color:red");
});

test("expand follows nested imports in order and skips external targets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "css-expand-"));
  fs.writeFileSync(path.join(root, "entry.css"), '@import "hugo:vars";\n@import "./a.css";\n@import "https://cdn.example.com/x.css";\n', "utf8");
  fs.writeFileSync(path.join(root, "a.css"), '@import "./nested/b.css";\n.a{color:red}', "utf8");
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested/b.css"), ".b{color:blue}", "utf8");
  const files = expandCssFiles(path.join(root, "entry.css")).map((f) => path.basename(f));
  assert.deepEqual(files, ["entry.css", "a.css", "b.css"]);
});

test("expand tolerates import cycles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "css-cycle-"));
  fs.writeFileSync(path.join(root, "x.css"), '@import "./y.css";\n.x{a:1}', "utf8");
  fs.writeFileSync(path.join(root, "y.css"), '@import "./x.css";\n.y{b:2}', "utf8");
  const files = expandCssFiles(path.join(root, "x.css")).map((f) => path.basename(f));
  assert.deepEqual(files, ["x.css", "y.css"]);
});

test("page scope audit passes when bundles are disjoint from the always bundle", () => {
  const root = makeTree('@import "./custom/core.css";\n', {
    "core.css": ".core{color:red}",
    "pages/post.css": '@import "./post/typography.css";\n',
    "pages/post/typography.css": ".article-container{padding:0}",
    "pages/about.css": "#about-page .bolt{width:1px}",
  });
  const report = auditPageScope(root);
  assert.equal(report.ok, true);
  assert.deepEqual(report.bundles, [
    { name: "about", fragments: 0 },
    { name: "post", fragments: 1 },
  ]);
  assert.deepEqual(report.emptyBundles, []);
  assert.deepEqual(report.conflicts, []);
  /* pages/post/*.css 是包内分片，不算独立包，也不该被判成「未被引用的分片」 */
  assert.deepEqual(auditFragments(root).orphans, []);
});

test("page scope audit flags an empty bundle", () => {
  const root = makeTree('@import "./custom/core.css";\n', {
    "core.css": ".core{color:red}",
    "pages/typo.css": "/* 页型键写错或分片搬空了 */",
  });
  const report = auditPageScope(root);
  assert.equal(report.ok, false);
  assert.deepEqual(report.emptyBundles, ["assets/css/custom/pages/typo.css"]);
});

test("page scope audit flags conflicts with the always bundle and between bundles", () => {
  const root = makeTree('@import "./custom/core.css";\n', {
    "core.css": ".shared{color:red}",
    "pages/post.css": ".shared{color:blue}", /* 与全站包冲突 */
    "pages/about.css": ".shared{color:red}", /* 与全站包重复但同值：不算冲突 */
    "pages/message.css": ".only{margin:0}",
    "pages/post/extra.css": ".only{padding:0}", /* 跨包同属性不同值由 bundle 间接造成 */
  });
  const report = auditPageScope(root);
  assert.equal(report.ok, false);
  const pairs = report.conflicts.map((item) => item.pair);
  assert.ok(pairs.includes("post × 全站包"), `期望命中 post × 全站包，实际 ${JSON.stringify(pairs)}`);
  assert.ok(!pairs.includes("about × 全站包"), "同值的重合不应算冲突");
});

test("splitSelectorList splits only on top-level commas", () => {
  /* 朴素 split(",") 会把 :is(...) 切开，凭空造出并不存在的选择器 —— 这正是必须用括号感知切分的原因 */
  assert.deepEqual(splitSelectorList("X :is(pre, figure.highlight, .code-block)"), ["X :is(pre, figure.highlight, .code-block)"]);
  assert.deepEqual(splitSelectorList(":not(.a, .b), .c"), [":not(.a, .b)", ".c"]);
  assert.deepEqual(splitSelectorList(".a, .b ,.c"), [".a", ".b", ".c"]);
  /* 属性选择器值里的逗号也不能切 */
  assert.deepEqual(splitSelectorList('[data-x="a,b"], .d'), ['[data-x="a,b"]', ".d"]);
  assert.deepEqual(splitSelectorList(""), []);
});

test("explodeDeclarations keys by single selector and merges in order", () => {
  const map = explodeDeclarations(parseCssRules(".a, .b{color:red}.a{color:blue}"));
  assert.deepEqual([...map.keys()].sort(), [" :: .a", " :: .b"]);
  assert.equal(map.get(" :: .a").get("color"), "blue"); /* 后写覆盖前写 */
  assert.equal(map.get(" :: .b").get("color"), "red");
  /* :is() 内部保持整体，不会被拆成假选择器 */
  const nested = explodeDeclarations(parseCssRules(".wrap :is(h2, h3)::before{color:red}"));
  assert.deepEqual([...nested.keys()], [" :: .wrap :is(h2, h3)::before"]);
  /* 上下文参与键，media 内外的同名选择器不混淆 */
  const media = explodeDeclarations(parseCssRules("@media print{.a{color:black}}"));
  assert.deepEqual([...media.keys()], ["@media print :: .a"]);
});

test("diff reports identical sequences", () => {
  const result = diffRuleSequences(".a{color:red}.b{color:blue}", ".a{color:red}.b{color:blue}");
  assert.equal(result.identical, true);
  assert.equal(result.ruleCount, 2);
});

test("diff detects a missing rule", () => {
  const result = diffRuleSequences(".a{color:red}.b{color:blue}", ".a{color:red}");
  assert.equal(result.identical, false);
  assert.deepEqual(result.missing, [" :: .b :: color:blue"]);
  assert.deepEqual(result.extra, []);
});

test("diff detects an extra rule", () => {
  const result = diffRuleSequences(".a{color:red}", ".a{color:red}.z{color:green}");
  assert.equal(result.identical, false);
  assert.deepEqual(result.extra, [" :: .z :: color:green"]);
});

test("diff distinguishes reordering from add/drop", () => {
  const result = diffRuleSequences(".a{color:red}.b{color:blue}", ".b{color:blue}.a{color:red}");
  assert.equal(result.identical, false);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra, []);
  assert.equal(result.reordered.length, 1);
  assert.equal(result.reordered[0].index, 0);
});

test("compare hits the byte fast path for identical artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "css-split-compare-"));
  const a = path.join(dir, "a.css");
  const b = path.join(dir, "b.css");
  fs.writeFileSync(a, ".a{color:red}", "utf8");
  fs.writeFileSync(b, ".a{color:red}", "utf8");
  const result = compareArtifacts(a, b);
  assert.equal(result.identical, true);
  assert.equal(result.mode, "byte");
});

test("compare falls back to rule sequences when bytes differ cosmetically", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "css-split-compare-"));
  const a = path.join(dir, "a.css");
  const b = path.join(dir, "b.css");
  fs.writeFileSync(a, ".a{color:red}\n", "utf8");
  fs.writeFileSync(b, "/* built */\n.a{color:red}", "utf8");
  const result = compareArtifacts(a, b);
  assert.equal(result.identical, true);
  assert.equal(result.mode, "rule-sequence");
});

test("selector index keeps media context separate from top level", () => {
  const index = selectorIndex(".a{color:red}@media print{.a{color:black}}");
  assert.ok(index.has(" :: .a"));
  assert.ok(index.has("@media print :: .a"));
  assert.equal(index.size, 2);
});

test("overlap audit distinguishes conflicting from benign shared selectors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "css-split-overlap-"));
  fs.mkdirSync(path.join(root, "a"), { recursive: true });
  fs.mkdirSync(path.join(root, "b"), { recursive: true });
  /* .same 两组声明一致（重复书写，与顺序无关）；.diff 两组声明不同（顺序决定胜负） */
  fs.writeFileSync(path.join(root, "a/one.css"), ".same{color:red}.diff{color:red}.only-a{color:red}", "utf8");
  fs.writeFileSync(path.join(root, "b/two.css"), ".same{color:red}.diff{color:blue}.only-b{color:blue}", "utf8");
  const overlaps = findSelectorOverlaps(path.join(root, "a"), path.join(root, "b"));
  assert.deepEqual(overlaps, [
    { selector: " :: .same", conflict: false, inA: 1, inB: 1 },
    { selector: " :: .diff", conflict: true, inA: 1, inB: 1 },
  ]);

  /* 同一选择器在组内出现多次时，比的是合并后的最终生效声明 */
  fs.writeFileSync(path.join(root, "b/two.css"), ".same{color:blue}.same{color:red}.diff{color:blue}", "utf8");
  const merged = findSelectorOverlaps(path.join(root, "a"), path.join(root, "b"));
  assert.equal(merged.find((item) => item.selector === " :: .same").conflict, false);

  fs.writeFileSync(path.join(root, "b/two.css"), ".only-b{color:blue}", "utf8");
  assert.deepEqual(findSelectorOverlaps(path.join(root, "a"), path.join(root, "b")), []);
});

test("overlap audit does not flag a later group that only adds unrelated properties", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "css-split-subset-"));
  fs.mkdirSync(path.join(root, "a"), { recursive: true });
  fs.mkdirSync(path.join(root, "b"), { recursive: true });
  /* B 是 A 的子集（值相同）：谁在后结果都一样，不是冲突 */
  fs.writeFileSync(path.join(root, "a/one.css"), ".x{max-width:none;background:none}", "utf8");
  fs.writeFileSync(path.join(root, "b/two.css"), ".x{background:none}", "utf8");
  assert.deepEqual(findSelectorOverlaps(path.join(root, "a"), path.join(root, "b")), [
    { selector: " :: .x", conflict: false, inA: 2, inB: 1 },
  ]);

  /* 同一属性被赋不同值才是冲突 */
  fs.writeFileSync(path.join(root, "b/two.css"), ".x{max-width:100%}", "utf8");
  assert.deepEqual(findSelectorOverlaps(path.join(root, "a"), path.join(root, "b")), [
    { selector: " :: .x", conflict: true, inA: 2, inB: 1 },
  ]);
});
