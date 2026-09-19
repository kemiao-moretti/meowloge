# 说说卡片多图智能网格 · 设计文档

- 日期：2026-09-19
- 状态：已批准（用户确认，交互经可视化伴侣 mockup 验证）

## Why

说说页（/shuoshuo/）的 memos 数据源中，多图说说（实测 `memos/inw4pfjluelftla1ewnh`，6 张图）的图片**以内联 Markdown 形式存于 `content`，而 `attachments` 为空**。当前 `buildMemosCard` 只把 `attachments` 里的图片放进 `.shuoshuo-gallery`，正文原样渲染 → 6 张原图以自然尺寸（多为竖版长图）纵向堆叠，把卡片撑成「大洞」，瀑布流视觉断层。ech0 路径同样存在「正文内联图 + echo_files」两份图片并列的问题。

目标：把多图说说的图片统一抽离到正文下方**智能网格**，限制卡片高度，并让 memos 与 ech0 两个数据源表现一致。

## 根因（已验证）

- Memos 0.30 实测：多图说说 `attachments: []`，图片全部在 `content` 的 `![](https://tg.518339.xyz/api/files/content/{id}/preview)` 内联引用中。
- `shuoshuo.ts` 现状：`buildMemosCard` 只消费 `attachments`（为空 → 无 gallery），正文内联 `<img>` 无高度约束 → 卡片超高。
- ech0 现状：`buildCard` 已计算 `inlineImages`（正文内联图）但 gallery 只用 `echo_files`，内联图仍留在正文自然高度展示。

## 设计

### 1. 图片收集与去重（共享逻辑）

新增函数在渲染正文 HTML 后执行：

- `collectCardImages(config, body): string[]`
  - 遍历 `body.querySelectorAll("img:not(.no-lightbox)")`，跳过位于 `<a>` 内的图片（用户有意的图文链），跳过已被 `is-broken` 处理的元素。
  - 取 `img.currentSrc || img.getAttribute("src")`，相对路径（以 `/` 开头或非 `http(s)`）用 `{api}` 前缀解析为绝对 URL。
  - 收集后 `img.remove()`，把图片从正文流抽离。
- 与附件图合并去重：`[...new Set([...inline, ...attachments])]`，保持出现顺序。
- 两数据源共用该收集逻辑：memos 用 `attachments`，ech0 用 `echo_files`。

### 2. 智能网格分档（`buildSmartGallery(config, urls)`）

| 图片数 | 布局 | 卡片高度影响 |
|---|---|---|
| 0 | 无 gallery | — |
| 1 | 通栏大图：`max-height ≈ 480px`，`width: 100%`，`object-fit: cover` 居中裁剪 | 封顶 ~480px |
| 2 | 2 列方形缩略（`aspect-ratio: 1/1` + `cover`） | 1 行 |
| 3~9 | **3 列**方形缩略 | 最多 3 行（9 张封顶） |
| >9 | 只渲染前 9 张，第 9 格叠加「+N」（N=总数−9） | 恒为 3 行 |

网格用变体类控制列数：`.shuoshuo-gallery--single`（1 列通栏）、`.shuoshuo-gallery--pair`（2 列）、默认 `.shuoshuo-gallery`（3 列）。缩略图 `object-fit: cover`，行内 `gap` 沿用现有 6px。

### 3. 「+N」折叠与原地展开

- `>9` 张时：渲染前 9 个缩略图链接，第 9 格内叠加半透明遮罩与「+N」文本。
- 点击「+N」格（非灯箱）：在网格中插入剩余图片链接，并在网格下方显示「收起」胶囊按钮。
- 点击「收起」：移除多出的链接与按钮，回到折叠态。
- 展开后新增的缩略图重新调用 `Solitude.lightbox` 绑定灯箱（`data-fancybox="shuoshuo-gallery"`）。
- 折叠/展开状态为组件内部 DOM 状态，不做持久化。

### 4. 灯箱与失败占位

- 所有缩略图 `<a data-fancybox="shuoshuo-gallery">`，点击浏览原图（单图同样进灯箱）。
- 图片加载失败：沿用现有 `.is-broken` 机制（隐藏 `<img>`），并为 gallery 链接补充 `::after` 文本「图片已失效」占位（与正文内联图现有占位视觉一致）。
- 现有 `applyGallery` 对剩余正文内联图（如有）的 fancybox 包裹逻辑保留兜底。

### 5. 双数据源统一

- ech0 `buildCard` 与 memos `buildMemosCard` 均改为：正文渲染 → 收集/抽离内联图 → 合并附件图 → `buildSmartGallery` 追加到卡片。
- ech0 无图/无内联图的卡片行为完全不变。

## 改动范围（Affected code）

- `themes/solitude/assets/ts/shuoshuo.ts`（新增 `collectCardImages` / `buildSmartGallery`，改造 `buildCard` / `buildMemosCard`，扩展折叠交互与灯箱重绑）
- `themes/solitude/assets/css/solitude/pages/shuoshuo.css`（gallery 变体类、单图限高、+N 遮罩与收起按钮、失败占位 `::after`）

**不改动**：`hugo.yaml`、`shuoshuo.html`、`content/shuoshuo/_index.md`、友链/赞助工作流、主题其余页面。

## Requirements

### Requirement: 内联图抽离与去重
系统 SHALL 从正文渲染结果中移除内联 `<img>`（`.no-lightbox` 与位于 `<a>` 内的除外），按解析后的绝对 URL 与附件图去重合并，统一渲染到正文下方。

### Requirement: 分档网格
系统 SHALL 按图片数量渲染网格：1 图=通栏限高 480px 居中裁剪；2 图=2 列方形；3~9 图=3 列方形；>9 图=前 9 张 +「+N」折叠。

### Requirement: 折叠交互
系统 SHALL 支持点击「+N」在卡片内原地展开全部图片，并提供「收起」按钮恢复折叠；展开后缩略图灯箱可用。

### Requirement: 失败与灯箱
系统 SHALL 为 gallery 图片提供加载失败占位（「图片已失效」），所有缩略图统一接入 `data-fancybox="shuoshuo-gallery"` 灯箱。

### Requirement: 双数据源一致
系统 SHALL 使 memos 与 ech0 两个数据源共用同一套图片收集与网格渲染逻辑；无图卡片行为不变。

### Requirement: 主题兼容
新增样式 SHALL 仅使用 `--efu-*` 变量与现有 `.shuoshuo-*` 命名，保持明暗主题与响应式布局。

## 边界与取舍

- **图文穿插顺序**：抽离后图片统一居正文下方，正文中「图与文字穿插叙述」的排布会丢失（社交信息流惯例，用户已接受）。
- **单图裁剪**：限高 + `cover` 会裁掉超出 480px 部分，点灯箱可看完整原图。
- **大图数量**：>9 张仅影响展开成本，折叠态始终 3 行封顶。
- **图片 URL 解析**：相对路径以 `{api}` 前缀补全；`externalLink` 优先（memos）。
- **缓存**：不影响现有 localStorage 缓存键与分页逻辑。

## 验证计划

1. 本地构建 TypeScript（`esbuild`/项目现有脚本）与 Hugo 构建通过。
2. 以真实数据（`memos/inw4pfjluelftla1ewnh` 6 图）验证：卡片显示 3×2 方格、正文无内联图、灯箱可浏览、高度受限。
3. 边界用例：0 图 / 1 竖版长图 / 2 图 / 9 图 / 12 图（折叠「+3」→ 展开 → 收起）。
4. 失败占位：构造失效图片 URL 验证「图片已失效」。
5. ech0 数据源切换回归：无图说说、单图说说行为不变。
