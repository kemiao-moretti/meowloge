# 关于页手机端充电按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在关于页赞助卡片的手机端（≤768px）补一个通栏充电按钮，点击复用既有打赏二维码弹窗，桌面端表现完全不变。

**Architecture:** 三层小改动——`about.yaml` 新增手机端文案字段；`reward.html` 在赞助声明与赞赏名单之间插入一个 `data-reward-open` 按钮（用独立类名避免命中桌面端规则）；`about.css` 让按钮默认 `display:none`、仅在既有 768px 断点内显示。无需改 JS，弹窗绑定基于 `[data-reward-open]` 自动生效。

**Tech Stack:** Hugo Go Template、CSS（`--efu-*` 主题变量）、原生 DOM 事件（既有 `about-reward.ts`）。

**重要约定：本仓库由用户手动上传，不执行任何 `git add` / `git commit`。** 计划中不含提交步骤。

**工作目录：** `e:\kemiao-kmoretti\blog\blog`

---

### Task 1: 新增手机端文案配置

**Files:**
- Modify: `blog/data/about.yaml`（约第 137 行 `action_text` 之后）

- [ ] **Step 1: 在 `action_text` 下方新增 `mobile_action_text`**

把：

```yaml
  action_text: 为TA充电
```

改为：

```yaml
  action_text: 为TA充电
  mobile_action_text: 为 TA 充电
```

注意：必须与 `action_text` 同缩进（2 空格），插入在 `sponsor_notice` 之前，保持 YAML 合法。

- [ ] **Step 2: 校验 YAML 可解析**

Run:
```bash
python -c "import yaml; d=yaml.safe_load(open('data/about.yaml', encoding='utf-8')); print(d['reward']['action_text'], '|', d['reward']['mobile_action_text'])"
```
Expected 输出：`为TA充电 | 为 TA 充电`

---

### Task 2: 模板插入手机端按钮

**Files:**
- Modify: `themes/solitude/layouts/_partials/pages/about/reward.html`（第 17 行 `</div>` 与第 18 行 `{{- if .donations -}}` 之间）

- [ ] **Step 1: 插入按钮标记**

在 `reward-card-header` 的收尾 `</div>`（第 17 行）之后、`{{- if .donations -}}`（第 18 行）之前插入：

```html
      {{- $mobileText := .mobile_action_text | default .action_text -}}
      {{- with $mobileText -}}
        <button type="button" class="about-card-button reward-mobile-button" data-reward-open>
          <span class="reward-mobile-icon" aria-hidden="true">ϟ</span><span>{{ . }}</span>
        </button>
      {{- end -}}
```

插入后该区域应形如：

```html
      </div>
      {{- $mobileText := .mobile_action_text | default .action_text -}}
      {{- with $mobileText -}}
        <button type="button" class="about-card-button reward-mobile-button" data-reward-open>
          <span class="reward-mobile-icon" aria-hidden="true">ϟ</span><span>{{ . }}</span>
        </button>
      {{- end -}}
      {{- if .donations -}}
        <div class="reward-list" aria-label="赞赏记录">
```

要点：
- 按钮是 `.reward-card` 的直接子元素，位于 `reward-card-header` **之外**，因此不受该 header `padding-right: 366px` 影响。
- 复用 `about-card-button` 基础类与 `data-reward-open` 属性。
- **不要**使用 `reward-action-button` / `reward-action-icon` 类名（桌面端 `.reward-card .reward-action-button` 会强制 `width:157px`，`reward-action-icon` 是 38px 超大字号）。

- [ ] **Step 2: 构建确认模板无语法错误**

Run:
```bash
hugo --destination "e:\kemiao-kmoretti\blog\_reward-mobile-check" --cleanDestinationDir
```
Expected：退出码 0，无 ERROR。随后删除临时目录：
```bash
Remove-Item -Recurse -Force "e:\kemiao-kmoretti\blog\_reward-mobile-check"
```

- [ ] **Step 3: 确认产物含新按钮**

Run:
```bash
Select-String -Path "e:\kemiao-kmoretti\blog\blog\public\about\index.html" -Pattern 'reward-mobile-button' -SimpleMatch
```
（若用临时目录构建，则在 `_reward-mobile-check\about\index.html` 中查。）
Expected：至少 1 处匹配 `reward-mobile-button`。

---

### Task 3: 新增按钮样式

**Files:**
- Modify: `themes/solitude/assets/css/solitude/pages/about.css`（新增规则；768px 断点块位于第 1091-1104 行）

- [ ] **Step 1: 新增默认隐藏与按钮基础样式**

在 `#about-page .reward-sponsor-notice .reward-sponsor-mail:focus-visible { ... }` 规则块（约第 671-675 行）之后、`#about-page .about-reward-animation {` （约第 677 行）之前插入：

```css
#about-page .reward-mobile-button {
  display: none;
}

#about-page .reward-mobile-icon {
  display: inline-flex;
  align-items: center;
  font-family: Arial, sans-serif;
  font-size: 18px;
  font-weight: 400;
  line-height: 1;
  transform: rotate(8deg) skew(-8deg);
}
```

说明：默认 `display: none` 保证桌面端不显示、不占位；图标独立类设定 18px，避免继承桌面端的 38px。

- [ ] **Step 2: 在 768px 断点内启用按钮**

在 `@media (max-width: 768px) { ... }` 块（第 1091-1104 行）内，于 `#about-page .about-reward-animation { display: none; }`（第 1099 行）之后插入：

```css
  #about-page .reward-mobile-button {
    display: flex;
    width: 100%;
    min-height: 46px;
    margin: 14px 0 0;
    padding: 10px 16px;
    gap: 8px;
    font-size: 15px;
    background: var(--efu-theme);
    border: 1px solid color-mix(in srgb, var(--efu-theme) 82%, var(--efu-white));
    border-radius: var(--efu-radius-sm);
    box-shadow: 0 4px 4px var(--efu-theme-op);
  }
```

说明：`--efu-theme` / `--efu-theme-op` / `--efu-radius-sm` 与桌面端闪电按钮同一套 token；`display: flex` 与 `.about-card-button` 自带的 `align-items/justify-content: center`、`color: #fff`、`font-weight: 700` 配合，得到通栏居中按钮。

- [ ] **Step 3: 构建确认样式已打包**

Run:
```bash
hugo --destination "e:\kemiao-kmoretti\blog\_reward-mobile-check" --cleanDestinationDir
```
Expected：退出码 0。随后：
```bash
Get-ChildItem "e:\kemiao-kmoretti\blog\_reward-mobile-check\css\solitude\*.css" | ForEach-Object { if (Select-String -Path $_.FullName -Pattern 'reward-mobile-button' -SimpleMatch -Quiet) { "FOUND in $($_.Name)" } }
```
Expected：输出 `FOUND in solitude.<hash>.css`。
最后删除临时目录：`Remove-Item -Recurse -Force "e:\kemiao-kmoretti\blog\_reward-mobile-check"`

---

### Task 4: 端到端浏览器验证

**Files:** 无代码改动，仅验证。

前置：启动开发服务（后台）：
```bash
hugo server --bind 127.0.0.1 --port 1313 --disableFastRender
```
若 1313 已被占用，说明服务已在运行，直接复用 `http://127.0.0.1:1313/about/`。

- [ ] **Step 1: 手机视口下按钮可见**

用 Chrome DevTools 打开 `http://127.0.0.1:1313/about/`，将视口宽度设为 390（iPhone 尺寸），执行脚本断言：

```javascript
(() => {
  const btn = document.querySelector(".reward-mobile-button");
  if (!btn) return "FAIL: 未找到 .reward-mobile-button";
  const style = getComputedStyle(btn);
  const rect = btn.getBoundingClientRect();
  const notice = document.querySelector(".reward-sponsor-notice");
  const list = document.querySelector(".reward-list");
  return {
    display: style.display,
    text: btn.innerText.trim(),
    width: Math.round(rect.width),
    cardWidth: Math.round(document.querySelector(".reward-card").getBoundingClientRect().width),
    afterNotice: notice ? btn.getBoundingClientRect().top > notice.getBoundingClientRect().top : null,
    beforeList: list ? btn.getBoundingClientRect().top < list.getBoundingClientRect().top : null,
  };
})()
```

Expected：`display = "flex"`、`text = "为 TA 充电"`、`width` 接近 `cardWidth`（通栏，差值约等于卡片左右内边距 ×2）、`afterNotice = true`、`beforeList = true`。

- [ ] **Step 2: 点击打开弹窗**

在手机视口下执行：

```javascript
(() => {
  const btn = document.querySelector(".reward-mobile-button");
  btn.click();
  const overlay = document.querySelector(".reward-dialog-overlay");
  return {
    opened: overlay.classList.contains("is-open"),
    qrCount: overlay.querySelectorAll(".qr-image").length,
    bodyLocked: document.body.classList.contains("reward-dialog-lock"),
  };
})()
```

Expected：`opened = true`、`qrCount = 2`（微信 + 支付宝）、`bodyLocked = true`。

随后验证关闭（点遮罩）：

```javascript
(() => {
  const overlay = document.querySelector(".reward-dialog-overlay");
  overlay.click();
  return { closed: !overlay.classList.contains("is-open") };
})()
```

Expected：`closed = true`。

- [ ] **Step 3: 桌面视口回归（按钮不显示）**

将视口宽度恢复为 1280，执行：

```javascript
(() => {
  const btn = document.querySelector(".reward-mobile-button");
  const anim = document.querySelector(".about-reward-animation");
  const desktopBtn = document.querySelector(".reward-action-button");
  return {
    mobileDisplay: btn ? getComputedStyle(btn).display : "missing",
    animationDisplay: anim ? getComputedStyle(anim).display : "missing",
    desktopButtonVisible: desktopBtn ? desktopBtn.getBoundingClientRect().width > 0 : null,
  };
})()
```

Expected：`mobileDisplay = "none"`、`animationDisplay` 为 `block` 或 `absolute` 布局下的正常值（非 `none`）、`desktopButtonVisible = true`。

- [ ] **Step 4: 文案回退验证（可选，需临时改动）**

临时把 `about.yaml` 的 `mobile_action_text` 一行删除，重新加载 `/about/` 并设手机视口，断言按钮 `innerText` 等于 `为TA充电`（即回退到 `action_text`）。验证后**恢复**该行。

- [ ] **Step 5: 停止开发服务**

停止第 4 步启动的 `hugo server`（若该服务由用户启动，则不要停止，仅告知）。

---

## Self-Review 记录

- **Spec 覆盖**：手机端显示（Task 3 Step 2 + Task 4 Step 1）、桌面端不显示（Task 3 Step 1 + Task 4 Step 3）、文案来源与回退（Task 1 + Task 2 + Task 4 Step 4）、复用弹窗交互（Task 2 + Task 4 Step 2）、主题一致性（Task 3 全用 `--efu-*`）、位置在声明与名单之间（Task 2 Step 1 + Task 4 Step 1 的 `afterNotice`/`beforeList` 断言）。
- **类名一致**：`reward-mobile-button` / `reward-mobile-icon` 在 Task 2（模板）与 Task 3（CSS）中完全一致，且与桌面端 `reward-action-button` / `reward-action-icon` 无交集。
- **无提交步骤**：按用户「自己上传」约定，全计划不含 `git add` / `git commit`。
