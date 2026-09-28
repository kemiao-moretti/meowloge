# Pages CMS Hugo Publish Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为现有 Hugo 博客接入 Pages CMS，并建立“CMS 提交 main → 补齐 AI 摘要与 changelog 默认字段 → Hugo 构建验证 → Cloudflare Pages 发布”的自动发布链路。

**Architecture:** Pages CMS 通过仓库根目录 `.pages.yml` 管理 `content/posts` 和 `content/changelog` 两个 Markdown/YAML-frontmatter 集合，并将图片写入 `static/img`。现有 `deploy.yml` 扩展为单一串行发布工作流：先在工作树中生成自动字段并构建验证，验证成功后再提交机器人生成的变更，最后部署同一工作树的 `public/`；`GITHUB_TOKEN` 生成的提交不会递归触发普通 push 发布。

**Tech Stack:** Hugo Extended 0.166.0, Node.js ESM, Pages CMS `.pages.yml`, GitHub Actions, Cloudflare Wrangler Pages。

**Design Reference:** `docs/superpowers/specs/2026-09-28-pages-cms-hugo-publish-design.md`

---

### Task 1: 建立 front matter 归一化脚本的测试夹具

**Files:**
- Create: `scripts/ensure-content-defaults.test.mjs`
- Create: `scripts/fixtures/changelog-missing-build.md`
- Create: `scripts/fixtures/changelog-correct-build.md`
- Create: `scripts/fixtures/changelog-wrong-build.md`
- Create: `scripts/fixtures/changelog-no-frontmatter.md`

**Step 1: Write the failing tests**

在测试文件中使用 Node 内置 `node:test` 和 `node:assert/strict`。测试目标是后续从 `scripts/ensure-content-defaults.mjs` 导出的纯函数，不依赖 GitHub Actions 或实际仓库状态。

覆盖以下行为：

```js
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  ensureChangelogBuild,
  hasCanonicalBuild,
} from "./ensure-content-defaults.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name) => fs.readFileSync(path.join(fixturesDir, name), "utf8");

test("adds the canonical build block when it is missing", () => {
  const source = readFixture("changelog-missing-build.md");
  const result = ensureChangelogBuild(source);
  assert.match(result, /build:\n  render: never\n  list: local/);
  assert.match(result, /## 变更详情/);
});

test("does not rewrite a changelog that already has canonical build metadata", () => {
  const source = readFixture("changelog-correct-build.md");
  assert.equal(ensureChangelogBuild(source), source);
  assert.equal(hasCanonicalBuild(source), true);
});

test("replaces a non-canonical build block without changing the body", () => {
  const source = readFixture("changelog-wrong-build.md");
  const result = ensureChangelogBuild(source);
  assert.match(result, /build:\n  render: never\n  list: local/);
  assert.doesNotMatch(result, /render: always/);
  assert.match(result, /BODY_SENTINEL/);
});

test("preserves unrelated front matter and is idempotent", () => {
  const source = readFixture("changelog-missing-build.md");
  const result = ensureChangelogBuild(source);
  assert.match(result, /title: Missing build/);
  assert.match(result, /date: 2026-09-28T23:45:00\\+08:00/);
  assert.equal(ensureChangelogBuild(result), result);
});

test("ignores files without YAML front matter", () => {
  const source = readFixture("changelog-no-frontmatter.md");
  assert.equal(ensureChangelogBuild(source), source);
});
```

Fixture contents:

`scripts/fixtures/changelog-missing-build.md`

```markdown
---
title: Missing build
type: feature
version: v9.9.1
date: 2026-09-28T23:45:00+08:00
description: fixture
---

BODY_SENTINEL
```

`scripts/fixtures/changelog-correct-build.md`

```markdown
---
title: Correct build
type: feature
version: v9.9.2
date: 2026-09-28T23:45:00+08:00
description: fixture
build:
  render: never
  list: local
---

BODY_SENTINEL
```

`scripts/fixtures/changelog-wrong-build.md`

```markdown
---
title: Wrong build
type: feature
version: v9.9.3
date: 2026-09-28T23:45:00+08:00
description: fixture
build:
  render: always
  list: local
---

BODY_SENTINEL
```

`scripts/fixtures/changelog-no-frontmatter.md`

```markdown
No front matter here.
```

The fixtures must use the repository's `---` front matter delimiters and include a body sentinel. The correct fixture must verify byte-for-byte stability.

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test scripts/ensure-content-defaults.test.mjs
```

Expected: FAIL because `scripts/ensure-content-defaults.mjs` does not exist yet.

**Step 3: Commit the failing test and fixtures**

```bash
git add scripts/ensure-content-defaults.test.mjs scripts/fixtures
git commit -m "test: define changelog default normalization" -m "Made-with: Proma"
```

---

### Task 2: Implement changelog default normalization

**Files:**
- Create: `scripts/ensure-content-defaults.mjs`
- Modify: `scripts/ensure-content-defaults.test.mjs`

**Step 1: Implement pure normalization functions**

Implement the following dependency-free ESM module shape:

```js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_BUILD = `build:\n  render: never\n  list: local`;
const CANONICAL_BUILD_LINES = CANONICAL_BUILD.split("\n");
const FRONT_MATTER_RE = /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n|$)/;

function parseFrontMatter(source) {
  const match = source.match(FRONT_MATTER_RE);
  if (!match) return null;
  const [, openingNewline, frontMatter, closingNewline, afterClosing] = match;
  return {
    openingNewline,
    closingNewline,
    afterClosing,
    frontMatter,
    prefixLength: match[0].length,
  };
}

function buildRange(lines) {
  const start = lines.findIndex((line) => /^build\s*:/.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_-]+\s*:/.test(lines[end])) end += 1;
  return { start, end };
}

export function hasCanonicalBuild(source) {
  const parsed = parseFrontMatter(source);
  if (!parsed) return false;
  const lines = parsed.frontMatter.split(/\r?\n/);
  const range = buildRange(lines);
  return Boolean(range && lines.slice(range.start, range.end).join("\n") === CANONICAL_BUILD);
}

export function ensureChangelogBuild(source) {
  const parsed = parseFrontMatter(source);
  if (!parsed || hasCanonicalBuild(source)) return source;

  const lines = parsed.frontMatter.split(/\r?\n/);
  const range = buildRange(lines);
  const nextLines = range
    ? [...lines.slice(0, range.start), ...CANONICAL_BUILD_LINES, ...lines.slice(range.end)]
    : [...lines, ...CANONICAL_BUILD_LINES];
  const nextFrontMatter = nextLines.join(parsed.openingNewline);
  const body = source.slice(parsed.prefixLength);
  return `---${parsed.openingNewline}${nextFrontMatter}${parsed.closingNewline}---${parsed.afterClosing}${body}`;
}

async function walkMarkdown(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkMarkdown(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md") files.push(fullPath);
  }
  return files.sort();
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const directory = path.join(root, "content", "changelog");
  let changed = 0;
  for (const file of await walkMarkdown(directory)) {
    const source = await fs.readFile(file, "utf8");
    const next = ensureChangelogBuild(source);
    if (next === source) continue;
    await fs.writeFile(file, next, "utf8");
    changed += 1;
    console.log(`[ok] ${path.relative(root, file).replaceAll(path.sep, "/")}`);
  }
  console.log(`changelog defaults: changed ${changed} files`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
```

The implementation must preserve the complete body and must not use a broad YAML reserializer. If a front matter block has an ambiguous top-level shape, throw an error instead of deleting unrelated lines.

Required behavior:

- Only inspect the first YAML front matter block delimited by `---`.
- Return the original source unchanged if there is no valid front matter.
- Detect a top-level `build:` block and its indented child lines.
- Return the original source unchanged when the block is exactly canonical.
- If `build` is missing or differs from the canonical values, remove only the top-level block and insert the canonical block immediately before the closing `---`.
- Preserve every other front matter line, line ending style where practical, and the complete Markdown body.
- Do not process posts, `_index.md`, or files outside `content/changelog` in the CLI.

Keep the implementation dependency-free. Do not parse arbitrary YAML with a partial parser; constrain the edit to the known top-level `build` block and fail loudly if the front matter shape is ambiguous rather than deleting unrelated content.

**Step 2: Implement the CLI**

The CLI should recursively walk `content/changelog`, skip `_index.md`, read Markdown files, apply `ensureChangelogBuild`, and write only changed files. Print one line per changed file and a final count. Export the pure functions while guarding the CLI entry point so importing the module from tests does not scan the repository.

Expected command:

```bash
node scripts/ensure-content-defaults.mjs
```

Expected no-op output after normalization:

```text
changelog defaults: changed 0 files
```

**Step 3: Run focused tests**

```bash
node --test scripts/ensure-content-defaults.test.mjs
```

Expected: PASS for all normalization cases.

**Step 4: Run the CLI in the current repository**

```bash
node scripts/ensure-content-defaults.mjs
git diff -- content/changelog
```

Expected: existing changelog entries already have the canonical `build` block, so no content file should change. If any file changes, inspect the diff and ensure only a genuinely missing or non-canonical block was repaired.

**Step 5: Commit**

```bash
git add scripts/ensure-content-defaults.mjs scripts/ensure-content-defaults.test.mjs scripts/fixtures
git commit -m "feat: normalize changelog build defaults" -m "Made-with: Proma"
```

---

### Task 3: Add and validate the Pages CMS schema

**Files:**
- Create: `.pages.yml`

**Step 1: Write the configuration**

Create a root `.pages.yml` with these exact requirements:

```yaml
media:
  - name: images
    label: 图片
    input: static/img
    output: /img
    categories: [image]
    rename: safe

settings:
  content:
    merge: true

content:
  - name: posts
    label: 文章
    type: collection
    path: content/posts
    format: yaml-frontmatter
    exclude: [_index.md]
    filename:
      template: "{fields.slug}.md"
      field: false
    operations:
      rename: false
    view:
      fields: [title, date, description, tags]
      primary: title
      sort: [date, title]
      search: [title, description, tags]
      default:
        sort: date
        order: desc
    fields:
      - name: title
        label: 标题
        type: string
        required: true
      - name: slug
        label: Slug
        type: string
        required: true
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
        description: 新建文章填写英文 slug；已有 slug 不要修改，否则会改变文章 URL。
      - name: date
        label: 发布日期
        type: date
        required: true
        options:
          time: true
          format: "yyyy-MM-dd'T'HH:mm"
      - name: lastmod
        label: 最后修改时间
        type: string
        hidden: true
      - name: description
        label: 描述
        type: text
        required: true
      - name: cover
        label: 封面
        type: string
        description: 可填写 /img/... 本地路径或外部 HTTPS 图片 URL。
      - name: categories
        label: 分类
        type: string
        list: true
      - name: tags
        label: 标签
        type: string
        list: true
      - name: series
        label: 系列
        type: string
        list: true
      - name: toc
        label: 显示目录
        type: boolean
        default: false
      - name: comment
        label: 开启评论
        type: boolean
        default: true
      - name: locate
        label: 文章位置
        type: string
      - name: recommend
        label: 推荐文章
        type: boolean
        default: false
      - name: body
        label: 正文
        type: rich-text
        description: 普通 Markdown 可用编辑器；包含 Hugo shortcode、Mermaid、Chart.js JSON、复杂 HTML 或 shortcode 示例时必须切换 Source 模式。
        options:
          format: markdown
          switcher: true
          media: images
          path: posts
          rename: safe

  - name: changelog
    label: 更新日志
    type: collection
    path: content/changelog
    format: yaml-frontmatter
    exclude: [_index.md]
    filename:
      template: "{fields.version}.md"
      field: false
    operations:
      rename: false
    view:
      fields: [title, version, type, date]
      primary: title
      sort: [date, version]
      search: [title, version, description]
      default:
        sort: date
        order: desc
    fields:
      - name: title
        label: 标题
        type: string
        required: true
      - name: type
        label: 类型
        type: select
        required: true
        options:
          values: [feature, improvement, fix]
      - name: version
        label: 版本号
        type: string
        required: true
        pattern: "^v\\d+\\.\\d+\\.\\d+$"
      - name: date
        label: 日期
        type: date
        required: true
        options:
          time: true
          format: "yyyy-MM-dd'T'HH:mm"
      - name: description
        label: 描述
        type: text
        required: true
      - name: comment
        label: 开启评论
        type: boolean
        default: false
      - name: body
        label: 变更详情
        type: rich-text
        description: 普通 Markdown 可用编辑器；包含 Hugo shortcode 或复杂 Markdown 时必须切换 Source 模式。
        options:
          format: markdown
          switcher: true
          media: images
          path: posts
          rename: safe
```

**Step 2: Validate configuration and workflow syntax without adding runtime dependencies**

Run the repository-independent whitespace check:

```bash
git diff --check
```

If `actionlint` is already installed, validate the existing workflow syntax:

```bash
actionlint .github/workflows/deploy.yml
```

Do not install a production dependency solely to parse `.pages.yml`. The Pages CMS acceptance check in Task 6 is the authoritative schema validation; if the CMS reports a field or option error, fix `.pages.yml` before proceeding.

**Step 3: Review the schema against repository data**

Use read-only checks:

```bash
node - <<'NODE'
const fs = require('fs');
for (const file of ['content/posts/ai-summary.md', 'content/posts/shortcodes.md', 'content/changelog/v0.5.0-mobile-navigation-and-atom-feed.md']) {
  console.log(file, fs.readFileSync(file, 'utf8').split('\n').slice(0, 25).join('\n'));
}
NODE
```

Expected: every editable existing key remains represented or intentionally preserved by `merge`; `ai_summary`, `lastmod`, and `build` are not exposed for editing.

**Step 4: Commit**

```bash
git add .pages.yml
git commit -m "feat: configure Pages CMS content collections" -m "Made-with: Proma"
```

---

### Task 4: Update the publish workflow with summary-first deployment

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Step 1: Extend workflow inputs and permissions**

Keep `push.branches: [main]` and `workflow_dispatch`. Add the manual input:

```yaml
workflow_dispatch:
  inputs:
    force_summaries:
      description: Regenerate all post AI summaries
      required: false
      default: false
      type: boolean
```

Change top-level permissions to include:

```yaml
permissions:
  contents: write
  deployments: write
```

Keep the existing `concurrency` group and `cancel-in-progress: false`.

Immediately after checkout, capture the exact commit being built so a later generated-content push cannot overwrite a newer CMS commit:

```yaml
- name: 记录构建基线
  shell: bash
  run: echo "BASE_SHA=$(git rev-parse HEAD)" >> "$GITHUB_ENV"
```

**Step 2: Add the summary and normalization steps**

After checkout, install Node.js 22 with `actions/setup-node@v4`. Run the existing summary script with environment variables from GitHub Actions secrets/variables:

```yaml
- name: 生成缺失 AI 摘要
  env:
    AI_SUMMARY_API: ${{ secrets.AI_SUMMARY_API }}
    AI_SUMMARY_API_KEY: ${{ secrets.AI_SUMMARY_API_KEY }}
    AI_SUMMARY_MODEL: ${{ vars.AI_SUMMARY_MODEL || 'Qwen/Qwen3-8B' }}
    AI_SUMMARY_MAX_INPUT: ${{ vars.AI_SUMMARY_MAX_INPUT }}
    AI_SUMMARY_PROMPT: ${{ vars.AI_SUMMARY_PROMPT }}
  run: |
    set -euo pipefail
    # GitHub leaves optional vars as an empty environment value; unset the numeric
    # option so the script falls back to its built-in 12000-character limit.
    if [ -z "${AI_SUMMARY_MAX_INPUT:-}" ]; then unset AI_SUMMARY_MAX_INPUT; fi
    args=()
    if [ "${{ inputs.force_summaries }}" = "true" ]; then args+=(--force); fi
    node scripts/generate-ai-summary.mjs "${args[@]}"

- name: 归一化 changelog 构建字段
  run: node scripts/ensure-content-defaults.mjs
```

Use the repository's existing naming convention if the implementation chooses all values as `secrets` instead of mixing `secrets` and `vars`; never print the key. The API key must be a secret. Ensure an empty optional prompt/input does not become an invalid value in the script.

**Step 3: Build before committing generated changes**

Move Hugo installation and the build before the generated commit:

```yaml
- name: 安装 Hugo（extended）
  uses: peaceiris/actions-hugo@v3
  with:
    hugo-version: "0.166.0"
    extended: true

- name: 构建
  run: hugo --minify

- name: 检查产物
  run: |
    test -f public/index.html
    test -f public/p/shortcode-showcase.html
```

The exact shortcode output assertion should match the output produced by the current `uglyURLs.posts: true` configuration after one local Hugo build. Keep a stable assertion for `public/index.html` and the shortcode article, not a guessed path.

**Step 4: Commit generated changes only after build success and protect against races**

Add a shell step that captures the checkout SHA immediately after checkout, validates the tracked diff, and commits only generated front matter after the successful build:

```yaml
- name: 提交自动生成的 front matter
  shell: bash
  run: |
    set -euo pipefail
    changed="$(git status --short -- content/posts content/changelog)"
    unexpected="$(git status --short | grep -vE '^[ MARC?]{2} (content/posts/|content/changelog/)' || true)"
    if [ -n "$unexpected" ]; then
      echo "发现非预期工作树变更："
      printf '%s\n' "$unexpected"
      exit 1
    fi
    if [ -z "$changed" ]; then
      echo "没有需要提交的自动生成字段"
      exit 0
    fi
    git fetch origin main
    if [ "$(git rev-parse origin/main)" != "${BASE_SHA}" ]; then
      echo "origin/main 在本次构建期间发生变化，拒绝覆盖 CMS 新提交"
      exit 1
    fi
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add content/posts content/changelog
    git commit -m "ci: generate content metadata" -m "Made-with: Proma"
    git push origin HEAD:main
```

Before this step, add a step immediately after checkout that writes `BASE_SHA="$(git rev-parse HEAD)"` to `$GITHUB_ENV`. `public/`, `.hugo_build.lock`, and other ignored build output must not be staged. The deploy step must use the unchanged working tree after this commit; do not checkout again or reset it. A no-change run must still continue to the Cloudflare deployment step.

**Step 5: Keep Cloudflare deployment after generated commit**

Retain the current Wrangler project creation/deployment steps and secrets. Deployment must run only after Hugo succeeds and after any generated metadata commit succeeds. Do not change the Cloudflare project name (`blog`) or the existing Hugo submodule checkout behavior.

**Step 6: Validate workflow statically**

Run:

```bash
git diff --check
git diff -- .github/workflows/deploy.yml
```

If `actionlint` is installed, run:

```bash
actionlint .github/workflows/deploy.yml
```

Expected: no YAML/action expression errors. If `actionlint` is unavailable, record that limitation and rely on the local YAML review plus GitHub Actions syntax validation after push.

**Step 7: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: publish Hugo content after AI summaries" -m "Made-with: Proma"
```

---

### Task 5: Add operator documentation and local verification commands

**Files:**
- Modify: `README.md`

**Step 1: Document Pages CMS setup**

Document:

- Connect `kemiao-moretti/meowloge` to Pages CMS while viewing the `main` branch.
- CMS scope is only Posts and Changelog.
- New post slug rules and the fact that existing slugs/URLs must not be changed.
- Editor mode versus Source mode for Hugo shortcode content.
- Images upload to `static/img/posts` and render as `/img/posts/...`.
- Required GitHub Actions secrets/variables:
  - secret `AI_SUMMARY_API_KEY`;
  - optional secret `AI_SUMMARY_API`;
  - optional variable/secret `AI_SUMMARY_MODEL`;
  - optional `AI_SUMMARY_MAX_INPUT` and `AI_SUMMARY_PROMPT`;
  - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Normal publishing occurs automatically after CMS commit; no CMS deploy button is required.
- Manual Actions run with `force_summaries=false` for normal repair, and `true` only when all summaries must be regenerated.
- AI failure blocks deployment; rerun the workflow after the provider recovers.

**Step 2: Document local checks**

Include exact commands:

```bash
node --test scripts/ensure-content-defaults.test.mjs
node scripts/generate-ai-summary.mjs --dry-run
node scripts/ensure-content-defaults.mjs
hugo --minify
```

State that `.env` is local-only and must not be committed.

**Step 3: Verify documentation links and diff**

```bash
git diff --check
git grep -n "Pages CMS\|Source mode\|AI_SUMMARY_API_KEY" -- README.md
```

Expected: the setup, editing boundary, secrets, and retry behavior are discoverable.

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: explain Pages CMS publishing workflow" -m "Made-with: Proma"
```

---

### Task 6: Run end-to-end local verification and review the diff

**Files:**
- Test: `scripts/ensure-content-defaults.test.mjs`
- Verify: `.pages.yml`, `.github/workflows/deploy.yml`, `scripts/ensure-content-defaults.mjs`, documentation

**Step 1: Run the normalizer tests**

```bash
node --test scripts/ensure-content-defaults.test.mjs
```

Expected: all tests pass.

**Step 2: Run summary dry-run without a secret**

```bash
node scripts/generate-ai-summary.mjs --dry-run
```

Expected: candidate listing only, no Markdown files changed, and no API request.

**Step 3: Run the normalizer and verify idempotence**

```bash
node scripts/ensure-content-defaults.mjs
git diff -- content/changelog
node scripts/ensure-content-defaults.mjs
git diff -- content/changelog
```

Expected: existing canonical changelog files remain unchanged, and a second run produces no additional changes.

**Step 4: Build Hugo with the theme submodule**

```bash
hugo --gc --minify
```

Expected: exit code 0, no shortcode errors, and `public/index.html` plus the rendered shortcode showcase output exist. Remove only generated ignored output if needed; do not alter tracked source files.

**Step 5: Verify metadata preservation and scope**

```bash
git diff --stat
git status --short
```

Expected: no `.env`, `public/`, `.hugo_build.lock`, or theme-submodule changes are staged. Confirm no existing article URL or front matter was batch-rewritten.

**Step 6: Review the complete implementation diff**

```bash
git diff HEAD~5..HEAD -- .pages.yml .github/workflows/deploy.yml scripts README.md
```

Adjust the range to include all implementation commits. Check specifically that:

- only the intended collections are in `.pages.yml`;
- `settings.content.merge` is enabled;
- `ai_summary` is not user-editable;
- rename operations are disabled;
- summary failure precedes build and deployment;
- build failure precedes bot commit and deployment;
- generated commits contain the required trailer;
- secrets are referenced but never printed or hard-coded.

**Step 7: Perform the Pages CMS acceptance check**

After the configuration is pushed to the connected GitHub repository, sign in at `https://app.pagescms.org/` and verify:

1. The `posts` and `changelog` collections are visible while viewing `main`.
2. `_index.md` is not offered as an editable entry.
3. Existing `content/posts/shortcodes.md` opens with Markdown Source/Editor switching and its `ai_summary` and `lastmod` values remain present after a metadata-only save.
4. A temporary test post can be created with an English slug, produces `content/posts/<slug>.md`, and can upload an image under `static/img/posts` with a `/img/posts/...` reference.
5. A temporary changelog can be created with type `feature`, version `v0.0.0-test`, and the resulting file receives the canonical `build` block after the workflow.
6. Delete the temporary test entries only after verifying the resulting workflow and deployment behavior; do not delete existing production content.

Record any Pages CMS UI behavior that differs from the documented schema and update the configuration before claiming completion.

**Step 8: Commit any verification-only fixes**

If verification reveals a defect, fix it with a focused test first, rerun the relevant checks, and commit with a specific message ending in:

```text
Made-with: Proma
```

Do not claim completion until the local tests, Hugo build, YAML/action review, and final diff review have evidence.
