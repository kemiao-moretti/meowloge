# 说说卡片多图智能网格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把说说卡片中的多图从「正文自然高度堆叠」改为「正文下方智能网格」，memos 与 ech0 双数据源统一，并支持 >9 张折叠为「+N」原地展开。

**Architecture:** 在 `shuoshuo.ts` 中新增三个共享函数：`resolveImageUrl`（相对路径补全）、`collectCardImages`（从正文抽离并移除内联 `<img>`）、`buildSmartGallery`（按数量分档渲染网格 + 「+N」折叠/展开）。改造 `buildCard`（ech0）与 `buildMemosCard`（memos）共用该逻辑。`shuoshuo.css` 增加网格变体类、单图限高、+N 遮罩、收起按钮与失败占位样式。全部使用 `--efu-*` 变量，不改 hugo.yaml 与模板。

**Tech Stack:** TypeScript（Hugo Pipes `js.Build` 打包，入口 `assets/ts/entry.ts`）、CSS（`--efu-*` 主题变量）、fancybox 灯箱（`Solitude.lightbox`）。

---

## 构建与验证约定

- **工作分支**：实施前 `git checkout -b feat/shuoshuo-smart-gallery`。
- **构建命令**（在 `e:\kemiao-kmoretti\blog\blog` 下执行，产物输出到仓库外的临时目录）：

  ```bash
  hugo --destination "e:\kemiao-kmoretti\blog\_shuoshuo-grid-check" --cleanDestinationDir
  ```

  预期：退出码 0，日志含 `Built ... pages ...`。完成后删除临时目录：

  ```bash
  Remove-Item -Recurse -Force "e:\kemiao-kmoretti\blog\_shuoshuo-grid-check"
  ```

- **浏览器验证**：启动本地开发服务（后台运行）：

  ```bash
  hugo server --bind 127.0.0.1 --port 1313 --disableFastRender
  ```

  用 Chrome DevTools 打开 `http://localhost:1313/shuoshuo/`，通过 `evaluate_script` 做 DOM 断言。当前 `hugo.yaml` 中 `shuoshuo.source = memos`、`memos.creator = users/kemiao`、`memos.public_only = true`。

- **memos 缓存键格式**（localStorage 造数验证用，见 Task 6）：

  ```text
  solitude-shuoshuo:memos:v1:https://memos.518339.xyz:users/kemiao:true
  ```

- **提交约定**：每个 Task 单独提交，commit message 风格参考仓库历史 `feat(shuoshuo): 中文描述`。只 `git add` 本 Task 涉及的文件，勿带入其他未提交改动。

---

### Task 1: 新增图片收集与 URL 解析工具

**Files:**
- Modify: `themes/solitude/assets/ts/shuoshuo.ts`（在 `buildMemosReactions` 之后、`buildMemosCard` 之前插入）

- [ ] **Step 1: 插入 `resolveImageUrl` 与 `collectCardImages`**

在 `const buildMemosCard = async (...)` 之前插入以下代码：

```typescript
/* ---------------- 多图智能网格 ---------------- */

const resolveImageUrl = (config: PageConfig, raw: string) => {
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = config.api;
  return `${base}${raw.startsWith("/") ? "" : "/"}${raw}`;
};

const collectCardImages = (config: PageConfig, body: HTMLElement): string[] => {
  const urls: string[] = [];
  body.querySelectorAll<HTMLImageElement>("img:not(.no-lightbox)").forEach((img) => {
    if (img.closest("a")) return;
    const raw = img.currentSrc || img.getAttribute("src") || "";
    if (!raw) return;
    urls.push(resolveImageUrl(config, raw));
    img.remove();
  });
  return urls;
};
```

说明：`collectCardImages` 把正文渲染结果里的内联 `<img>`（跳过 `.no-lightbox` 头像、跳过已位于 `<a>` 内的图链）记录为绝对 URL 并从正文移除，保证正文不再出现原图堆叠。

- [ ] **Step 2: 构建验证**

```bash
hugo --destination "e:\kemiao-kmoretti\blog\_shuoshuo-grid-check" --cleanDestinationDir
```

预期：退出码 0，无 `error TS` 报错。

- [ ] **Step 3: 提交**

```bash
git add themes/solitude/assets/ts/shuoshuo.ts
git commit -m "feat(shuoshuo): 新增图片URL解析与正文内联图抽离工具"
```

---

### Task 2: 新增 `buildSmartGallery` 智能网格

**Files:**
- Modify: `themes/solitude/assets/ts/shuoshuo.ts`（接在 Task 1 插入的函数之后）

- [ ] **Step 1: 插入 `SMART_GRID_LIMIT` 常量与 `buildSmartGallery`**

在 `collectCardImages` 之后插入：

```typescript
const SMART_GRID_LIMIT = 9;

const buildSmartGallery = (rawUrls: string[]) => {
  const urls = [...new Set(rawUrls.map((u) => (u || "").trim()).filter(Boolean))];
  if (!urls.length) return null;

  const gallery = document.createElement("div");
  gallery.className = "shuoshuo-gallery";
  if (urls.length === 1) gallery.classList.add("is-single");
  else if (urls.length === 2) gallery.classList.add("is-pair");

  const createLink = (url: string) => {
    const link = document.createElement("a");
    link.className = "shuoshuo-image";
    link.href = url;
    link.setAttribute("data-fancybox", "shuoshuo-gallery");
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => link.classList.add("is-broken"), { once: true });
    link.append(img);
    return link;
  };

  const collapsed = urls.length > SMART_GRID_LIMIT;
  const visibleLinks = urls.slice(0, SMART_GRID_LIMIT).map(createLink);
  const hiddenLinks = urls.slice(SMART_GRID_LIMIT).map(createLink);

  const hiddenBox = document.createElement("div");
  hiddenBox.className = "shuoshuo-gallery-extra";
  hiddenBox.hidden = true;
  hiddenLinks.forEach((link) => hiddenBox.append(link));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "shuoshuo-gallery-toggle";

  let isExpanded = false;
  const lastCell = collapsed ? visibleLinks[visibleLinks.length - 1] : null;
  const overlay = collapsed
    ? Object.assign(document.createElement("span"), {
        className: "shuoshuo-gallery-more",
        textContent: `+${hiddenLinks.length}`,
      })
    : null;

  const setExpanded = (next: boolean) => {
    isExpanded = next;
    hiddenBox.hidden = !isExpanded;
    gallery.classList.toggle("is-expanded", isExpanded);
    if (overlay) overlay.remove();
    toggle.textContent = isExpanded ? "收起" : `展开全部 ${urls.length} 张`;
    if (!isExpanded && collapsed && lastCell) lastCell.append(overlay);
  };

  if (overlay && lastCell) {
    overlay.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(true);
    });
    lastCell.append(overlay);
  }
  toggle.addEventListener("click", () => setExpanded(!isExpanded));

  visibleLinks.forEach((link) => gallery.append(link));
  gallery.append(hiddenBox);
  if (collapsed) gallery.append(toggle);
  setExpanded(false);
  return gallery;
};
```

说明：`>9` 时第 9 格覆盖「+N」；点击遮罩（阻止冒泡，避免触发 fancybox）或「收起/展开全部」按钮原地切换隐藏格；隐藏格与其余缩略图在渲染期已随 DOM 存在，`applyGallery` 的一次性 `Fancybox.bind` 已覆盖它们，展开时无需重绑（`Solitude.lightbox` 全局绑定有 `window.fancyboxRun` 单次守卫）。

- [ ] **Step 2: 构建验证**

```bash
hugo --destination "e:\kemiao-kmoretti\blog\_shuoshuo-grid-check" --cleanDestinationDir
```

预期：退出码 0，无 `error TS` 报错。

- [ ] **Step 3: 提交**

```bash
git add themes/solitude/assets/ts/shuoshuo.ts
git commit -m "feat(shuoshuo): 新增多图智能网格构建器（分档+折叠展开）"
```

---

### Task 3: 改造 ech0 `buildCard` 使用智能网格

**Files:**
- Modify: `themes/solitude/assets/ts/shuoshuo.ts`（`buildCard` 内，约原第 317-338 行）

- [ ] **Step 1: 替换图片渲染块**

把 `buildCard` 中的以下旧代码：

```typescript
  // 图片（含正文内嵌图 + echo_files）
  const images = (item.echo_files || []).filter(isImageFile).map((file) => fileUrl(config, file));
  const inlineImages = [...body.querySelectorAll("img")].map((img) => img.getAttribute("src") || "");
  const allImages = [...new Set([...inlineImages, ...images])].filter(Boolean);
  if (images.length) {
    const gallery = document.createElement("div");
    gallery.className = "shuoshuo-gallery";
    images.forEach((url) => {
      const link = document.createElement("a");
      link.className = "shuoshuo-image";
      link.href = url;
      link.setAttribute("data-fancybox", "shuoshuo-gallery");
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => link.classList.add("is-broken"), { once: true });
      link.append(img);
      gallery.append(link);
    });
    card.append(gallery);
  }
```

替换为：

```typescript
  // 图片（正文内联图 + echo_files）统一进智能网格
  const inlineImages = collectCardImages(config, body);
  const attachmentImages = (item.echo_files || [])
    .filter(isImageFile)
    .map((file) => fileUrl(config, file))
    .filter(Boolean);
  const gallery = buildSmartGallery([...inlineImages, ...attachmentImages]);
  if (gallery) card.append(gallery);
```

注意：`collectCardImages(config, body)` 必须位于 `body.innerHTML = html` 之后（当前 `body` 在第 305-307 行已赋值并 append），顺序保持即可。

- [ ] **Step 2: 构建验证**

```bash
hugo --destination "e:\kemiao-kmoretti\blog\_shuoshuo-grid-check" --cleanDestinationDir
```

预期：退出码 0；无 `isImageFile` 变为未使用的告警。

- [ ] **Step 3: 提交**

```bash
git add themes/solitude/assets/ts/shuoshuo.ts
git commit -m "feat(shuoshuo): ech0卡片图片接入智能网格"
```

---

### Task 4: 改造 memos `buildMemosCard` 使用智能网格

**Files:**
- Modify: `themes/solitude/assets/ts/shuoshuo.ts`（`buildMemosCard` 内，约原第 496-519 行）

- [ ] **Step 1: 替换附件/画廊渲染块**

把 `buildMemosCard` 中的以下旧代码：

```typescript
  const attachments = item.attachments || [];
  const imageFiles = attachments.filter(isImageMemos);
  const fileFiles = attachments.filter((attachment) => !isImageMemos(attachment));

  if (imageFiles.length) {
    const gallery = document.createElement("div");
    gallery.className = "shuoshuo-gallery";
    imageFiles.forEach((attachment) => {
      const url = memosAttachmentUrl(config, attachment);
      if (!url) return;
      const link = document.createElement("a");
      link.className = "shuoshuo-image";
      link.href = url;
      link.setAttribute("data-fancybox", "shuoshuo-gallery");
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => link.classList.add("is-broken"), { once: true });
      link.append(img);
      gallery.append(link);
    });
    if (gallery.childElementCount) card.append(gallery);
  }
```

替换为：

```typescript
  const attachments = item.attachments || [];
  const fileFiles = attachments.filter((attachment) => !isImageMemos(attachment));
  const inlineImages = collectCardImages(config, body);
  const attachmentImages = attachments
    .filter(isImageMemos)
    .map((attachment) => memosAttachmentUrl(config, attachment))
    .filter(Boolean);
  const gallery = buildSmartGallery([...inlineImages, ...attachmentImages]);
  if (gallery) card.append(gallery);
```

注意：`body` 在 `buildMemosCard` 中位于本块之前（第 490-494 行），`collectCardImages(config, body)` 在 `body.innerHTML = html` 之后执行。

- [ ] **Step 2: 构建验证**

```bash
hugo --destination "e:\kemiao-kmoretti\blog\_shuoshuo-grid-check" --cleanDestinationDir
```

预期：退出码 0，无 `error TS` 报错。

- [ ] **Step 3: 提交**

```bash
git add themes/solitude/assets/ts/shuoshuo.ts
git commit -m "feat(shuoshuo): memos卡片图片接入智能网格"
```

---

### Task 5: 网格样式（CSS）

**Files:**
- Modify: `themes/solitude/assets/css/solitude/pages/shuoshuo.css`（替换 gallery 段约第 153-182 行，与响应式段约第 442-450 行）

- [ ] **Step 1: 替换 gallery 样式块**

把以下旧代码：

```css
/* ---- gallery ---- */
.shuoshuo-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px;
}

.shuoshuo-image {
  display: block;
  border-radius: var(--efu-radius-sm, 8px);
  overflow: hidden;
}

.shuoshuo-image img {
  width: 100%;
  height: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  transition: transform var(--efu-motion-fast, 180ms);
}

.shuoshuo-image:hover img {
  transform: scale(1.04);
}

.shuoshuo-image.is-broken img,
.shuoshuo-inline-image.is-broken img {
  display: none;
}
```

替换为：

```css
/* ---- gallery ---- */
.shuoshuo-gallery {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.shuoshuo-gallery.is-single {
  grid-template-columns: 1fr;
}

.shuoshuo-gallery.is-pair {
  grid-template-columns: repeat(2, 1fr);
}

.shuoshuo-gallery.is-single .shuoshuo-image img {
  width: 100%;
  height: auto;
  max-height: 480px;
  aspect-ratio: auto;
  object-fit: cover;
}

.shuoshuo-image {
  display: block;
  position: relative;
  border-radius: var(--efu-radius-sm, 8px);
  overflow: hidden;
}

.shuoshuo-image img {
  width: 100%;
  height: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  transition: transform var(--efu-motion-fast, 180ms);
}

.shuoshuo-image:hover img {
  transform: scale(1.04);
}

.shuoshuo-image.is-broken img,
.shuoshuo-inline-image.is-broken img {
  display: none;
}

.shuoshuo-image.is-broken::after {
  content: "图片已失效";
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  padding: 12px;
  color: var(--efu-secondtext);
  font-size: 12px;
  background: var(--efu-secondbg);
}
```

- [ ] **Step 2: 新增折叠/展开样式**

紧跟 gallery 样式块之后（`/* ---- extension cards ---- */` 之前）插入：

```css
/* ---- gallery 折叠 / 展开 ---- */
.shuoshuo-gallery-more {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
  color: var(--efu-white);
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  z-index: 1;
}

.shuoshuo-gallery-extra {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.shuoshuo-gallery-extra[hidden] {
  display: none;
}

.shuoshuo-gallery-toggle {
  grid-column: 1 / -1;
  justify-self: center;
  margin-top: 4px;
  padding: 4px 14px;
  border: 1px solid var(--efu-card-border);
  border-radius: var(--efu-radius-pill, 999px);
  background: transparent;
  color: var(--efu-secondtext);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.3s, border-color 0.3s, background 0.3s;
}

.shuoshuo-gallery-toggle:hover {
  color: var(--efu-main);
  border-color: var(--efu-main);
}
```

- [ ] **Step 3: 更新响应式段**

把 `@media (max-width: 450px)` 内的：

```css
  .shuoshuo-gallery {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  }
```

替换为：

```css
  .shuoshuo-gallery {
    gap: 4px;
  }
```

- [ ] **Step 4: 构建验证**

```bash
hugo --destination "e:\kemiao-kmoretti\blog\_shuoshuo-grid-check" --cleanDestinationDir
```

预期：退出码 0。

- [ ] **Step 5: 提交**

```bash
git add themes/solitude/assets/css/solitude/pages/shuoshuo.css
git commit -m "feat(shuoshuo): 智能网格样式（分档/限高/折叠/失败占位）"
```

---

### Task 6: 端到端浏览器验证

**Files:** 无代码改动，仅验证。

前置：启动开发服务 `hugo server --bind 127.0.0.1 --port 1313 --disableFastRender`（后台运行），用 Chrome DevTools 打开 `http://localhost:1313/shuoshuo/`。

- [ ] **Step 1: 验证真实多图说说（6 张）**

页面加载后 `evaluate_script` 断言：

```javascript
(() => {
  const cards = [...document.querySelectorAll(".shuoshuo-card")];
  const target = cards.find((c) => (c.textContent || "").includes("玄武区"));
  if (!target) return "FAIL: 未找到招聘会说说卡片";
  const gallery = target.querySelector(".shuoshuo-gallery");
  if (!gallery) return "FAIL: 未渲染 gallery";
  const links = [...gallery.querySelectorAll(".shuoshuo-image")];
  const bodyImgs = target.querySelectorAll(".shuoshuo-card-body img").length;
  return {
    gridColumns: getComputedStyle(gallery).gridTemplateColumns.split(" ").length,
    imageCount: links.length,
    bodyImgs,
    cardHeight: Math.round(target.getBoundingClientRect().height),
  };
})()
```

预期：`gridColumns = 3`、`imageCount = 6`、`bodyImgs = 0`（正文内联图已抽离）、`cardHeight` 明显小于原堆叠高度（< 1200px）。若 `cardHeight` 仍偏大，在终端截图确认。

- [ ] **Step 2: 验证灯箱**

`evaluate_script` 点击招聘会说说第 1 张缩略图，确认打开 fancybox（`document.querySelector(".fancybox__container")` 存在），关闭后无报错。

- [ ] **Step 3: 验证单图说说**

断言「测试图片上传」那条 1 图说说的 gallery 有 `is-single` 类、图片 `max-height` 为 `480px`（`getComputedStyle(img).maxHeight`），且无 `is-broken`。

- [ ] **Step 4: 造数验证「>9 折叠 / 原地展开 / 收起」**

用 `evaluate_script` 注入 localStorage 夹具（12 张图），再刷新页面：

```javascript
(() => {
  const key = "solitude-shuoshuo:memos:v1:https://memos.518339.xyz:users/kemiao:true";
  const imgs = Array.from({ length: 12 }, (_, i) => `![](https://picsum.photos/seed/sn${i + 1}/400/400)`);
  const fixture = [{
    name: "memos/test-many-images",
    content: `#测试 十二图折叠验证\n${imgs.join("\n")}`,
    createTime: "2026-09-19T00:00:00Z",
    visibility: "PUBLIC",
    tags: [],
    attachments: [],
    reactions: [],
    pinned: false,
  }];
  localStorage.setItem(key, JSON.stringify({ time: Date.now(), data: fixture }));
  return key;
})()
```

刷新 `http://localhost:1313/shuoshuo/` 后断言：

```javascript
(() => {
  const card = [...document.querySelectorAll(".shuoshuo-card")].find((c) => (c.textContent || "").includes("十二图折叠验证"));
  if (!card) return "FAIL: 夹具卡片未渲染";
  const gallery = card.querySelector(".shuoshuo-gallery");
  const visible = [...gallery.querySelectorAll(".shuoshuo-image")].length;
  const overlay = gallery.querySelector(".shuoshuo-gallery-more");
  const hidden = gallery.querySelector(".shuoshuo-gallery-extra");
  return { visible, overlayText: overlay?.textContent || null, hiddenHidden: hidden?.hidden };
})()
```

预期：`visible = 9`、`overlayText = "+3"`、`hiddenHidden = true`。

继续断言展开与收起：点击遮罩后 → `visible = 12`、`overlayText = null`、`hiddenHidden = false`、出现「收起」按钮；点击「收起」→ 回到 `visible = 9`、`overlayText = "+3"`。

验证后清理夹具缓存：`evaluate_script` `localStorage.removeItem(key)` 并刷新。

- [ ] **Step 5: 验证失败占位**

临时把夹具某张图 URL 改为 `https://picsum.photos/seed/nonexistent/999/999`（必然 404）刷新，断言该缩略图链接含 `is-broken` 且显示「图片已失效」文本；随后清理夹具与缓存。

- [ ] **Step 6: ech0 回归（尽力而为）**

停止 memos 场景：清空 localStorage 中 memos 缓存键后刷新，确认 6 图说说仍按新网格渲染（回归真实数据路径）。ech0 路径因本机无法保证 m.081531.xyz 可达，采用代码审查确认：`buildCard` 已无旧 gallery 代码、`isImageFile`/`fileUrl` 仍被引用，构建通过即可。若 ech0 实例可达，可临时将 `hugo.yaml` 的 `shuoshuo.source` 改为 `ech0` 构建后核对无图卡片与单图卡片，完毕立即还原 `source: memos` 且不提交该文件。

- [ ] **Step 7: 停止开发服务并收尾**

停止 `hugo server`；删除 `e:\kemiao-kmoretti\blog\_shuoshuo-grid-check`（若存在）。

---

## Self-Review 记录

- **Spec 覆盖**：分档网格（Task 2/5）、内联图抽离去重（Task 1/3/4）、单图限高 480px（Task 5）、>9 折叠「+N」与原地展开收起（Task 2/5）、灯箱统一（Task 2 沿用 data-fancybox + applyGallery）、失败占位（Task 5）、双数据源统一（Task 3/4）、主题兼容（Task 5 全用 `--efu-*`）。验证计划（Task 6）覆盖 0/1/2/6/12 图边界。
- **类型一致**：`resolveImageUrl(config, raw)`、`collectCardImages(config, body)`、`buildSmartGallery(config, rawUrls)` 签名在 Task 3/4 中一致使用；CSS 类名 `is-single` / `is-pair` / `shuoshuo-gallery-more` / `shuoshuo-gallery-extra` / `shuoshuo-gallery-toggle` 在 TS 与 CSS 中一致。
