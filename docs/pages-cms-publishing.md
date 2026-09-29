# Pages CMS 写作与自动发布

本文说明本项目接入 Pages CMS 和 AI 摘要后的完整使用方式，包括：首次配置、变量存放位置、文章写作流程、更新日志流程、摘要生成、Cloudflare Pages 部署和失败重试。

## 一、整体发布链路

本项目采用 Pages CMS 直接提交 `main` 的方式，不使用 `edit` 分支，也不需要在 CMS 中点击单独的部署按钮。

正常流程如下：

```text
Pages CMS 保存内容
        ↓
提交到 GitHub main
        ↓
GitHub Actions 运行 deploy.yml
        ↓
补齐缺失的 AI 摘要
        ↓
补齐 changelog 的 Hugo build 元数据
        ↓
Hugo Extended 0.166.0 构建并检查产物
        ↓
提交自动生成的 front matter
        ↓
Wrangler 部署到 Cloudflare Pages 项目 blog
```

当前工作流只监听 `main` 分支。普通 CMS 保存、手动推送和 GitHub Actions 手动运行都走同一套发布流程。

## 二、需要配置的变量

变量分为三类：本地 `.env`、GitHub Actions Secrets、GitHub Actions Repository Variables。真实密钥不要写入文章、Hugo 配置、`.pages.yml`、README 或任何提交文件。

### 2.1 本地 `.env`

本地生成摘要时，在博客仓库根目录创建：

```text
.env
```

可以复制示例：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

本地 `.env` 可配置：

| 变量 | 是否必需 | 作用 | 默认值/说明 |
| --- | --- | --- | --- |
| `AI_SUMMARY_API` | 否 | OpenAI 兼容的 Chat Completions API 地址 | 默认 `https://api.siliconflow.cn/v1/chat/completions` |
| `AI_SUMMARY_API_KEY` | 生成摘要时必需 | AI 服务 API Key | 只放在本地 `.env` 或 GitHub Secret |
| `AI_SUMMARY_MODEL` | 否 | 摘要模型名称 | 默认 `Qwen/Qwen3-8B` |
| `AI_SUMMARY_MAX_INPUT` | 否 | 发送给模型的最大正文字符数 | 默认 `12000` |
| `AI_SUMMARY_PROMPT` | 否 | 摘要系统提示词 | 使用脚本内置中文提示词 |

`.env` 已被 `.gitignore` 忽略。不要把真实 API Key 填入 `.env.example`；示例文件只能保留占位值。

本地摘要命令：

```bash
node scripts/generate-ai-summary.mjs
```

只检查候选文章、不调用 API、不修改文件：

```bash
node scripts/generate-ai-summary.mjs --dry-run
```

### 2.2 GitHub Actions Secrets

位置：

```text
GitHub 仓库 → Settings → Secrets and variables → Actions → Secrets
```

仓库：

```text
kemiao-moretti/meowloge
```

需要配置：

| Secret | 是否必需 | 作用 |
| --- | --- | --- |
| `AI_SUMMARY_API_KEY` | 有待生成摘要时必需 | AI 摘要服务的 API Key |
| `CLOUDFLARE_API_TOKEN` | 部署必需 | Wrangler 部署 Cloudflare Pages 的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 部署必需 | Cloudflare Account ID |
| `AI_SUMMARY_API` | 否 | 覆盖默认 AI 摘要接口地址 |

`CLOUDFLARE_API_TOKEN` 至少需要当前 Cloudflare 账户下 Pages 编辑权限。不要把 Token 放在 Repository Variables，因为 Variables 不是敏感凭据存储位置。

### 2.3 GitHub Actions Repository Variables

位置：

```text
GitHub 仓库 → Settings → Secrets and variables → Actions → Variables
```

当前 `deploy.yml` 直接从 Repository Variables 读取：

| Variable | 是否必需 | 作用 | 默认值/说明 |
| --- | --- | --- | --- |
| `AI_SUMMARY_MODEL` | 否 | 摘要模型名称 | 未设置时使用 `Qwen/Qwen3-8B` |
| `AI_SUMMARY_MAX_INPUT` | 否 | 最大输入字符数 | 未设置时由脚本使用 `12000` |
| `AI_SUMMARY_PROMPT` | 否 | 自定义摘要提示词 | 未设置时使用脚本内置提示词 |

如需存放自定义提示词但不希望它出现在普通配置中，也可以按仓库安全策略改用 Secret；不过当前工作流的默认读取位置是 Repository Variables。

### 2.4 不需要手动配置的字段

以下字段由程序维护，不要在 Pages CMS 中手动填写或覆盖：

- `ai_summary`：由 `scripts/generate-ai-summary.mjs` 生成；
- `build`：changelog 由 `scripts/ensure-content-defaults.mjs` 维护；
- `lastmod`：在 Pages CMS 中隐藏，使用 `merge` 保留现有值。

`ai_summary: false` 是明确的摘要停用标记。即使手动运行 `force_summaries=true`，带有这个值的文章也不会生成或覆盖摘要。

## 三、首次配置清单

### 3.1 初始化博客仓库

克隆仓库时需要初始化 Hugo 主题 submodule：

```bash
git clone --recursive https://github.com/kemiao-moretti/blog.git
cd blog
```

如果仓库已经克隆但主题目录为空：

```bash
git submodule update --init --recursive
```

本地构建依赖 Hugo Extended `0.166.0`；线上工作流也固定使用这个版本。

### 3.2 连接 Pages CMS

1. 打开 <https://app.pagescms.org/> 并使用 GitHub 登录。
2. 连接仓库 `kemiao-moretti/meowloge`。
3. 查看并编辑 `main` 分支。
4. 确认 CMS 中只出现以下两个集合：
   - **文章 / Posts**：对应 `content/posts`；
   - **更新日志 / Changelog**：对应 `content/changelog`。
5. 不要把 `content/posts/_index.md` 或 `content/changelog/_index.md` 当作普通文章编辑。

`.pages.yml` 位于仓库根目录，是 Pages CMS 的配置入口。

### 3.3 配置 GitHub Actions

在 `kemiao-moretti/meowloge` 的 Actions 设置中配置：

- Secrets：`AI_SUMMARY_API_KEY`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；
- 可选 Secret：`AI_SUMMARY_API`；
- 可选 Repository Variables：`AI_SUMMARY_MODEL`、`AI_SUMMARY_MAX_INPUT`、`AI_SUMMARY_PROMPT`。

配置完成后，可在 Actions 页面手动运行一次 `Deploy to Cloudflare Pages`，确认 Secrets 有效。没有待生成摘要的文章时，摘要脚本不会请求 AI 接口。

## 四、具体写文章流程

### 4.1 新建文章

在 Pages CMS 的 **Posts / 文章** 集合中创建文章，填写：

- **标题 `title`**：文章标题；
- **Slug `slug`**：小写英文、数字和连字符，例如 `hugo-pages-cms-guide`；
- **发布日期 `date`**：按站点 `Asia/Shanghai` 时区填写日期和时间；
- **描述 `description`**：文章卡片、搜索引擎和社交分享使用的描述；
- **封面 `cover`**：可以填写 `/img/...` 本地路径，也可以填写外部 HTTPS 图片 URL；
- **分类 `categories`**、**标签 `tags`**、**系列 `series`**：按需要填写数组；
- **目录 `toc`**：文章需要目录时开启；
- **评论 `comment`**：文章允许评论时保持开启；
- **文章位置 `locate`**：需要在文章中显示位置说明时填写；
- **推荐 `recommend`**：只有确实要推荐到站点相关位置时才开启；
- **正文 `body`**：使用 Markdown 内容。

新文章文件名由 slug 生成：

```text
content/posts/<slug>.md
```

由于 Hugo 的文章链接使用：

```yaml
permalinks:
  posts: /p/:slug
```

已有文章的 slug、文件名和公开 URL 不要修改。`.pages.yml` 已关闭 CMS 的重命名操作，避免误改文章地址。

### 4.2 选择正文编辑模式

普通 Markdown 内容可以使用 Pages CMS 的 Editor mode，例如：

- 标题；
- 段落；
- 列表；
- 普通链接；
- 普通图片；
- 标准 Markdown 表格。

出现以下内容时，切换到 **Source mode**：

- Hugo shortcode，例如 `{{< note >}}`、`{{< fold >}}`、`{{< tabs >}}`；
- Mermaid 图表；
- Chart.js JSON；
- 复杂 HTML；
- shortcode 示例代码；
- 需要保持原始空格、缩进或成对标签的 Markdown。

Editor mode 可能会重新序列化复杂 Markdown。Source mode 才是 shortcode-heavy 文章的权威编辑方式。

### 4.3 上传和引用图片

正文图片和媒体文件通过 Pages CMS 的媒体功能上传。当前配置的目标是：

```text
仓库路径：static/img/posts/
公开引用：/img/posts/<文件名>
```

例如：

```markdown
![文章示例](/img/posts/example.webp)
```

上传后检查：

1. GitHub 中文件是否位于预期目录；
2. Markdown 中的大小写是否与实际文件名一致；
3. 图片扩展名和公开 URL 是否一致；
4. 不要把站点图片上传到 `content/posts`。

当前 Pages CMS 使用 `static/img` 作为媒体根目录，并通过正文配置的 `path: posts` 指向文章图片目录。首次使用时应实际上传一张临时图片确认最终 GitHub 路径，然后再正式发布文章。

### 4.4 保存和等待发布

完成字段和正文后：

1. 在 Source mode 中检查 shortcode、代码块和图片路径；
2. 保存 Pages CMS 条目；
3. 确认 Pages CMS 已将 commit 写入 `main`；
4. 打开 GitHub Actions 查看 `Deploy to Cloudflare Pages`；
5. 等待摘要、changelog 归一化、Hugo 构建、产物检查和 Cloudflare 部署完成。

正常情况下不需要再次点击发布按钮。文章内容会先经过摘要和构建验证，验证成功后才部署到 Cloudflare Pages。

## 五、AI 摘要规则

### 5.1 新文章

新文章没有 `ai_summary` 时，发布工作流会：

1. 清理 front matter、代码块、图片链接、HTML 标签和 Markdown 标记；
2. 截断到 `AI_SUMMARY_MAX_INPUT`；
3. 调用配置的 OpenAI 兼容接口；
4. 将结果写回文章 front matter 的 `ai_summary`；
5. 使用包含摘要的工作树继续 Hugo 构建。

摘要只在构建期生成，访客浏览器不会接触 AI API Key。

### 5.2 已有文章

普通发布模式默认跳过已有 `ai_summary`，不会因为每次编辑正文都重新消耗模型额度。

如果需要重新生成符合条件的已有摘要，在 GitHub Actions 页面手动运行工作流，并将：

```text
force_summaries = true
```

设置为 `true`。该模式会重新生成 eligible summaries，但仍保留 `ai_summary: false` 的明确停用标记。

### 5.3 `ai_summary: false`

如果某篇文章不需要 AI 摘要，可以在 Source mode 中明确写入：

```yaml
ai_summary: false
```

这表示该文章永久跳过自动摘要，直到你手动移除或修改这个字段。普通发布和 force 模式都不会覆盖它。

## 六、更新日志流程

在 Pages CMS 的 **Changelog / 更新日志** 集合中创建条目，填写：

- `title`：版本变更标题；
- `type`：只能使用 `feature`、`improvement` 或 `fix`；
- `version`：使用 `vX.Y.Z` 格式，例如 `v0.6.0`；
- `date`：变更日期和时间；
- `description`：时间线卡片摘要；
- `comment`：通常保持关闭；
- `body`：详细变更内容。

新日志文件名由版本号生成：

```text
content/changelog/vX.Y.Z.md
```

`build` 不需要在 CMS 中填写。发布工作流会确保每条 changelog 具备：

```yaml
build:
  render: never
  list: local
```

如果 Pages CMS 保存已有日志，`settings.content.merge: true` 会保留未在编辑器中展示的字段。

## 七、失败和重试

### AI 摘要失败

AI 摘要接口失败、密钥缺失、模型错误或返回空内容时，工作流会失败，并且不会继续 Hugo 构建或 Cloudflare 部署。

处理步骤：

1. 检查 `AI_SUMMARY_API_KEY` 是否存在且有效；
2. 检查 `AI_SUMMARY_API`、`AI_SUMMARY_MODEL` 和提示词配置；
3. 检查 AI 服务商是否限流或暂时不可用；
4. 等服务恢复后，在同一个 Actions run 页面点击重新运行。

### Hugo 构建失败

常见原因包括：

- shortcode 没有闭合；
- Source mode 内容产生了错误的 Markdown 或 HTML；
- 图片或 front matter 格式异常；
- 主题 submodule 未初始化；
- Hugo 配置或输出格式错误。

本地先运行：

```bash
git submodule update --init --recursive
hugo --gc --minify
```

### Cloudflare 部署失败

Cloudflare 部署失败不会自动回滚 Git 内容。先检查：

- `CLOUDFLARE_API_TOKEN` 权限；
- `CLOUDFLARE_ACCOUNT_ID` 是否正确；
- Cloudflare Pages 项目名是否为 `blog`；
- Actions 日志中的 Wrangler 错误。

确认配置无误后，可从 Actions 页面重新运行该 workflow。

## 八、本地提交前检查

在提交 CMS 之外的本地修改前，建议从仓库根目录执行：

```bash
git submodule update --init --recursive
node --test scripts/ensure-content-defaults.test.mjs scripts/generate-ai-summary.test.mjs
node scripts/generate-ai-summary.mjs --dry-run
node scripts/ensure-content-defaults.mjs
hugo --gc --minify
```

最后确认：

```bash
git diff --check
git status --short
```

`.env`、`public/`、`.hugo_build.lock` 和其他构建产物不要提交。