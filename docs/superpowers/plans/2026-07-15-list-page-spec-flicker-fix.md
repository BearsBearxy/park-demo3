# 2026-07-15 列表页规范落地 + 深页码抽搐闪烁修复

## 背景与根因

**Bug**：楼栋/租户/合同列表翻到深页码（如租户第 23/26 页）时整页抽搐闪烁、按钮无响应。

**根因**（已读码确认）：`useFitRows.ts` 的 ResizeObserver 观察表格容器自身，且 `measure()` 读取**当前页第一行**的实测高度算 pageSize。深页码下 pageSize 变化 → 该页起始行变化 → 新首行实测高度有亚像素差异 → `floor()` 翻转 → pageSize 在两值间震荡 → 无限重渲染回路（主线程饱和 → 按钮无响应）。第 1 页首行不随 pageSize 变，故浅页码不触发。

**修复原则**：pageSize 的所有输入改为布局常量（固定行高 + 卡片定高），与渲染内容零耦合，回路在架构上不可能发生。同时满足规范「行高相等」「无滚动条」两条铁律。

## 规范

见 `docs/design/LIST-PAGE-SPEC.md`（本次新增，三屏逐条对齐）。

## 任务分解

### T1 核心层（先行，单人）
1. 新建 `frontend/src/styles/mx-list.css`：`.mx-body/.mx-kpirail/.mx-main/.mx-toolbar/.mx-toolbar-right/.mx-search/.mx-listcard/.mx-tablewrap/.mx-pagerbar` + `:root{--mx-row-h:56px; --mx-list-offset:170px}`（offset 待浏览器校准）+ 行高等高规则（tbody tr 定高、td padding 0 16px、vertical-align middle）+ thead 吸顶 + ≤1100px 响应式（从三 view 的重复 scoped 块收编为单一事实源）。`main.ts` 引入。
2. 重写 `useFitRows.ts`：签名 `useFitRows(wrap, rowH = 56, fallback = 10)`；测 `wrap.clientHeight`（布局驱动）− padding − thead 实高（常量，兜底 36），除以常量 rowH；RO 观察 wrap + documentElement；**删除对 tbody tr 的测量**。`fitRows` 纯函数签名与钳位 [6,30] 不变，`useFitRows.spec.ts` 相应更新。
3. `FPPager.vue`：`.fp-jump-wrap` 改 `width:auto; min-width:116px`，修「第 26 / 26 页」文本溢出按钮。
4. `FPPhaseTabs.vue`：新增可选 `tabs` prop（`{k,label}[]`，默认原 TABS）——向后兼容（FPTenantPicker/楼栋/租户不传照旧）。

验收：`npm run typecheck` 过；`npx vitest run src/components/fp/useFitRows.spec.ts` 绿。

### T2/T3/T4 三视图（并行，各自只改一个 view 文件 + contracts 删一子组件）
共同动作：删除各自 scoped 里重复的 `.mx-*` 样式块（收编进 mx-list.css）；表格卡片改 `.mx-listcard` 结构（卡片定高 flex column，FPPager 移入 `.mx-pagerbar`，删除「spacer 置底」div）；工具栏改 §2 单行结构（搜索框 230px class 化、Select 130px、删「共 N 条」文本）；useFitRows 新签名。

- **T2 租户** `TenantsView.vue`：基准屏，结构性改动最小；Card 补 `border+overflow`（对齐合同屏）。
- **T3 合同** `ContractsView.vue`：生命周期 tabs 与搜索并成一行（tabs 左、搜索+Select 右）；改用 `FPPhaseTabs :tabs="LIFECYCLE"`，**删除** `ContractLifecycleTabs.vue`（样式复制品，唯一使用方是本屏）。
- **T4 楼栋** `BuildingsView.vue`：tabs 行与工具栏行合并为单行（tabs 左；Segmented+搜索+Select 右）；台账列表布局接入 useFitRows（`pageSize = layout==='卡片墙' ? 8 : fit`）；卡片墙分页器维持既有置底方式。

验收：每屏结构与 LIST-PAGE-SPEC §1–§5 逐条对照。

### T5 全量校验（T2-T4 之后）
`npm run typecheck`（禁裸跑 vue-tsc）+ `npm test` 全量。任何红即修。

### T6 浏览器验收（主会话执行）
dev server + 真实数据：① 租户第 23/26 页停留 10s 无闪烁、按钮可点；② 三屏工具栏逐像素同构；③ 表格卡片无滚动条、行高相等；④ 分页器贴卡底、跳页按钮文本不溢出；⑤ 改窗口高 pageSize 重算无抖动；⑥ 无页面级滚动条（校准 --mx-list-offset）。

## 风险与对策
- 56px 行高是否容得下最高单元格（租户两行名称单元格≈34px 内容）→ T6 目测，不够只调 `--mx-row-h` 一处。
- `--mx-list-offset` 取值 → T6 校准。
- 卡片定高后短窗口（<700px）行数被钳到 6 行，卡片可能内溢 → min-height 360px 兜底，接受。
