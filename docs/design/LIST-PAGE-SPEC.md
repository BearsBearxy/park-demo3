# 列表页布局规范（LIST-PAGE-SPEC）

适用范围：主数据类列表屏——楼栋管理、租户管理、合同管理，以及后续所有「工具栏 + 表格卡片 + 分页」形态的 list 页。
基准样式：租户管理屏（2026-07 截图定稿）。三屏必须逐条一致，禁止各屏自带变体。

## 1. 页面骨架（自上而下）

```
标题行        h2 + 副标题 ·· 右侧操作按钮组（导入/新增，Button size=sm）
.mx-body      grid: 224px KPI 左栏(sticky) + minmax(0,1fr) 主列，gap 28px
  .mx-kpirail   KPI 卡竖排 gap 16px
  .mx-main      flex column gap 16px：
    .mx-toolbar   工具栏（单行，见 §2）
    .mx-listcard  列表卡片（见 §3）—— 分页器在卡片内部底部，不悬浮页面底部
```

首载 gate：summary 未返回前整块渲染 `.page-loading` spinner，不闪空 KPI/「共0条」。

## 2. 工具栏 .mx-toolbar（单行，与租户管理一致）

- 结构：`display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap`
  - **左**：segment tab 组 —— 统一用 `FPPhaseTabs`（支持 `tabs` prop 自定义标签集，带计数徽标）。禁止复制其样式另建 tab 组件。
  - **右** `.mx-toolbar-right`（`display:flex; align-items:center; gap:10px`），顺序固定：
    1. （可选）`Segmented` 布局切换（仅楼栋卡片墙/台账列表）
    2. 搜索框 `.mx-search`：固定宽 230px，`radius-full`，左内嵌 16px 放大镜图标，高 36px
    3. 状态 `Select`：宽 130px，size=sm
- 期间 `Select` 定宽：**年 110px / 月 92px**（size=sm）。触发器是 `width:100%` + 单行省略号，宽度全靠外层定宽 div，
  给窄了就把「2024年」截成「202…」。下限算式：4 数字×0.6em + 「年」1em ≈ 50px 文本 + gap 8 + 箭头 16 + 左右 padding 24 + 边框 2 ≈ 100px。
  定宽而非 `fit-content` 是为了切月份时工具栏不抖（「1月」↔「12月」宽度不同）。
- 工具栏内**不放**「共 N 条/栋/份」文本——总数只出现在分页器（FPPager `total`）。

## 3. 列表卡片 .mx-listcard

- `Card surface=white :padding=0`，外观：`border:1px solid var(--border-subtle); overflow:hidden`。
- 高度由**布局链**决定（不由内容撑，也不做 100vh 视口数学——壳层 main.fp-content 自带 topbar+padding，视口常量必错）：
  页面根 `height:100%` → `.mx-body{flex:1;min-height:0}` → `.mx-main{min-height:0}` → `.mx-listcard{flex:1 1 auto;display:flex;flex-direction:column}`。
- `min-height:440px` = fitRows 下限 6 行(6×56) + 表头~30 + wrap padding 14 + 分页条~53：短窗时退化为外层滚动，**绝不裁行**。
- 校准标准：常规窗口高度下页面（含壳层 main）**不得出现任何滚动条**。
- 内部两段：
  - `.mx-tablewrap`：`flex:1 1 auto; overflow:hidden; padding:14px 4px 0` —— **禁止出现滚动条**，每页行数由 useFitRows 保证恰好放满（§6）。
  - `.mx-pagerbar`：`flex:0 0 auto; border-top:1px solid var(--divider); padding:10px 14px`，内放 FPPager。
- 过滤后 0 行：卡片内居中空态文案（padding 40px，text-disabled）。

## 4. 表格行（等高铁律）

- 行高统一固定：`--mx-row-h: 56px`。tr 定高与 td 样式由 `FPSortableTable` 组件内联承载（`height:var(--mx-row-h,56px)`），对**所有**使用方统一生效（含导入中心等非分页表）。
- `td`：`padding: 0 16px; vertical-align: middle`（垂直留白由行高提供，不用上下 padding）。
- **所有行必须等高**。内容不得撑高行：单元格内容一律 `white-space:nowrap` + `overflow:hidden` + `text-overflow:ellipsis`，长文本用 `title` 出全文；两行式单元格（名称+副行）总高必须 ≤ 行高。
- 行分隔：1px `var(--divider)` 底边；hover 背景 `var(--bg-panel)`。
- **列宽铁律（2026-08-04 升级为全站一切表格适用，不限本规范的"列表页"范围）**：每列显式定宽，至多一列弹性（吸收余宽，紧邻定宽列排布、不留无用空隙）；列位置不得因单元格内容长短、翻页或**滚动**而变化（内容超长走 ellipsis，不许撑列）。需要严格锁列时表格用 `table-layout: fixed`。**虚拟滚动/窗口化表格必须 `table-layout: fixed` + `<colgroup>` 全列定宽**——窗口化每帧更换渲染行，auto 布局会按可见内容逐帧重算列宽，快速滚动时列位置抖动（2026-08-04 抄表工作台实案：它按"工作台"立项未套本规范而漏网，教训=任何 `<table>` 一律受此条约束，与屏的形态命名无关）。
- 表头：`position:sticky; top:0`（卡片内固定，配合无滚动实际不滚，仅作兜底）。

## 5. 分页器 FPPager（停靠卡片底部）

- 位置：`.mx-pagerbar` 内，永远贴卡片底边；跳页 popover 向上展开，随分页器停靠。
- 左侧：跳页触发按钮「第 X / Y 页 ˄」+「共 N 条」。
  - 触发按钮 `min-width:116px; width:auto`——**文本任何页数下不得溢出按钮边框**（如"第 26 / 26 页"）。
- 右侧：`Pagination` 窗口化页码 pills：≤7 个（首尾 + 当前±1 + … 省略号），32px 圆 pill，‹ › 步进；当前页 `bg-sunken` + semibold。
- 楼栋卡片墙布局：无列表卡片，分页器保持既有「spacer 置底」方式停靠页面底部。
- **停靠机制**（2026-09-13 自 `DESIGN-FIDELITY` §5.1 并入）：屏幕根容器 `min-height:100%` 撑满 `<main>` 内容区，
  列表卡片与分页器之间插一个 `flex:1 1 auto; min-height:0` 的撑高占位 `div` 把分页器顶到底。
  **行数不足一页时分页器仍停卡底，不得浮在页面中间。** 参照 `BuildingsView` / `TenantsView`，新建列表屏沿用。
- **窗口化算法**（2026-09-13 自 `DESIGN-FIDELITY` §5.2 并入）：`Pagination` 的上限是 prop `maxPills`（默认 7）。
  算法 `[1]` + `(left>2 ? '…')` + `[max(2,cur-1) .. min(count-1,cur+1)]` + `(right<count-1 ? '…')` + `[count]`；
  `…` 用 `--text-disabled` 且不可点。跳任意页仍走 JumpSelect popover（可滚动列出全部页）或 ‹ › 步进。
  门禁：`Pagination.spec.ts` windowing 三例（20 页/当前 10 → `1 … 9 10 11 … 20`；首端 → `1 2 3 … 20`；≤7 页无省略）。

## 6. 每页行数 useFitRows（防抖动铁律）

- **行高是常量输入**（`--mx-row-h`），**严禁测量已渲染行的实际高度**——pageSize 不得依赖页面内容，否则形成「pageSize→内容→尺寸→pageSize」反馈回路（即 2026-07-15 修复的第 23 页抽搐闪烁 bug）。
- 仅当容器**布局**尺寸变化（改窗口高、首次挂载）时重算：`pageSize = clamp(floor((wrap.clientHeight - padding - theadH) / rowH), 6, 30)`。容器高度必须是布局驱动（§3 卡片定高 + flex），与行数无关。
- 重算触发三通道：ResizeObserver(wrap) + ResizeObserver(documentElement) + `window resize` 事件监听（RO 对 html 盒尺寸不敏感的环境兜底）。
- 楼栋卡片墙每页固定 8，不适用本条。

## 7. 禁止事项清单

- ❌ 底部把所有页码全部列出（页数 > `maxPills` 必须窗口化 + `…`，见 §5；2026-09-13 自 `DESIGN-FIDELITY` §5.2 并入）
- ❌ 表格卡片内出现垂直滚动条（每页行数必须自适应放满）
- ❌ 行高随内容波动（这一条宽一点下一条窄一点）
- ❌ 工具栏两行式布局 / 工具栏内放总数文本
- ❌ 复制 tab/pager 样式另建组件
- ❌ pageSize 依赖渲染内容的任何测量
- ❌ 分页器脱离卡片悬浮在页面中部或底部（卡片墙除外）
- ❌ 任何交互（滚动/翻页/筛选/hover/编辑态切换）引发布局位移或闪烁——列宽、行高、sticky 偏移在交互期间必须零变化（审核清单项，全站表格适用）

## 8. 渲染开销铁律（2026-08-11 审计新增，全站表格适用）

> 根因：宽表在**编辑态**每敲一个字符就整表重渲染。此时模板里每个「返回新对象/新数组的函数调用」都会被乘以 `行数 × 列数`。

- ❌ **模板里禁止调用返回新对象的函数**（`:style="cellStyle(c)"` 这类）。返回值每次都是新引用 → Vue patcher 认为样式全变 → 全表元素重刷样式。
  - 只依赖**列**不依赖行的样式，必须做成按列缓存的 `computed`：`cellStyles[c.key]`（引用稳定，patcher 直接跳过 diff）。
  - 实案：`FPLedgerTable` 27 列 × 130 行，`cellStyle()` 每次渲染分配约 **5,300 个对象**；改按列 computed 后 **27 个**。影响 5 屏。
- ❌ **模板里禁止调用做全表聚合的普通函数**（`{{ sum(c.key) }}`、`{{ rowTotal(row) }}`、`{{ colTotal(id) }}`）。写在 `tfoot` 里就是「每列扫一遍全表」。
  - 合计一律做成**一次遍历产出全部列**的 `computed`，行合计与总计共用同一次遍历。
  - 实案：`FPLedgerTable` tfoot 约 3,500 次 reduce/渲染；`S10Table` 200 行时约 15,000 次乘加/渲染。
- ❌ **模板里禁止对数组做线性查找**（`cfgs.find(x => x.id === row.id)`）。预先 `computed` 成 `Map` 再按键取。
- ❌ **比较器/热路径里禁止 `new RegExp(...)`**。正则提到模块级常量（`useMeterWorkbench.floorRank` 实案：排序每次比较都在造正则）。
- ❌ **分组/排序结果若不依赖编辑草稿，禁止和草稿放同一个 computed**。拆成两个：`groups`（只依赖 `props.rows`）+ `usage`（依赖 draft），否则每敲一键全量重分组 + 逐组重排序。
- ✅ **行数可能上千的表必须窗口化**。`composables/useMeterWorkbench.ts` 的 `buildWindow()` 是现成实现（rAF 节流 + 窗口位移 <4 行不 setState + spacer 撑高），配 `table-layout:fixed` + `<colgroup>` 使用，**不要另写一套**。
