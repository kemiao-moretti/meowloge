import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPageBundles,
  collectPageMetrics,
  findMissingAssets,
  findUnreferencedAssets,
  isAssetReferenced,
  parsePageResources,
  sanitizeForLocalRefs,
  walkFiles,
} from "./perf-budget.mjs";

const makeTree = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "perf-budget-"));
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf8");
  }
  return root;
};

test("parsePageResources separates blocking from non-blocking css", () => {
  const html = `
    <link rel="stylesheet" href="/css/a.css">
    <link rel="stylesheet" href="/css/b.css" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="/css/c.css"></noscript>
    <script src="/js/blocking.js"></script>
    <script defer src="/js/deferred.js"></script>
    <script async src="/js/async.js"></script>
    <script type="module" src="/js/app.js"></script>
  `;
  const sizes = { "/css/a.css": 1000, "/css/b.css": 2000, "/css/c.css": 3000, "/js/blocking.js": 100, "/js/deferred.js": 200, "/js/async.js": 300, "/js/app.js": 400 };
  const result = parsePageResources(html, (href) => sizes[href] ?? null);
  assert.deepEqual(result.blockingCss.map((i) => i.href), ["/css/a.css"]);
  assert.deepEqual(result.nonBlockingCss.map((i) => i.href), ["/css/b.css", "/css/c.css"]);
  assert.equal(result.blockingCssBytes, 1000);
  assert.deepEqual(result.blockingJs.map((i) => i.href), ["/js/blocking.js"]);
  assert.deepEqual(result.deferredJs.map((i) => i.href), ["/js/deferred.js", "/js/async.js"]);
  assert.deepEqual(result.moduleJs.map((i) => i.href), ["/js/app.js"]);
  assert.equal(result.blockingJsBytes, 100);
});

test("parsePageResources ignores unquoted attributes and external sizes", () => {
  const html = '<link rel=stylesheet href=/css/a.css><script src="https://cdn.example.com/x.js"></script>';
  const result = parsePageResources(html, () => null);
  assert.equal(result.blockingCss.length, 1);
  assert.equal(result.blockingCss[0].href, "/css/a.css");
  assert.equal(result.blockingJs.length, 1);
  assert.equal(result.blockingJs[0].bytes, 0); /* 外链无法本地计量，记 0 而不是崩 */
});

test("parsePageResources does not mistake a lazy marker's data-consent-src for a script source", () => {
  /* 本站 Umami 的写法：type=text/plain + data-consent-src，浏览器既不执行也不请求 */
  const html =
    '<script type="text/plain" data-consent="analytics" data-consent-src="https://um.example.xyz/script.js" data-consent-attr-data-website-id="x"></script>' +
    '<script defer src="https://cdn.example.com/real.js"></script>';
  const result = parsePageResources(html, () => null);
  assert.deepEqual(result.blockingJs, [], "被拦脚本不是阻塞资源");
  assert.deepEqual(result.deferredJs.map((i) => i.href), ["https://cdn.example.com/real.js"]);
});

test("isAssetReferenced matches by url and by basename", () => {
  const corpus = ["<img src=/img/foo.webp>", "background:url(icon.png)"];
  assert.equal(isAssetReferenced("/img/foo.webp", corpus), true);
  assert.equal(isAssetReferenced("/other/icon.png", corpus), true); /* 只按文件名也算被引用（偏保守） */
  assert.equal(isAssetReferenced("/img/unused.webp", corpus), false);
});

test("findUnreferencedAssets reports only truly unreferenced asset types", () => {
  const root = makeTree({
    "index.html": '<img src="/img/used.png"><link href="/img/only-basename.webp">',
    "css/a.css": "body{background:url(/fonts/f.woff2)}",
    "img/used.png": "x",
    "img/only-basename.webp": "x",
    "img/orphan.png": "xxxx",
    "fonts/f.woff2": "x",
    "data/notes.json": "{}", /* 不是资源类型，不参与判定 */
  });
  const result = findUnreferencedAssets(root);
  assert.deepEqual(result.map((i) => i.url), ["/img/orphan.png"]);
  assert.equal(result[0].bytes, 4);
});

test("checkPageBundles detects a missing page-level bundle", () => {
  const root = makeTree({
    "index.html": "x",
    "about/index.html": '<link rel="stylesheet" href="/css/custom/pages/about.abc.css" data-solitude-custom-page="about">',
    "css/custom/pages/about.abc.css": ".a{}",
    "stats/index.html": '<link rel="stylesheet" href="/css/custom/pages/stats.def.css">',
  });
  const metrics = collectPageMetrics(root);
  const broken = checkPageBundles(root, metrics);
  assert.deepEqual(broken, [{ page: "stats/index.html", kind: "missing", expected: "stats.def.css" }]);
});

test("checkPageBundles flags a bundle whose attribute disagrees with the link", () => {
  const root = makeTree({
    "p/a.html": '<link rel="stylesheet" href="/css/custom/pages/about.abc.css" data-solitude-custom-page="post">',
    "css/custom/pages/about.abc.css": ".a{}",
  });
  const broken = checkPageBundles(root, collectPageMetrics(root));
  assert.deepEqual(broken, [{ page: "p/a.html", kind: "mismatch", expected: "post." }]);
});

test("collectPageMetrics picks up the page bundle marker and html bytes", () => {
  const root = makeTree({
    "p/a.html": '<link rel=stylesheet href=/css/c.css data-solitude-custom-page=post>',
    "css/c.css": "12345",
  });
  const [item] = collectPageMetrics(root);
  assert.equal(item.page, "p/a.html");
  assert.equal(item.pageBundle, "post");
  assert.equal(item.blockingCssBytes, 5);
  assert.equal(item.htmlBytes, Buffer.byteLength('<link rel=stylesheet href=/css/c.css data-solitude-custom-page=post>', "utf8"));
});

test("findMissingAssets reports referenced-but-absent local assets", () => {
  const root = makeTree({
    "index.html": '<img src="/img/present.webp"><img src="/img/absent.webp">',
    "about/index.html": '<img src="/img/absent.webp">',
    "css/a.css": "body{background:url(/img/absent.webp)}",
    "img/present.webp": "x",
  });
  const missing = findMissingAssets(root);
  assert.deepEqual(missing.map((i) => i.url), ["/img/absent.webp"]);
  assert.equal(missing[0].referenceCount, 3);
  assert.ok(missing[0].referencedBy.includes("index.html"));
});

test("sanitizeForLocalRefs removes external urls, protocol-relative urls and code blocks", () => {
  const cleaned = sanitizeForLocalRefs(
    '<img src="https://cdn.example.com/a.webp"><img src="//other.example.com/b.png">' +
      '<img src="https://r2.example.xyz/file/博客/主题/123_photo.jpg">' +
      "<pre>![示例](/img/posts/example.webp)</pre><code>/img/inline.svg</code>" +
      "```markdown\n![索引示例](/img/posts/from-index.webp)\n```<img src=/img/keep.png>",
  );
  assert.ok(!cleaned.includes("a.webp"));
  assert.ok(!cleaned.includes("b.png"));
  assert.ok(!cleaned.includes("123_photo.jpg"), "中文路径的外链尾部不能被误当成本地路径");
  assert.ok(!cleaned.includes("example.webp"));
  assert.ok(!cleaned.includes("inline.svg"));
  assert.ok(!cleaned.includes("from-index.webp"), "围栏代码块里的示例（搜索索引会收录）也不算引用");
  assert.ok(cleaned.includes("/img/keep.png"));
});

test("findMissingAssets ignores absolute external urls", () => {
  const root = makeTree({
    "index.html": '<img src="https://cdn.example.com/a.webp"><img src="//other.example.com/b.png">',
  });
  assert.deepEqual(findMissingAssets(root), []);
});

test("findMissingAssets ignores page routes and query strings it cannot resolve", () => {
  const root = makeTree({
    "index.html": '<a href="/about/">about</a><img src="/img/a.webp?v=2">',
    "img/a.webp": "x",
  });
  assert.deepEqual(findMissingAssets(root), []);
});

test("findMissingAssets skips the plain-text search index but still scans feeds", () => {
  const root = makeTree({
    "index.html": "x",
    "search.xml": "<item>文章示例 /img/posts/example.webp</item>",
    "atom.xml": '<img src="/img/feed-only.webp">',
  });
  const missing = findMissingAssets(root);
  assert.deepEqual(missing.map((i) => i.url), ["/img/feed-only.webp"]);
});

test("walkFiles filters by predicate and returns sorted absolute paths", () => {
  const root = makeTree({ "a/1.html": "x", "a/b/2.html": "x", "a/3.css": "x" });
  const htmlFiles = walkFiles(root, (file) => file.endsWith(".html"));
  assert.deepEqual(htmlFiles.map((f) => path.relative(root, f).replaceAll(path.sep, "/")), ["a/1.html", "a/b/2.html"]);
  assert.deepEqual(walkFiles(path.join(root, "missing")), []);
});
