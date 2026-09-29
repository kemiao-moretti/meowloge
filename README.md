# 喵洛阁 Meowloge

基于 Hugo 搭建的个人博客，主题是自改的 Solitude（纸张手账风格），部署在 Cloudflare Pages。

- 站点地址：https://blog.518339.xyz/
- 仓库：https://github.com/kemiao-moretti/blog
- 友链申请仓库（Issue 表单所在）：https://github.com/kemiao-moretti/meowloge

## 本地运行

需要 Hugo extended ≥ 0.164.0（线上用 0.166.0）。

```bash
git clone --recursive https://github.com/kemiao-moretti/blog.git
cd blog
hugo server --port 1313
```

主题 `themes/solitude` 是 submodule，克隆时别忘了 `--recursive`，已经克隆过的用 `git submodule update --init --recursive` 补。

## 目录速查

| 路径                      | 说明                                 |
| ------------------------- | ------------------------------------ |
| `hugo.yaml`               | 站点配置（菜单、页面参数、模块开关） |
| `content/`                | 文章与页面                           |
| `data/links.yaml`         | 友链数据                             |
| `data/about.yaml`         | 关于页数据，含赞赏名单               |
| `static/img/sponsor/`     | 打赏二维码图片                       |
| `.github/ISSUE_TEMPLATE/` | 友链、赞助的 Issue 表单              |
| `.github/workflows/`      | 友链审核、巡检、赞助入库、部署       |
| `.github/scripts/`        | 上面几个流程用到的 Python 脚本       |
| `themes/solitude/`        | 主题源码（submodule）                |

---

## 添加友链

友链数据全部在 `data/links.yaml`。页面上有两处会读它：`/links/` 友链页，以及页头「友链」菜单下的几个入口。

### 文件结构

```yaml
links:
  - class_name: 网上邻居 # 分组名
    class_desc: 我的网上好友们~ # 分组描述
    type: item # 卡片样式，见下表
    link_list:
      - name: 伍拾柒
        link: https://www.efu.me/
        linkpage: https://www.efu.me/link/
        avatar: https://github.com/everfu.png
        descr: Solitude 开发与维护者
```

### 条目字段

| 字段         | 必填      | 说明                                      |
| ------------ | --------- | ----------------------------------------- |
| `name`       | 是        | 站点名称                                  |
| `link`       | 是        | 站点地址，要带 `https://`                 |
| `avatar`     | 是        | 头像图片地址，留空时脚本会自动抓 favicon  |
| `descr`      | 是        | 一句话描述                                |
| `linkpage`   | 否        | 对方站点的友链页地址                      |
| `topimg`     | 看 `type` | 卡片封面图，`type: card` 时必填，其余可省 |
| `issue_id`   | 否        | 来源 Issue 编号，自动化靠它做幂等去重     |
| `skip_check` | 否        | 设为 `true` 后每日巡检会跳过这条          |

### 分组 type 的取值

| type    | 效果                                   |
| ------- | -------------------------------------- |
| `item`  | 紧凑列表，不显示封面图，默认值         |
| `card`  | 封面大卡片，会渲染 `topimg`            |
| `discn` | 断联列表，不显示封面图                 |
| `lost`  | 友链墓碑分组，不参与友链页顶部横幅轮播 |

### 方式一：走 GitHub Issue（推荐）

1. 打开 https://github.com/kemiao-moretti/meowloge/issues/new?template=friend-link.yml
2. 填站点名、链接、头像、描述，封面图选填
3. `Friend Links` 工作流自动跑校验：URL 格式、是否重复、头像与封面图能否访问
4. 通过就把条目写进 `data/links.yaml` 的「网上邻居」组并提交，推送后 Cloudflare Pages 自动部署
5. 不通过会在 Issue 里列出具体原因，改完在 Issue 下评论 `/retry` 重新触发

### 方式二：手动改文件

往对应分组的 `link_list` 里追加一条就行，`issue_id` 可以不写。

注意 YAML 缩进：分组项顶格、`link_list` 下的条目缩进 2 空格、条目字段再缩进 2 空格。缩进错了 Hugo 构建会直接报错。

### 失联巡检与墓碑

`Friend Links Check` 每天北京时间 02:00 跑一次（也可以在 Actions 页面手动触发）：

- 连续 2 天访问不通的友链，会被搬进「友链墓碑」分组暂存，同时记录 `lost_from` / `lost_since` / `lost_reason`
- 站点恢复可达后自动搬回原分组
- 不想被巡检的条目，加 `skip_check: true`

### 调整分组

分组名、分组描述、分组顺序都是直接改 `data/links.yaml` 里的 `class_name` / `class_desc` 和数组顺序。

新友链默认落在哪个分组、用什么卡片样式，由 `.github/scripts/friend_links.py` 顶部的两个常量决定：

```python
DEFAULT_GROUP = "网上邻居"       # 新友链写入的分组名
DEFAULT_GROUP_TYPE = "item"     # 该分组的卡片样式
```

---

## 添加赞助名单

数据在 `data/about.yaml` 的 `reward` 段，展示在关于页的「赞赏名单」卡片里。

### 名单字段

```yaml
reward:
  enabled: true
  tip: 致谢
  title: 赞赏名单
  description: 感谢每一份支持，让我更有创作的动力。
  empty_text: 暂无赞赏记录，充电入口后续开放
  action_text: 为TA充电
  mobile_action_text: 为 TA 充电
  sponsor_notice:
    prefix: 想要加入赞助名单，请
    label: 通过 GitHub Issue 提交申请
    url: https://github.com/kemiao-moretti/meowloge/issues/new?template=sponsor.yml
    email: sponsor@518339.xyz
    suffix: ，并附上支付截图和希望展示在名单中的名称。
  dialog:
    title: 打赏支持
    tips: 感谢您的支持，您的鼓励是我创作的最大动力！
    wechat:
      label: 微信
      image: /img/sponsor/weixin.png
    alipay:
      label: 支付宝
      image: /img/sponsor/zhifubao.png
  donations:
    - { name: 测试申请, amount: "12", date: "2026-09-19", issue_id: 3 }
```

`donations` 每条记录三个字段展示，一个字段做去重：

| 字段       | 必填 | 说明                                                                     |
| ---------- | ---- | ------------------------------------------------------------------------ |
| `name`     | 是   | 名单里展示的昵称                                                         |
| `amount`   | 是   | 金额，建议用字符串写法（`"12"`），避免 YAML 把 `20.0` 之类的值转得不好看 |
| `date`     | 是   | `YYYY-MM-DD` 格式                                                        |
| `issue_id` | 否   | 来源 Issue 编号，重复关闭同一个 Issue 不会写第二次                       |

### 方式一：走 GitHub Issue（推荐）

1. 赞助者提交 https://github.com/kemiao-moretti/meowloge/issues/new?template=sponsor.yml
2. 机器人回复「已收到申请，待审核」
3. 站长审核。通过的打上「赞助申请」标签再关闭 Issue；不通过的打「赞助失败」标签再关闭
4. 关闭动作触发 `Sponsor Links` 工作流，把 `name` / `amount` / `date` 追加进 `donations`，推送后自动部署
5. 支付截图只用于人工核对，不会写进仓库

一个容易踩的地方：标签要在关闭之前打。直接关掉但两个标签都没有，工作流判定不出该做什么，既不写入记录也不回复评论，看着就像「点了没反应」。所以审核动作要按「先打标签、再关闭」的顺序来。

### 方式二：手动追加

在 `donations` 数组末尾加一行即可：

```yaml
donations:
  - { name: 测试申请, amount: "12", date: "2026-09-19", issue_id: 3 }
  - { name: 张三, amount: "20", date: "2026-09-23" }
```

### 换打赏二维码

把图片放进 `static/img/sponsor/`，再改 `reward.dialog.wechat.image` / `reward.dialog.alipay.image` 两个路径。

### 关于文章底部的打赏模块

文章正文和版权卡片后面会渲染一个「赞赏」按钮，悬停在按钮上（触屏则点一下）弹出收款码。配置在 `hugo.yaml` 的 `params.solitude.post.award`：

```yaml
award:
  enable: true
  button: 赞赏
  title: 喜欢这篇文章，就请我喝杯奶茶吧
  link: https://github.com/kemiao-moretti/meowloge/issues/new?template=sponsor.yml
  link_text: 申请加入赞赏名单
  link_desc: 审核通过后出现在关于页的公开名单里
  list:
    - name: 支付宝
      qrcode: /img/sponsor/zhifubao.png
    - name: 微信
      qrcode: /img/sponsor/weixin.png
```

| 字段 | 说明 |
| --- | --- |
| `enable` | 总开关，关闭后整个模块不渲染 |
| `list[]` | 收款码列表，`name` 是二维码下方的文字，`qrcode` 是图片地址；至少一条才会渲染 |
| `button` | 按钮文字，留空回落到主题 i18n 的 `postRewardButton` |
| `title` | 弹层标题，留空回落到 `postRewardTitle` |
| `link` | 弹层底部按钮地址，留空则不渲染这个按钮 |
| `link_text` | 底部按钮主文案，留空回落到 `postRewardLinkText` |
| `link_desc` | 底部按钮副文案，留空则不显示 |

收款码图片按实际目录 `static/img/sponsor/` 填路径。

实现分散在四处，改之前先看一下：

- 模板 `layouts/_partials/post-reward.html`，由 `layouts/posts/page.html` 在版权卡片之后引入
- 弹层几何样式在主题上游的 `assets/css/solitude/pages/post.css`（`.post-reward` 区块，本来就是给这个模块准备的，只是上游一直没写模板）
- 展开/收起与窄屏收敛在 `themes/solitude/assets/css/solitude/integrations/paper-reward.css`
- 触屏点击开关在 `assets/ts/post-reward.ts`，已注册进 `entry.ts`；事件挂在 `document` 上，PJAX 换页不用重新绑定

一个坑：`.reward-main` 带着 `donate_effcet` 动画，而那段动画会改 `transform`，所以窄屏居中只能用 `translate` 属性，写 `transform: translateX(-50%)` 会被动画盖掉。

---

## 部署

推送到 `main` 分支会触发 `Deploy to Cloudflare Pages`：Hugo 0.166.0 extended 构建 → `wrangler pages deploy`。两个 secret 需要在仓库的 Settings → Secrets and variables → Actions 里配好：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

友链和赞助两个工作流改的是数据文件，它们自己 commit 并 push，push 又会触发部署，所以 Issue 审核通过之后不用再手动操作。

## Pages CMS 发布文章

### 首次连接与编辑范围

在 Pages CMS 中打开仓库 `kemiao-moretti/meowloge`，连接时选择并确认查看 `main` 分支。CMS 只用于维护 **Posts** 和 **Changelog**，不要在 CMS 中改动其他目录或配置文件。

新文章使用英文 slug；slug 一旦发布就对应公开 URL，新增文章要保持英文、简洁且稳定。已有文章的 slug 和 URL 不得修改；需要改内容时只编辑正文和元数据，避免产生旧链接失效或搜索收录变化。

### 编辑模式与媒体

普通 Markdown 内容使用 Editor mode。包含 Hugo shortcode、Mermaid、Chart.js 或复杂 HTML 时，切换到 **Source mode** 编辑，保留 shortcode 和原始 HTML 结构，不要让可视化编辑器重排或转义它们。

在 CMS 上传的文章图片放入 `static/img/posts`，站点中的引用路径使用 `/img/posts/...`。图片不会上传到 `content`；提交前确认文件名与引用大小写一致。

### Actions 配置与发布规则

在仓库 Settings → Secrets and variables → Actions 配置：

- 必需 secret：`AI_SUMMARY_API_KEY`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
- 可选 secret：`AI_SUMMARY_API`
- 可选 variable 或 secret：`AI_SUMMARY_MODEL`
- 可选配置：`AI_SUMMARY_MAX_INPUT`、`AI_SUMMARY_PROMPT`（按工作流要求作为 variable 或 secret 配置）

CMS 提交到 `main` 后会自动触发发布，不需要点击 CMS 的 deploy 按钮。Actions 手动运行时，日常修复使用 `force_summaries=false`；需要重新生成已有摘要时才使用 `force_summaries=true`。无论是否强制，明确写入 `ai_summary: false` 的文章都是有意停用摘要，始终跳过，不会被覆盖。

AI 摘要生成失败会阻止部署，不应跳过失败继续发布。确认服务商恢复、密钥和配置无误后，重新运行失败的 workflow；成功后才会继续部署。

### 本地检查

`.env` 只供本地使用，禁止提交到 Git。提交前可在仓库根目录依次执行：

```bash
node --test scripts/ensure-content-defaults.test.mjs
node scripts/generate-ai-summary.mjs --dry-run
node scripts/ensure-content-defaults.mjs
hugo --minify
```
