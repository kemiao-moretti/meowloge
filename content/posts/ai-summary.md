---
title: 给博客文章加上 AI 摘要
slug: ai-summary
date: 2026-09-22T18:30:00+08:00
lastmod: 2026-09-22T18:30:00+08:00
description: 记录这套 Hugo 博客的 AI 摘要组件怎么接、怎么生成摘要，以及为什么不把 API Key 放进前端。
categories: [配置指南]
cover: https://openlist.081531.xyz/d/yidong/imgbed/lsky/2026/09/22/6ab2876c65ce0.webp
series: [站点维护]
toc: true
comment: true
locate: 站点配置
ai_summary: >-
  本文介绍了如何在 Hugo 博客中添加 AI 摘要卡，以提升用户体验。通过在 front matter 中设置 aisummary 字段，摘要卡会在文章正文前显示，且样式与主题一致，适配明暗模式。摘要生成由本地脚本完成，使用 OpenAI 兼容接口，避免暴露 API 密钥。脚本会清理正文内容并截断至指定长度，支持自定义提示词和接口配置。生成失败时脚本会记录错误并继续处理，确保构建过程可控。最终摘要仅用于展示，不涉及 SEO 或前端依赖 AI 接口，便于后续维护和优化。
---

最近给这个博客加了一张 AI 摘要卡。它会出现在文章正文前面，读者打开文章后，可以先扫一眼文章讲了什么，再决定要不要继续往下看。

这篇文章把接入过程记下来。以后重装主题，或者想给别的 Hugo 站点照着改时，不用再翻聊天记录。

## 先说最终效果

文章的 front matter 里有 `ai_summary` 时，页面会在正文前显示摘要卡：

```yaml
ai_summary: 这篇文章介绍了如何给 Hugo 站点接入 AI 摘要，并说明了构建脚本、前端组件和密钥管理方式。
```

没有这个字段的文章不会显示空卡片。摘要卡的颜色、边框和阴影都跟着 Solitude 的主题变量走，所以切换明暗模式时不需要另外维护两套样式。

摘要文字默认会有一个很短的打字效果。浏览器开启了“减少动态效果”后，组件会直接显示完整内容。

## 组件放在哪里

文章模板是：

```text
themes/solitude/layouts/posts/page.html
```

在文章元信息和正文之间加一行 partial：

```html
{{ partial "ai-summary.html" . }}
```

摘要模板在：

```text
themes/solitude/layouts/_partials/ai-summary.html
```

模板只做一件事：读取 `.Params.ai_summary`。字段为空就什么也不输出，这样旧文章不需要批量修改，也不会出现一张写着“暂无摘要”的占位卡。

## 主题配置

站点的 `hugo.yaml` 里有一段摘要配置：

```yaml
params:
  solitude:
    ai_summary:
      enable: true
      title: AI 摘要
      model: AI generated
      loading: 正在整理文章重点……
```

`title` 是卡片标题，`model` 会显示在右侧的小标签里，`loading` 是脚本还没有开始打字时的备用文字。

这些配置只是展示层设置。真正请求 AI 的接口和密钥不放在这里。

## 配置根目录 `.env`

接口信息放在博客根目录的 `.env` 文件里，也就是：

```text
blog/.env
```

可以先复制示例文件：

```bash
cp .env.example .env
```

Windows PowerShell 可以这样复制：

```powershell
Copy-Item .env.example .env
```

然后打开 `.env`，填入自己的接口信息：

```dotenv
AI_SUMMARY_API=https://api.siliconflow.cn/v1/chat/completions
AI_SUMMARY_API_KEY=你的 SiliconFlow API Key
AI_SUMMARY_MODEL=Qwen/Qwen3-8B
```

`.env` 已经被加入 `.gitignore`，不会提交到 Git。不要把真实密钥写进 `.env.example`，也不要把 `.env` 发给别人。

脚本会自动读取博客根目录的 `.env`。如果当前终端已经设置了同名环境变量，环境变量优先，不会被 `.env` 覆盖。

SiliconFlow 的 Qwen3 默认可能开启思考模式。摘要脚本已经固定发送 `enable_thinking: false`，并设置 `stream: false`，这样会直接返回普通 JSON 摘要，不会等待或解析流式响应。

## 用脚本生成摘要

生成脚本位于：

```text
scripts/generate-ai-summary.mjs
```

它使用 OpenAI 兼容的 Chat Completions 接口，整体行为参考了 `hexo-ai-summary`：只在构建准备阶段处理 Markdown，不在访客浏览器里请求 AI；默认跳过已有摘要的文章，也支持并发、输入清洗、摘要字段自定义、覆盖控制和分级日志。脚本会遍历 `content/posts/` 下的 Markdown 文章，然后把生成结果写回 front matter。

先做一次 dry-run 比较稳妥：

```bash
node scripts/generate-ai-summary.mjs --dry-run
```

这一步只会列出准备处理的文章，不会修改文件。

确认 `.env` 已经填好后，直接生成：

```bash
node scripts/generate-ai-summary.mjs
```

如果不想创建 `.env`，也可以临时用 PowerShell 设置配置：

```powershell
$env:AI_SUMMARY_API = "https://api.siliconflow.cn/v1/chat/completions"
$env:AI_SUMMARY_API_KEY = "你的 SiliconFlow API Key"
$env:AI_SUMMARY_MODEL = "Qwen/Qwen3-8B"
node scripts/generate-ai-summary.mjs
```

如果只想临时覆盖 `.env` 里的配置，仍然可以使用环境变量：

```bash
AI_SUMMARY_API="https://另一个接口/v1/chat/completions" \\
AI_SUMMARY_API_KEY="临时密钥" \\
AI_SUMMARY_MODEL="临时模型" \\
node scripts/generate-ai-summary.mjs
```

PowerShell 写法：

```powershell
$env:AI_SUMMARY_API = "https://另一个接口/v1/chat/completions"
$env:AI_SUMMARY_API_KEY = "临时密钥"
$env:AI_SUMMARY_MODEL = "临时模型"
node scripts/generate-ai-summary.mjs
```

脚本默认只生成缺少摘要的文章。想重新生成已有摘要时，加上 `--force`：

```bash
node scripts/generate-ai-summary.mjs --force
```

生成完成后，再运行 Hugo：

```bash
hugo --gc
```

目前这两个步骤是分开的。也就是说，`hugo` 不会偷偷调用 AI 接口；需要生成摘要时，先手动运行脚本，再构建站点。这样构建过程更可控，也不容易因为接口临时超时而卡住发布。

脚本还支持这些和插件思路对应的配置：

```dotenv
AI_SUMMARY_SUMMARY_FIELD=ai_summary
AI_SUMMARY_COVER_ALL=false
AI_SUMMARY_MAX_INPUT_TOKEN=5000
AI_SUMMARY_MAX_OUTPUT_TOKEN=2000
AI_SUMMARY_CONCURRENCY=2
AI_SUMMARY_SLEEP_TIME=0
AI_SUMMARY_LOGGER=1
AI_SUMMARY_THINKING=false
```

`AI_SUMMARY_COVER_ALL=true` 或运行时加 `--force` 会覆盖已有摘要；`AI_SUMMARY_CONCURRENCY` 控制同时请求的文章数，建议不要设得太大；`AI_SUMMARY_SLEEP_TIME` 可以在每篇文章处理后增加间隔。推理模型可以打开 `AI_SUMMARY_THINKING=true`，脚本会发送 `reasoning_effort=medium`，但摘要场景默认关闭更稳妥。

## 脚本会怎么处理正文

发送给模型前，脚本会先做一些清理：

- 去掉 front matter
- 去掉代码块
- 去掉图片和链接地址
- 去掉 HTML 标签和 Markdown 符号
- 把过长的正文截断到输入长度上限

默认输入上限是 12000 个字符，可以在 `.env` 里调整，也可以用环境变量临时覆盖：

```bash
AI_SUMMARY_MAX_INPUT=16000 node scripts/generate-ai-summary.mjs --dry-run
```

提示词也可以通过 `.env` 里的 `AI_SUMMARY_PROMPT` 自定义。默认提示词要求模型只返回一段中文摘要，不要输出标题、列表或 Markdown。

## 为什么不在浏览器里直接生成

最开始也想过在文章页放一个“生成摘要”按钮，但那样需要把 API Key 交给浏览器。只要打开开发者工具，Key 就能被看到，后面还可能被别人拿去刷接口额度。

所以现在的做法是：

1. 在本地或 CI 构建环境里调用模型。
2. 把摘要写进文章 front matter。
3. 网站前端只负责展示已经生成好的文字。

访客不会接触到 API Key，文章页面也不依赖 AI 接口才能打开。对博客来说，这种方式简单一点，但更踏实。

## 生成失败怎么办

脚本遇到某篇文章请求失败时，会在终端打印文件名和错误原因，并继续处理后面的文章。失败的文章不会被写入半截摘要。

如果最后有失败项，脚本会返回非零退出码。发布前看一眼终端输出就能知道有没有文章漏掉，不需要专门去页面里排查。

常见问题通常是：

- `AI_SUMMARY_API_KEY` 没有设置
- 接口地址少了 `/v1/chat/completions`
- 模型名称写错
- 接口暂时超时或返回限流

## 最后检查一下

改完后，我一般会按这个顺序检查：

```bash
node scripts/generate-ai-summary.mjs --dry-run
hugo --gc
hugo server --port 1313
```

然后打开一篇有 `ai_summary` 的文章，看四件事：摘要是不是在正文前、暗色模式下文字是否清楚、手机宽度有没有横向滚动，以及没有摘要的旧文章是否保持原样。

这套组件现在只负责摘要展示，没有把摘要当成 SEO 的 `description`，也没有把请求逻辑塞进访客浏览器。以后如果觉得摘要质量不够，优先改提示词；如果觉得卡片太抢眼，再调整组件 CSS，不需要动文章正文。
