---
title: 用 Pages CMS 写博客：从连接仓库到 AI 摘要
slug: pages-cms-writing-guide
date: 2026-09-29T15:56:00+08:00
lastmod: 2026-09-29T15:56:00+08:00
description: 记录这个 Hugo 博客如何接入 Pages CMS，以及如何通过 CMS 写文章、上传图片，并让 GitHub Actions 自动生成 AI 摘要。
cover: https://openlist.081531.xyz/d/lsky-git/lsky/2026/09/30/6abcb99f8d703.webp
categories: [博客魔改]
cover: https://openlist.081531.xyz/d/lsky-git/lsky/2026/09/30/6abcb99f8d703.webp
tags: [Pages CMS, Hugo, GitHub Actions, AI]
series: [博客魔改]
toc: true
comment: true
locate: 江苏苏州
recommend: true
ai_summary: >-
  本文记录了这个 Hugo 博客接入 Pages CMS 的完整过程，介绍如何使用 GitHub 登录并连接仓库，如何在 Posts 集合中创建文章、填写 front matter、切换 Source mode 编辑 Hugo shortcode，以及如何上传和引用图片。文章还说明了文章保存后提交到 main 分支的自动发布链路：GitHub Actions 会为缺少 ai_summary 的文章调用 OpenAI 兼容接口生成摘要，再执行 Hugo 构建并部署到 Cloudflare Pages，同时列出 ai_summary=false、摘要失败和复杂 Markdown 编辑时需要注意的事项。
---

最近把这个博客接到了 Pages CMS。

之前写文章，通常是打开本地编辑器，找到 `content/posts`，新建一个 Markdown 文件，再手动检查 front matter、图片路径和构建结果。这个流程没有什么问题，只是每次想在别的电脑上改两句话，都要先找到仓库，再把环境准备好。

Pages CMS 解决的不是“怎么写 Markdown”这个问题，而是把这件事搬到了一个可以直接登录使用的网页里。文章仍然保存到 GitHub，Hugo 仍然负责构建，Cloudflare Pages 仍然负责发布，只是中间多了一个更适合写作的入口。

这篇文章把整个流程记下来：怎么连接仓库，怎么写第一篇文章，什么时候要切到 Source mode，以及文章保存以后，AI 摘要是怎么自动生成的。

## 先看一遍发布链路

这个项目没有把 CMS 当成一个独立的数据库。Pages CMS 改的还是仓库里的 Markdown 文件，保存后直接提交到 `main` 分支。

{{< mermaid >}}
flowchart LR
    A[Pages CMS 编辑文章] --> B[提交到 GitHub main]
    B --> C[GitHub Actions]
    C --> D[补齐 AI 摘要]
    D --> E[Hugo 构建]
    E --> F[Cloudflare Pages 发布]
{{< /mermaid >}}

所以，一次正常发布大致会经过这些步骤：

1. 在 Pages CMS 中编辑或新建文章。
2. CMS 把修改提交到 `main`。
3. GitHub Actions 运行 `Deploy to Cloudflare Pages`。
4. 对没有摘要的文章生成 `ai_summary`。
5. 使用 Hugo Extended 构建站点并检查产物。
6. 将站点部署到 Cloudflare Pages。

Pages CMS 不需要再点击一个单独的“部署”按钮。文章提交成功后，后面的事情交给 Actions 就可以了。

{{< note type="info" >}}
这篇文章以仓库 `kemiao-moretti/meowloge` 为例。Pages CMS 连接的是这个 GitHub 仓库，Hugo 文章目录是 `content/posts`，不是仓库外层同名的目录。
{{< /note >}}

## 连接 Pages CMS

### 第一步：登录

打开 [Pages CMS](https://app.pagescms.org/)，使用 GitHub 登录。第一次进入时，需要授权 Pages CMS 访问 GitHub 仓库，按页面提示完成即可。

登录之后，选择博客对应的仓库：

```text
kemiao-moretti/meowloge
```

进入仓库后，确认当前查看的是 `main` 分支。这个项目采用直接提交 `main` 的方式，没有另外维护用于写作的 `edit` 分支。

### 第二步：确认内容集合

仓库根目录的 `.pages.yml` 是 Pages CMS 的配置文件。当前项目只开放两个内容集合：

- **Posts / 文章**：对应 `content/posts`；
- **Changelog / 更新日志**：对应 `content/changelog`。

第一次连接后，先确认这两个集合能正常显示。如果看到了 `_index.md`，不要把它当成普通文章编辑。它是 Hugo section 的索引文件，负责文章列表页的标题和描述。

{{< fold title="为什么不直接在 CMS 里开放整个仓库？" >}}
因为文章只是这个项目的一部分。主题、Hugo 配置、工作流和脚本都属于站点实现，误改它们可能会让整站构建失败。CMS 只开放 Posts 和 Changelog，既能完成日常写作，也能把配置文件留在代码管理流程里。
{{< /fold >}}

### 第三步：配置自动发布所需的变量

如果只是编辑已经有 `ai_summary` 的文章，CMS 本身不需要 AI Key。但新文章发布时，Actions 可能需要调用摘要接口，所以 GitHub 仓库里要提前配置好变量。

进入 GitHub 仓库的：

```text
Settings → Secrets and variables → Actions
```

在 **Secrets** 中配置：

| Secret | 用途 |
| --- | --- |
| `AI_SUMMARY_API_KEY` | AI 摘要服务的 API Key |
| `CLOUDFLARE_API_TOKEN` | 部署 Cloudflare Pages |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |

`AI_SUMMARY_API` 也可以作为 Secret 配置，用来覆盖默认的 OpenAI 兼容接口地址。

在 **Variables** 中可以配置：

| Variable | 用途 |
| --- | --- |
| `AI_SUMMARY_MODEL` | 摘要使用的模型 |
| `AI_SUMMARY_MAX_INPUT` | 发送给模型的最大正文长度 |
| `AI_SUMMARY_PROMPT` | 自定义摘要提示词 |

密钥只放在 GitHub Secrets 或本地 `.env`，不要写进 `.pages.yml`、`hugo.yaml`、文章 front matter 或正文代码块里。

## 在 Pages CMS 里写第一篇文章

进入 **Posts / 文章** 集合，点击新建文章。这里的字段基本对应文章 front matter。

### 这些字段怎么填

- `title`：文章标题。
- `slug`：文章地址使用的小写英文标识，只允许小写字母、数字和连字符，例如 `pages-cms-writing-guide`。
- `date`：发布日期和时间，站点时区是 `Asia/Shanghai`。
- `description`：文章列表、搜索和分享时使用的描述。
- `cover`：可以填写 `/img/...` 的本地图片，也可以填写外部 HTTPS 图片地址。
- `categories`、`tags`、`series`：按需要填写数组。
- `toc`：文章较长、需要目录时打开。
- `comment`：是否开启评论。
- `locate`：文章位置说明，不需要时可以留空。
- `recommend`：只有确实要推荐文章时才打开。

新文章的文件名由 `slug` 生成：

```text
content/posts/<slug>.md
```

这个博客的文章链接由 Hugo 配置为 `/p/:slug`，所以 slug 不是一个随手填写的内部字段。文章发布以后，尽量不要再改它，否则公开 URL 也会跟着变化。

{{< note type="warning" style="simple" >}}
已有文章不要修改 slug。Pages CMS 已经关闭了文章重命名操作，但填写新文章时仍然建议使用简短、稳定、全小写的英文 slug。
{{< /note >}}

### 普通内容用 Editor mode

标题、段落、列表、普通链接和普通图片，都可以直接使用 Pages CMS 的 Editor mode。这个模式适合日常写作，写完之后看起来和普通 Markdown 编辑器差不多。

例如下面这段内容不需要特殊处理：

```markdown
## 这是一节标题

这里是一段普通正文，里面可以放一个[站外链接](https://gohugo.io/)。

- 第一项
- 第二项
```

写作时可以先不用考虑 AI 摘要。正文保存后，后面的工作流会自动处理它。

### 遇到 shortcode 就切换 Source mode

这个主题提供了不少 Hugo shortcode，比如提示框、折叠面板、标签页、Mermaid 和卡片。Pages CMS 不负责解析它们，只是把文章里的 Markdown 保存回 GitHub。

因此，正文里出现下面这些内容时，建议切换到 **Source mode**：

- `{{</* note */>}}`、`{{</* fold */>}}` 这类 Hugo shortcode；
- Mermaid 流程图或 Chart.js 数据；
- 复杂 HTML；
- shortcode 的示例代码；
- 需要保留精确缩进、空格和成对标签的内容。

比如这段提示框就应该在 Source mode 中编辑：

```go-html-template
{{</* note type="success" */>}}
文章已经保存，接下来等待 GitHub Actions 构建。
{{</* /note */>}}
```

这里代码块里的 `/*` 和 `*/` 是为了让示例原样显示，实际文章中使用 shortcode 时不需要加这层转义。

如果把包含大量 shortcode 的文章交给 Editor mode，编辑器可能会重新排列 Markdown，或者把 shortcode 当成普通文本处理。文章看起来可能没问题，但构建时才发现标签没有闭合。遇到这类文章，Source mode 更稳妥。

### 图片怎么上传

Pages CMS 的媒体配置指向 `static/img`，文章正文图片建议放在：

```text
static/img/posts/
```

上传后，在文章中使用公开路径：

```markdown
![文章示例](/img/posts/example.webp)
```

提交前检查三件事：

1. GitHub 中的文件确实位于 `static/img/posts/`；
2. Markdown 里的文件名大小写和实际文件一致；
3. 引用使用 `/img/posts/...`，而不是 `static/img/posts/...`。

图片不会放进 `content/posts`。文章目录存 Markdown，静态资源目录存图片，这是 Hugo 处理静态文件的方式。

## 保存之后会发生什么

在 CMS 中保存文章以后，先确认页面提示已经提交成功，再打开 GitHub Actions 查看 `Deploy to Cloudflare Pages`。

Actions 会先运行摘要脚本。它会读取 `content/posts` 下的文章，清理 front matter、代码块、图片地址、HTML 标签和 Markdown 符号，然后把正文发送给配置好的 OpenAI 兼容接口。

生成结果会写回 front matter：

```yaml
ai_summary: >-
  这里是根据文章内容生成的一段中文摘要。
```

随后 Hugo 使用带有摘要的工作树继续构建，Cloudflare Pages 部署的也是这次构建结果。

{{< card title="AI 摘要只在构建期生成" url="/p/ai-summary" tag="已有说明" star="5" >}}
浏览器只负责展示 front matter 中已经存在的摘要，不会在访客打开文章时请求 AI 接口。API Key 不会进入前端。
{{< /card >}}

### 普通发布不会重复生成

摘要脚本默认只处理没有 `ai_summary` 的文章。这样修改一篇已有文章时，不会因为普通发布再次消耗模型额度，也不会让摘要在每次构建时发生变化。

如果确实需要重新生成已有文章的摘要，可以在 GitHub Actions 页面手动运行工作流，并把：

```text
force_summaries = true
```

设为 `true`。

有一种情况会始终跳过：文章明确写了：

```yaml
ai_summary: false
```

这表示作者不希望这篇文章生成摘要。普通发布和强制重新生成都不会覆盖这个停用标记。

### 本地也可以先试跑

如果想在提交前检查哪些文章会被处理，可以在博客仓库根目录执行：

```bash
node scripts/generate-ai-summary.mjs --dry-run
```

这条命令只列出候选文章，不调用 AI 接口，也不会修改文件。确认配置和文章都没有问题后，再运行完整命令：

```bash
node scripts/generate-ai-summary.mjs
hugo --gc --minify
```

本地摘要配置放在 `.env` 中：

```dotenv
AI_SUMMARY_API=https://api.siliconflow.cn/v1/chat/completions
AI_SUMMARY_API_KEY=你的 API Key
AI_SUMMARY_MODEL=Qwen/Qwen3-8B
```

`.env` 已经被 Git 忽略。不要把真实 Key 填进 `.env.example`，更不要把它放进文章里作为示例提交。

## 几个容易踩到的地方

### Source mode 和 Editor mode 混着用

普通段落用 Editor mode 没问题，但一篇文章只要包含多个 shortcode，最好从头到尾在 Source mode 中检查一次。尤其要确认：

- 每个块级 shortcode 都有对应的结束标签；
- Mermaid、Chart.js 的内容仍然是合法格式；
- 代码块中的 shortcode 示例没有被提前解析；
- HTML 标签的引号和缩进没有被编辑器改坏。

### AI 摘要失败后继续等部署

摘要接口返回错误、Key 缺失、模型名称错误或接口超时，Actions 会失败，后面的 Hugo 构建和 Cloudflare 部署不会继续执行。

这时先看 Actions 日志中的失败文件和错误信息，检查 `AI_SUMMARY_API_KEY`、接口地址、模型名称以及服务商状态。配置修好后，在原来的 workflow 页面重新运行即可。

### 把摘要当成 SEO 描述

`ai_summary` 是文章正文前的展示内容，`description` 才是文章的描述字段。两者用途不同，不要为了显示摘要而删掉 `description`，也不要把 API 返回结果直接塞进站点全局配置。

{{< note type="success" style="modern" >}}
写作时只需要关注标题、正文、图片和文章元数据。保存以后，让 Pages CMS 提交 GitHub，再让 Actions 负责摘要、构建和部署，整个流程就串起来了。
{{< /note >}}

## 最后检查一下

现在这套流程可以概括成一句话：Pages CMS 负责写，GitHub 负责存，Actions 负责补齐摘要和构建，Cloudflare Pages 负责发布。

第一次使用时，我建议按下面的顺序走一遍：

1. 连接 `kemiao-moretti/meowloge`，确认分支是 `main`。
2. 检查 Posts 集合是否对应 `content/posts`。
3. 创建一篇测试文章，使用英文 slug。
4. 普通正文用 Editor mode，包含 shortcode 时切到 Source mode。
5. 上传一张图片，确认它最终位于 `static/img/posts/`。
6. 保存后查看 GitHub commit 和 Actions 运行结果。
7. 打开文章，确认摘要显示在正文前，图片、代码块和 shortcode 都正常。

这样以后想写文章时，不必先打开本地开发环境。打开 Pages CMS，写完，保存，等它跑完发布流程就可以了。偶尔需要改主题或调脚本时，再回到仓库里处理，两套入口各自负责擅长的事情，反而更清楚。
