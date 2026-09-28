# Pages CMS 与 Hugo 自动发布设计

> 状态：待用户审阅
>
> 日期：2026-09-28
>
> 项目：`E:/kemiao-kmoretti/blog/blog`

## 1. 目标与已确认决策

为现有 Hugo 博客接入 Pages CMS，使作者可以通过 GitHub 登录的 CMS 编辑文章和更新日志。CMS 保存后，GitHub Actions 自动完成摘要补齐、内容规范化、Hugo 构建和 Cloudflare Pages 发布。

已确认：

- Pages CMS 直接提交到 `main`，不引入 `edit` 分支或 Pull Request 发布流程。
- 第一版只开放 `content/posts` 和 `content/changelog`。
- 新文章创建时填写英文 slug，并使用同一个 slug 作为文件名；不根据中文标题自动生成 URL。
- 正文使用 Markdown 富文本编辑器，并保留 Editor/Source 双模式切换。
- 含 Hugo shortcode、Mermaid、Chart.js 数据或复杂 HTML 的文章使用 Source 模式。
- AI 摘要只补齐缺失的 `ai_summary`，普通编辑不自动重生成已有摘要。
- AI 摘要生成失败时阻断构建和部署。
- 媒体上传写入 Hugo 的 `static/img`，公开路径使用 `/img/...`，文件名使用安全清理。
- changelog 的 `build` 字段不作为日常写作字段；已有值保留，新建条目由发布流程补齐为 `render: never`、`list: local`。

## 2. 项目现状与约束

Hugo 项目位于当前仓库根目录，远程仓库为 `kemiao-moretti/meowloge`，默认分支为 `main`。站点使用 Hugo Extended `0.166.0` 和 `themes/solitude` Git submodule。

文章链接由以下配置决定：

```yaml
permalinks:
  posts: /p/:slug
```

因此文件名和 front matter 的 `slug` 需要保持稳定，接入 CMS 不得批量改名或改变已有 URL。

现有 `scripts/generate-ai-summary.mjs`：

- 遍历 `content/posts/**/*.md`；
- 默认跳过已有 `ai_summary` 的文章；
- 从 `AI_SUMMARY_API`、`AI_SUMMARY_API_KEY`、`AI_SUMMARY_MODEL` 等环境变量读取配置；
- 生成摘要后写回文章 front matter；
- 任一文章失败时返回非零退出码。

现有 `.github/workflows/deploy.yml` 在 `main` push 或手动触发时使用 Hugo 构建，并通过 Wrangler 部署到 Cloudflare Pages 项目 `blog`。

## 3. 推荐架构

采用一个有序的发布工作流，而不是拆成互相依赖的两个 workflow：

```text
Pages CMS commit to main
        |
        v
publish workflow
  1. checkout main
  2. generate missing AI summaries
  3. normalize changelog build defaults
  4. hugo --minify and verify output
  5. commit verified generated changes back to main
  6. deploy public/ to Cloudflare Pages
```

这样同一轮发布使用已经生成摘要和补齐构建元数据的工作树。工作流使用 `GITHUB_TOKEN` 回写生成文件；由该 token 推送的 commit 不会再次触发普通 push workflow，从而避免摘要提交后的重复发布。

保留 `workflow_dispatch`：默认只补齐缺失摘要，并提供 `force_summaries` 布尔输入，在确实需要时显式使用 `--force` 重生成全部文章摘要。A 策略下不额外添加 CMS“部署”按钮。

## 4. Pages CMS 配置

在仓库根目录新增 `.pages.yml`。关键全局配置：

```yaml
settings:
  content:
    merge: true
```

`merge: true` 使 `lastmod`、`ai_summary`、未来新增的 Hugo front matter 等未纳入编辑表单的键在 CMS 保存时继续保留，而不是被结构化编辑器重写掉。

### 4.1 媒体

使用一个命名媒体源 `images`：

- `input: static/img`
- `output: /img`
- `categories: [image]`
- `rename: safe`

正文 Markdown 图片通过 `images` 媒体源上传，默认路径为 `static/img/posts`，生成 `/img/posts/...`。封面字段当前同时存在本地路径和外部 URL，因此封面使用可保留任意 URL 的 `string` 字段，并提供本地 `/img/...` 写法说明；不强制把历史外部封面迁移为 CMS image 字段。媒体库仍可用于正文图片和 Pages CMS 侧栏的图片管理。

### 4.2 posts 集合

- `name: posts`
- `path: content/posts`
- `format: yaml-frontmatter`
- `exclude: ["_index.md"]`
- 新建文件模板使用 `{fields.slug}.md`，隐藏独立的文件名输入，避免文件名与 front matter 的 slug 分离；slug 必填，并限制为小写英文、数字和连字符。
- 禁止通过 CMS 重命名已有文件；已有文章的 slug 不应修改，因为它决定文章 URL。
- 列表主字段为 `title`，按 `date` 倒序，搜索 `title`、`description`、`tags`。

编辑字段：

| 字段 | CMS 类型 | 规则 |
| --- | --- | --- |
| `title` | `string` | 必填 |
| `slug` | `string` | 必填；`^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `date` | `date` | 必填；`time: true`，格式 `yyyy-MM-dd'T'HH:mm`，按站点 Asia/Shanghai 解释 |
| `lastmod` | `date` | 隐藏；已有值由 `merge` 保留，不在 CMS 中编辑 |
| `description` | `text` | 必填，用于卡片和 SEO 描述 |
| `cover` | `string` | 可选；支持 `/img/...` 和外部 HTTPS URL |
| `categories` | `string` list | 可选 |
| `tags` | `string` list | 可选 |
| `series` | `string` list | 可选 |
| `toc` | `boolean` | 可选，默认 false |
| `comment` | `boolean` | 可选，默认 true |
| `locate` | `string` | 可选 |
| `recommend` | `boolean` | 可选，默认 false |
| `body` | `rich-text` | Markdown 格式；`media: images`、`path: posts`，开启 Editor/Source 切换 |

`ai_summary` 不在编辑界面暴露，由自动化脚本管理；`settings.content.merge: true` 保证它不会因 CMS 保存而丢失。

新建文章时文件名与 front matter 的 slug 都由同一字段驱动；已有文章的文件名和 slug 不在接入时批量调整。实现验证必须确认 Pages CMS 对 `{fields.slug}` 的新建文件名计算符合预期，并确认隐藏文件名输入后不会产生额外的重命名操作。

### 4.3 changelog 集合

- `name: changelog`
- `path: content/changelog`
- `format: yaml-frontmatter`
- `exclude: ["_index.md"]`
- 新建文件模板使用 `{fields.version}.md`，隐藏独立的文件名输入；版本号限制为 `vX.Y.Z`。
- 禁止通过 CMS 重命名已有日志文件。
- 列表主字段为 `title`，按 `date` 倒序，搜索 `title`、`version`、`description`。

编辑字段：

| 字段 | CMS 类型 | 规则 |
| --- | --- | --- |
| `title` | `string` | 必填 |
| `type` | `select` | `feature`、`improvement`、`fix` |
| `version` | `string` | 必填；`^v\\d+\\.\\d+\\.\\d+$` |
| `date` | `date` | 必填；`time: true`，格式 `yyyy-MM-dd'T'HH:mm`，按站点 Asia/Shanghai 解释 |
| `description` | `text` | 必填 |
| `comment` | `boolean` | 可选，默认 false |
| `body` | `rich-text` | Markdown 格式；`media: images`、`path: posts`，开启 Editor/Source 切换 |

主题当前只为 `feature`、`improvement`、`fix` 提供筛选和图标，因此不在 CMS 中提供其他类型，避免新值无法正确显示。

`build` 不在 CMS 表单中编辑。Pages CMS object 字段没有对象级默认值配置，因此发布流程新增确定性的 `scripts/ensure-content-defaults.mjs`：对缺失或不完整的 changelog front matter 写入：

```yaml
build:
  render: never
  list: local
```

已有正确的 `build` 不改写。

## 5. Shortcode 与正文兼容策略

主题 shortcode 位于 `themes/solitude/layouts/_shortcodes`，包括提示框、折叠、标签页、Mermaid、Chart.js、视频、音频和卡片等组件。Pages CMS 不解析 Hugo shortcode，只负责编辑 Markdown 文件。

1. Markdown Source 模式是 shortcode 的权威编辑模式。
2. 普通段落、标题、列表、链接和标准 Markdown 可使用 Editor 模式。
3. 含 `{{< ... >}}`、`{{% ... %}}`、Mermaid、Chart.js JSON、复杂 HTML 或 shortcode 代码示例的文章，编辑正文前切换到 Source 模式。
4. 不把 shortcode 做成 Pages CMS 自定义组件，避免重复实现 Hugo 主题能力。
5. 发布验证至少构建现有 `content/posts/shortcodes.md`，确认 shortcode 未被配置改动破坏。

## 6. 发布工作流

修改现有 `.github/workflows/deploy.yml`：

- 触发器：`push.branches: [main]` 和 `workflow_dispatch`；
- 手动输入 `force_summaries`，默认 `false`；
- 权限使用 `contents: write` 和 `deployments: write`；
- 使用现有 `concurrency`，同一时间只处理一个发布。

步骤：

1. checkout 当前 `main`，使用 `fetch-depth: 0`；
2. 安装 Node.js；
3. 按 `force_summaries` 运行摘要脚本，失败立即退出；
4. 运行 changelog front matter 归一化脚本；
5. 安装 Hugo Extended `0.166.0`；
6. 执行 `hugo --minify`，让构建先验证摘要和归一化结果；
7. 检查 `public/index.html` 与关键文章输出存在；
8. 若有脚本生成的变更，确认远端 `main` 没有在本次运行期间前进，以 `github-actions[bot]` 身份提交并 push 到 `main`；
9. 使用 Cloudflare API Token、Account ID 和 Wrangler 部署 `public/`。

环境变量只通过 GitHub Actions Secrets 提供：

- `AI_SUMMARY_API`
- `AI_SUMMARY_API_KEY`
- `AI_SUMMARY_MODEL`
- 可选的 `AI_SUMMARY_MAX_INPUT`、`AI_SUMMARY_PROMPT`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

不把任何密钥写入 `.pages.yml`、Hugo 配置、文章 front matter 或日志。

摘要脚本返回非零状态时，工作流不运行归一化脚本、Hugo 构建或 Cloudflare 部署。Hugo 构建失败时也不提交脚本生成的摘要或默认字段。作者可以从 Actions 页面重新运行；Cloudflare 部署失败发生在源文件提交之后，后续手动运行可重试部署。

若生成脚本需要回写内容，提交步骤必须处理 push 竞争：使用 workflow concurrency 串行化；push 前重新 fetch 并确认工作树仍基于最新 `origin/main`，若远端在运行期间已有新 CMS commit，则让本次运行失败并要求重新运行，而不是覆盖 CMS 修改。

## 7. 文件变更范围

实现阶段预计：

- Create: `.pages.yml`
- Modify: `.github/workflows/deploy.yml`
- Create: `scripts/ensure-content-defaults.mjs`
- Optionally update: `README.md`，补充 CMS 登录、Source 模式、Actions Secrets 和失败重试说明

不修改：

- 现有文章正文和 URL；
- `themes/solitude` submodule；
- 友链、赞助、说说和其他运行时工作流；
- `.env` 或任何真实密钥文件。

## 8. 验证标准

1. `.pages.yml` 能被 Pages CMS 加载，posts 和 changelog 集合可见。
2. 新建文章生成正确的 `content/posts/<slug>.md`，front matter 和正文可被 Hugo 读取。
3. 编辑已有 shortcode 文章时，Source 模式保存后 shortcode 保持成对且 Hugo 构建通过。
4. 新建 changelog 自动得到正确的 `build.render` 和 `build.list`。
5. CMS 保存已有文章时，`ai_summary`、`lastmod` 等未展示字段不会丢失。
6. 无摘要文章能由 Actions 写入 `ai_summary`；已有摘要在普通发布时不被覆盖。
7. 摘要接口失败时工作流失败且不执行 Hugo/Cloudflare 部署。
8. 摘要成功后 Hugo 使用包含新摘要的工作树构建，并部署 Cloudflare Pages。
9. `workflow_dispatch` 默认模式和 `force_summaries=true` 模式都能运行。
10. Hugo 构建、关键输出检查、脚本测试和 `git diff` 均通过，仓库不出现密钥或生成产物。

## 9. 风险与取舍

- Pages CMS Editor 模式可能重排复杂 Markdown；Source 模式是规避方式，不保证 Editor 模式编辑 shortcode-heavy 正文后字节级不变。
- 直接写入 `main` 没有 PR 审核层，这是个人博客减少操作步骤的明确取舍。
- AI 摘要服务是发布链路依赖；阻断策略保持内容与摘要一致，但服务故障期间不会发布新的内容修改。
- 工作流回写 front matter 会产生机器人 commit，这是保持摘要和 changelog 默认字段可追踪、可重试的必要成本。
