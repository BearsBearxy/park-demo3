# demo3 组件保真基准 (Component Fidelity Reference)

> **本文件是组件像素保真的唯一事实源；新建/修改组件必须对齐这些值；事实源 = 园区管理系统(单文件离线版).html**
>
> 参考文件：`C:\Users\13282\Desktop\租户管理.txt`（单文件离线原型 HTML + 内联 CSS）
> 核查报告：`sidebar-card-fidelity-report.md`（2026-06-27）

---

## 一、侧边栏面板（Sidebar Panel）

### 1.1 面板容器 `.fp-panel`

| 属性 | 精确值 |
|---|---|
| width | `234px` |
| flex | `0 0 234px` |
| padding | `18px 14px 14px` |
| flex-direction | `column` |
| gap | `14px` |
| overflow-y | `auto` |

### 1.2 面板标题栏 `.fp-panel-hdr`

| 属性 | 精确值 |
|---|---|
| display | `flex` |
| align-items | `center` |
| gap | `9px` |
| padding | `0 6px` |

### 1.3 面板标题文字 `.fp-panel-hdr .nm`

| 属性 | 精确值 |
|---|---|
| font-size | `16px`（= `--fs-h3`；**注意：不是 `--fs-body`(14px)**） |
| font-weight | `var(--fw-semibold)` |
| color | `var(--text-primary)` |
| letter-spacing | `-0.01em` |
| white-space | `nowrap` |

---

## 二、侧边栏导航（Sidebar Nav）

### 2.1 导航外层容器（展开模式）

| 属性 | 精确值 |
|---|---|
| display | `flex` |
| flex-direction | `column` |
| gap（section 之间） | `16px` |

### 2.2 Section / Group 包装 div

| 属性 | 精确值 |
|---|---|
| display | `flex` |
| flex-direction | `column` |
| gap（组内 item 之间） | `2px` |

### 2.3 分组标题标签（Group Title）

| 属性 | 精确值 |
|---|---|
| font | `var(--type-label)` |
| color | `var(--text-muted)` |
| padding | `6px 12px` |

### 2.4 导航项（Nav Item）— 正常态

| 属性 | 精确值 |
|---|---|
| height | `34px` |
| padding（depth=0） | `0px 12px`（左侧 `12 + depth×16` px） |
| border-radius | `var(--radius-sm)` |
| font-size | `var(--fs-body)` |
| font-weight | `var(--fw-medium)` |
| font-family | `var(--font-sans)` |
| color（未激活） | `var(--text-secondary)` |
| background（未激活） | `transparent` |
| gap（图标→标签） | `8px` |
| width | `100%` |

#### 2.4.1 导航项内部结构（关键 — 决定左对齐）

**叶子项（无 `children`）= 图标打头，无任何前导占位。** 子元素顺序：
`[激活时 3px accent bar (absolute, left:0)]` → `[图标 span 16×16]` → `[标签 span flex:1]`。

⚠️ **不要在叶子项图标前渲染"展开箭头占位"**（例如 14px 空 `<span>`）—— 那会把图标+标签整体右推约 22px（14 占位 + 8 gap），看起来"居中"而非左对齐。**只有存在 `children` 的目录项才渲染 chevron**；本系统 FP_NAV 无目录项，故 nav-item 一律图标打头。
自验：图标 `left-offset = 12px`（= padding-left），标签 `left-offset = 36px`（12 + 16 + 8）。
| transition | `background var(--dur-fast) var(--ease-standard)` |

### 2.5 导航项 — 激活态（Active）

| 属性 | 精确值 |
|---|---|
| background | `var(--bg-hover)` |
| color | `var(--text-primary)` |
| 强调条 left | `0px` |
| 强调条 top / bottom | `8px / 8px` |
| 强调条 width | `3px` |
| 强调条 border-radius | `3px` |
| 强调条 background | `var(--text-primary)` |

### 2.6 导航项 — 悬停态（Hover）

| 属性 | 精确值 |
|---|---|
| hover background | `var(--bg-hover)` |
| mouseleave background（未激活） | `transparent` |

### 2.7 导航图标（Icon）

| 属性 | 精确值 |
|---|---|
| svg width × height | `16px × 16px` |
| icon wrapper display | `inline-flex` |
| icon wrapper flex | `0 0 auto` |
| opacity（未激活） | `1`（继承） |
| color（未激活） | `var(--text-secondary)`（继承自按钮） |

---

## 三、页面卡片（Page Cards）

### 3.1 KPI 卡片

| 属性 | 精确值 |
|---|---|
| background（色调） | `var(--accent-slate)` / `var(--accent-sky)` / `var(--accent-blue)` / `var(--accent-cyan)` |
| border-radius | `var(--radius-lg)` |
| padding | `24px` |
| min-width | `0px` |
| display | `flex` |
| flex-direction | `column` |
| gap（内部） | `8px` |
| border | 无 |
| box-shadow | 无 |

### 3.2 KPI 卡片 — 标签（Card Title）

| 属性 | 精确值 |
|---|---|
| font | `var(--type-card-title)` |
| color | `var(--text-primary)` |

### 3.3 KPI 卡片 — 数值（Big Number）⚠️ 存在偏差

| 属性 | 设计精确值 | 当前实现 | 状态 |
|---|---|---|---|
| font-size | `var(--fs-display)` | FitText max:28 min:16（硬编码 px） | **需修复** |
| font-weight | `var(--fw-semibold)` | `var(--fw-semibold)` | 正确 |
| line-height | `1.1` | FitText 未设置 | **需修复** |
| letter-spacing | `var(--ls-tight)` | `var(--ls-tight)` | 正确 |
| font-family | `var(--font-sans)` | `var(--font-sans)` | 正确 |
| color | `var(--text-primary)` | `var(--text-primary)` | 正确 |

### 3.4 KPI 卡片 — Delta 徽标

| 属性 | 精确值 |
|---|---|
| font-size | `var(--fs-label)` |
| font-weight | `var(--fw-medium)` |
| color | `var(--text-primary)` |
| 箭头图标 font-size | `14px` |
| 箭头图标 line-height | `1` |
| gap | `4px` |

### 3.5 KPI 卡片网格（页面级布局）

| 属性 | 精确值 |
|---|---|
| grid-template-columns | `repeat(auto-fit, minmax(204px, 1fr))` |
| gap（卡片之间） | `16px` |

### 3.6 表格 / 列表卡片（Table Card）⚠️ 存在偏差

| 属性 | 设计精确值 | 当前实现 | 状态 |
|---|---|---|---|
| background | `var(--surface-white)` | `var(--surface-white)` | 正确 |
| border-radius | `var(--radius-xl)` | `var(--radius-xl)` | 正确 |
| padding | `0px`（内部表格行自行处理 `14px 4px 0`） | 默认 `24px` | **需修复（调用方传 `:padding="0"`）** |
| box-shadow | `var(--shadow-sm)` | `var(--shadow-sm)` | 正确 |
| border | `1px solid var(--border-subtle)` | 未设置 | **需修复** |
| overflow | `hidden` | 未设置 | **需修复** |

### 3.7 通用内容卡片（Generic Card）⚠️ 部分偏差

| 属性 | 精确值 | 状态 |
|---|---|---|
| border-radius | `var(--radius-xl)` | 正确 |
| border（白色表面卡片） | `1px solid var(--border-subtle)` | **需修复**（同 3.6） |
| padding（非表格卡片默认） | `24px` | 正确 |

---

## 四、待修复汇总（FIX-NEEDED）

| # | 组件 | 属性 | 设计值 | 修复方法 |
|---|---|---|---|---|
| 1 | `KpiCard.vue` 数值 | font-size | `var(--fs-display)` | 移除 FitText，直接用 CSS token |
| 2 | `KpiCard.vue` 数值 | line-height | `1.1` | 在数值 span 上添加 `line-height: 1.1` |
| 3 | `Card.vue`（surface=white） | border | `1px solid var(--border-subtle)` | 在 `sectionStyle` 中添加 border |
| 4 | `Card.vue`（surface=white） | overflow | `hidden` | 在 `sectionStyle` 中添加 `overflow: hidden` |
| 5 | 表格卡片调用方 | padding | `0px` | 调用时显式传 `:padding="0"` |

> ✅ 上述 5 项 + KpiCard line-height 已全部修复（P0-B/P0-D，运行期实测达标）。本表保留作历史记录；§3.3/3.6/3.7 的 ⚠️ 标记同为历史。

---

## 五、分页器（Pager）放置与窗口化

### 5.1 放置：固定卡片底部（不跟列表尾）

分页器（`FPPager` = 选择页面 JumpSelect popover + `Pagination` 页码药丸）**固定在内容卡片的底部**，不随列表内容流动。**列表行数不足以铺满一页时，分页器仍停在卡片底部，不得浮在页面中间。**

实现：屏幕根容器加 `min-height:100%`（撑满 `<main>` 内容区）+ 在列表卡片与分页器之间插一个 `flex:1 1 auto; min-height:0` 的撑高占位 `div`，把分页器顶到底部。`BuildingsView` / `TenantsView` 均按此；**新建列表屏沿用此模式**。

### 5.2 页码窗口化（显示上限 maxPills）

`Pagination` 的页码药丸**有显示上限 `maxPills`（默认 7）**：页数 ≤ 7 全显；> 7 时窗口化为 `首页 … (当前±1) … 末页`，用 `…`（`--text-disabled`，不可点）代替隐藏的中间页，**不在底部把所有页码全部列出**。跳到任意页仍可经 JumpSelect popover（可滚动列出全部页）或 上/下页 按钮。
- 算法：`[1]` + `(left>2 ? '…')` + `[max(2,cur-1) .. min(count-1,cur+1)]` + `(right<count-1 ? '…')` + `[count]`。
- 测试：`Pagination.spec.ts` windowing 用例（20 页/当前 10 → `1 … 9 10 11 … 20`；首端 → `1 2 3 … 20`；≤7 页无省略）。

---

## 六、加载态与首屏防闪烁（Loading & Anti-Flash）

> 来源：`fix 87e5503`（用户反馈每次切页 / 登录前先闪一下空白）。根因都是「状态未就绪就渲染」。**新建屏一律遵循本节。**

### 6.1 首屏不得先闪主壳（auth gate）

| 规则 | 说明 |
|---|---|
| 挂载时机 | `main.ts` 必须 `router.isReady().then(() => app.mount('#app'))`，**不得**裸 `app.mount()` |
| 原因 | 裸挂载时首帧落在未解析的起始路由 `/`，`App.vue` 按 `route.path === '/login'` 判断会误判为「非登录」→ 先渲染 `AppShell` 主壳，异步守卫随后才重定向到 `/login`，产生「闪主页 → 回登录」 |
| 禁止 | mount 前同步依赖「当前路由」做 login/shell 之类的布局分支判断（此时路由未解析） |

### 6.2 数据屏不得先闪假空态（loading gate）

凡 `onMounted` 里异步取数的列表 / 数据屏，**取数完成前不得渲染依赖数据的「空态 / 零值」内容**——`共 0 份`、`没有匹配`、空 KPI、`全部 0 / 草稿 0` 之类的 0 计数 tab 都会被读成「已加载但无数据」，造成卡顿错觉。

| 规则 | 实现 |
|---|---|
| 包裹数据体 | 把 KPI / tabs / 工具栏 / 表格 / 空态 / 分页器整块用 `<template v-if="<loaded 信号>">…</template>` 包住 |
| 未就绪占位 | `v-else` 渲染 `<div class="page-loading"><span class="page-spin" /></div>`（居中转圈，样式在 `base.css`，全局可用） |
| loaded 信号 | 列表屏复用与列表同批到达的 `summary`（非空即已加载，省一个 ref）；无 summary 的屏（如 ledger ⓪ 选公司）用独立 `xxxLoaded` ref |
| 标题/工具栏计数 | 未就绪显占位「…」：`共 {{ summary ? list.length : '…' }} 份` |
| 多级屏 | 每级各自 gated（`v-else-if="该级数据 && …"`），级间过渡加 `v-else` 兜底转圈，避免切换瞬间空白（参照 `LedgerView.vue` 的 ⓪/①/② + 末尾 `v-else`） |

参照实现：`BuildingsView` / `TenantsView` / `ContractsView` / `LedgerView`；占位样式 `.page-loading` / `.page-spin`（`styles/base.css`）。

### 6.3 已知局限（性能，非本节约束）

本节只保证「**不闪假空态 / 不闪主壳**」，不解决「切页非无缝」——当前仍是 CSR + `onMounted` 取数的瀑布（先渲转圈 → 取数 → 渲内容；localhost 快到近乎无感，网络慢时可见转圈）。无缝化手段（路由级预取 loader、SWR 缓存、hover 预取、骨架屏、keep-alive、后端 gzip/ETag 等）属性能优化范畴，另行评估，不在保真规范内。
