# 关于页赞助组件 · 手机端充电按钮 · 设计文档

- 日期：2026-09-19
- 状态：已批准（用户确认，交互经可视化伴侣 mockup 验证）

## Why

关于页（`/about/`）的赞助组件在移动端没有任何充电入口：`about.css` 在 `@media (max-width: 768px)` 下把整块 `.about-reward-animation`（含闪电按钮与管道动画）设为 `display: none`，而 `.about-reward-animation` 是页面唯一的充电触发区。结果是手机用户能看完整份赞赏名单与赞助声明，却无法触发打赏二维码弹窗。

目标：在手机端赞助卡片内补一个简化的通栏充电按钮，位置与形态贴合现有卡片布局，不改变桌面端任何表现。

## 现状（已验证）

- `reward.html` 结构：`reward-card-header`（tip / title / description / sponsor_notice）→ `reward-list`（或 `reward-empty-text`）→ `about-reward-animation`（按钮 + 管道动画 + 共 N 人）。
- 触发按钮：[reward.html:35](file:///e:/kemiao-kmoretti/blog/blog/themes/solitude/layouts/_partials/pages/about/reward.html#L35)，属性 `data-reward-open`，文案取 `action_text`。
- 弹窗绑定：[about-reward.ts:27-29](file:///e:/kemiao-kmoretti/blog/blog/themes/solitude/assets/ts/about-reward.ts#L27-L29) 查询**所有** `[data-reward-open]` 元素并绑定 → 新增按钮复用该属性即自动接入，无需改 JS。
- 移动端隐藏：[about.css:1099](file:///e:/kemiao-kmoretti/blog/blog/themes/solitude/assets/css/solitude/pages/about.css#L1099) `#about-page .about-reward-animation { display: none; }`，位于 `@media (max-width: 768px)` 块内（[about.css:1091-1104](file:///e:/kemiao-kmoretti/blog/blog/themes/solitude/assets/css/solitude/pages/about.css#L1091-L1104)）。
- 桌面端 `reward-card-header` 有 `padding-right: 366px`（[about.css:632](file:///e:/kemiao-kmoretti/blog/blog/themes/solitude/assets/css/solitude/pages/about.css#L632)）为绝对定位的闪电按钮预留空间。

## 设计

### 1. 配置字段

在 `blog/data/about.yaml` 的 `reward` 节点下新增手机端专用文案：

```yaml
reward:
  enabled: true
  tip: 致谢
  title: 赞赏名单
  description: 感谢每一份支持，让我更有创作的动力。
  empty_text: 暂无赞赏记录，充电入口后续开放
  action_text: 为TA充电            # 桌面端（保持不变）
  mobile_action_text: 为 TA 充电   # 新增：手机端通栏按钮文案
  ...
```

- 模板读取 `mobile_action_text`；未配置时回退为 `action_text`，保证不出现空文案。
- 仅新增字段，不改动 `action_text` 与其余既有字段，桌面端行为不受影响。

### 2. 模板结构（`reward.html`）

在 `sponsor_notice` 块之后、`{{- if .donations -}}` 之前插入手机端按钮：

```html
{{- $mobileText := .mobile_action_text | default .action_text -}}
{{ with $mobileText }}
  <button type="button" class="about-card-button reward-mobile-button" data-reward-open>
    <span class="reward-mobile-icon" aria-hidden="true">ϟ</span><span>{{ . }}</span>
  </button>
{{ end }}
```

- 复用现有 `data-reward-open`，直接接入既有弹窗逻辑（点击打开、关闭按钮/遮罩/Esc 关闭）。
- **不复用 `reward-action-button` 类**：桌面端规则 `#about-page .reward-card .reward-action-button`（`about.css:698`）作用域是整个 `.reward-card`（非仅动画容器），会强制 `width: 157px; min-height: 50px`。同样 `reward-action-icon`（`about.css:719`）在桌面端是 `font-size: 38px` 的超大图标。因此新按钮用独立类 `reward-mobile-button` / `reward-mobile-icon`，只复用 `about-card-button` 基础样式与 `data-reward-open` 属性。
- 图标 `ϟ`（`aria-hidden`）与桌面端保持同一视觉符号，但字号由新类自行控制。

### 3. 样式（`about.css`）

- `.reward-mobile-button` 默认为 `display: none`：桌面端完全不显示、不占位、不影响 `padding-right: 366px` 的布局。
- `@media (max-width: 768px)` 内启用：
  - `display: flex`，`width: 100%` 通栏，`align-items/justify-content: center`，`gap` 与现有按钮一致。
  - 颜色/圆角/阴影沿用 `--efu-theme`、`--efu-radius-sm`、`--efu-theme-op`（与桌面端按钮同一套 token），保持视觉一致。
  - `.reward-mobile-icon` 独立设定图标字号（约 17px），不继承桌面端的 38px。
  - 上/下外边距与卡片内容流协调（声明与名单之间自然呼吸）。
- **类名隔离**：使用全新的 `reward-mobile-button` / `reward-mobile-icon`，与 `reward-action-button` / `reward-action-icon` 无交集，避免命中 `#about-page .reward-card .reward-action-button`（`width:157px`）与 `.reward-action-icon`（`38px`）的桌面端规则。

### 4. 交互

无需改动 `about-reward.ts`：绑定逻辑基于 `document.querySelectorAll("[data-reward-open]")`，新按钮自动纳入；Esc / 点遮罩 / 关闭按钮行为与桌面端一致。

## 边界与取舍

- **两端入口并存但互不干扰**：手机端显示新通栏按钮、隐藏原闪电按钮；桌面端相反。同一时刻只有一种可见。
- **空文案兜底**：`mobile_action_text` 缺省回退 `action_text`。
- **空名单场景**：`empty_text` 分支与按钮并存，按钮位于声明之后，不受名单有无影响。
- **不改 JS、不改桌面端布局**：改动面最小，风险集中在 CSS 作用域隔离。
- **断点对齐**：沿用现有 `768px`，与 `.about-reward-animation` 的隐藏规则同断点，避免出现"两个都显示"或"两个都不显示"的中间态。

## 改动范围（Affected code）

- `blog/data/about.yaml`（新增 `mobile_action_text`）
- `themes/solitude/layouts/_partials/pages/about/reward.html`（插入手机端按钮）
- `themes/solitude/assets/css/solitude/pages/about.css`（按钮样式 + 768px 断点启用）

**不改动**：`about-reward.ts`（无需改）、`entry.ts`、桌面端既有样式与结构、赞助 Issue 工作流。

## Requirements

### Requirement: 手机端充电入口
系统 SHALL 在 ≤768px 视口下，于赞助卡片的「赞助声明」之后、「赞赏名单」之前展示一个通栏充电按钮，文案取自 `mobile_action_text`。

#### Scenario: 手机端显示
- **WHEN** 视口宽度 ≤768px
- **THEN** 通栏充电按钮可见，文案为 `mobile_action_text`
- **AND** 原 `.about-reward-animation` 仍隐藏

#### Scenario: 桌面端不显示
- **WHEN** 视口宽度 >768px
- **THEN** 新按钮不显示、不占位
- **AND** 原闪电按钮、管道动画、人数统计表现与改造前完全一致

### Requirement: 文案回退
系统 SHALL 在 `mobile_action_text` 未配置时回退使用 `action_text`。

#### Scenario: 未配置手机端文案
- **WHEN** `about.yaml` 中无 `mobile_action_text`
- **THEN** 手机端按钮显示 `action_text` 的值

### Requirement: 复用既有弹窗交互
新按钮 SHALL 通过 `data-reward-open` 复用既有打赏弹窗，不新增 JS 逻辑。

#### Scenario: 点击打开弹窗
- **WHEN** 用户点击手机端充电按钮
- **THEN** 打赏二维码弹窗打开
- **AND** 可通过关闭按钮 / 点击遮罩 / Esc 关闭

### Requirement: 主题一致性
新按钮 SHALL 仅使用 `--efu-*` 主题变量，保持明暗主题与现有按钮视觉一致，且不影响桌面端布局与既有样式作用域。
