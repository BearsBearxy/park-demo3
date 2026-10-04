# 页面行为规范（PAGE-BEHAVIOR-SPEC）v1

> 立档 2026-09-13。来源：拆分并删除 `DESIGN-FIDELITY.md`。
>
> 那份文件同时装着两样不相干的东西。**前半**（侧边栏面板/导航像素表、KPI 与卡片像素表、
> 待修汇总）是组件级像素基准，用户 2026-09-13 拍板删除，交给 **Factory Park Design System**。
>
> 那个设计系统以 skill 形态存在，名字 `factory-park-design`。**真身只有一份**，
> 在 `C:/financial_dashboard/.claude/skills/factory-park-design/`（132 个文件）；
> `~/.claude/skills/factory-park-design` 是指向它的软链，所以全局与各 worktree 都读得到同一份。
> **按 skill 名引用，不要写绝对路径**，也不要把它拷成第二份。
> 早先那份 `Factory Park Design System.zip` 是旧快照，已于 2026-09-13 随 handoff 清理一并删除。
>
> ⚠ 「已由设计系统取代」这句话**只对一部分成立**：§二 导航像素在 `components/navigation/SidebarNav.jsx` 里有对应，
> §一 面板像素、§3.5~§3.7 卡片像素在包里**没有对应或给的是另一个数**。这些差异记在下面 §4，不要当作已交接。
>
> 原文声明的两个像素事实源都已不在：参考文件 `租户管理.txt` 早已丢失；
> `园区管理系统(单文件离线版).html` 经用户判定为废案，随 `design_handoff_analysis_shell/` 于 2026-09-13 删除。
> React 原型仍在 `C:/financial_dashboard/_handoff_extracted/`（不在本仓、不进 git）。
>
> **所以本文件 §4 是那批像素里几条仍然管用的规则的唯一文字出处** —— 它们今天只以代码既成事实存在。
> 五条在删除前逐条实测过两边（见 §4 的 A/B/C 分类），动它们之前没有别的地方可以复核。
> **后半**这三组是**页面行为**规则：设计系统只管「一个组件长什么样」，不管「一屏怎么加载、
> 覆盖层怎么摆、层级怎么排」。改指后全仓 85 行引用 / 43 个文件（frontend 注释 74、docs 7、其余在 `_design/`），
> 故独立成册。
>
> **事实源：本文件。** 三组正文与原文逐字一致，改动只有两处：全部节号重编（见下表），
> 以及 §2 标题里的「原型」写明为「handoff 原型」（指 `_handoff_extracted` 里的 `screen-*.jsx`，
> 不是设计系统）。

## 旧引用对照（`DESIGN-FIDELITY.md` → 本文件）

| 旧 | 新 |
|---|---|
| §6 / §六（加载门） | §1 |
| §6.1 / §6.2 / §6.3 / §6.4 / §6.5 | §1.1 / §1.2 / §1.3 / §1.4 / §1.5 |
| §7 / §七（居中弹卡） | §2 |
| §7.1 / §7.2 | §2.1 / §2.2 |
| §8 / §八（z-index 七级） | §3 |
| §八 的「### 规则」小节 | §3.1 |

已删除、不再有落点的节：§一～§三（像素表，见设计系统）、§四（待修汇总，5 条已全部修复）、
§五（分页器，已并入 `LIST-PAGE-SPEC` §5）。

`docs/superpowers/plans/` 与 `docs/research/` 下的文档**刻意不改**：它们是已执行工作的历史记录，
改写会让记录失真。那些文档里的 `DESIGN-FIDELITY §6/§7/§八` 按上表换算即可。

## 与邻规范的分工（不重复，冲突时以被指向的那份为准）

| 话题 | 归谁 |
|---|---|
| 交互引起的布局位移、加载呈现三档（换期/首进/局部）、`.fp-shim` / `FPLoadBar` / `useDeferredFlag` 标准件 | `LAYOUT-STABILITY-SPEC` §1 / §7。**与本文件 §1.2 重叠且 §7 更新**：版式已知用骨架不用转圈，以 §7 为准 |
| 分页器停靠、页码窗口化、`useFitRows` 防抖动 | `LIST-PAGE-SPEC` §5 / §6 |
| 浮层点外面就关、Esc 只关自己；浏览器自带 `confirm()` / `alert()` 换成软件内确认弹窗与结果回执（2026-09-30 补） | `UI-OVERLAY-SPEC`（后者在其 §7） |
| 「本次更新」弹卡、更新记录、版本号与更新公告 | `VERSION-UPDATE-SPEC` / `RELEASE-NOTES-SPEC`。新版本提示和没看过的更新记录怎么进铃铛，见本文件 §5（2026-09-30 补） |
| 组件像素、色板、字阶、间距、圆角 | Factory Park Design System |
| 响应式四档下的覆盖层与层级修订 | `RESPONSIVE-LAYOUT-SPEC` §3 / §4.4 |

本文件与 `LAYOUT-STABILITY-SPEC` 的边界：**后者管「位移」，本文件管「该不该先渲染」。**
§1.4 留在本文件是因为它讲的是「加载完不得撑开容器」的具体落点（抽屉定高、KPI 容器不被门挡、
图表容器显式高度），与 `LAYOUT-STABILITY-SPEC` §1 铁律是同一条规则的两个层级。

---

## 1. 加载态与首屏防闪烁（Loading & Anti-Flash）

> 来源：`fix 87e5503`（用户反馈每次切页 / 登录前先闪一下空白）。根因都是「状态未就绪就渲染」。**新建屏一律遵循本节。**

### 1.1 首屏不得先闪主壳（auth gate）

| 规则 | 说明 |
|---|---|
| 挂载时机 | `main.ts` 必须 `router.isReady().then(() => app.mount('#app'))`，**不得**裸 `app.mount()` |
| 原因 | 裸挂载时首帧落在未解析的起始路由 `/`，`App.vue` 按 `route.path === '/login'` 判断会误判为「非登录」→ 先渲染 `AppShell` 主壳，异步守卫随后才重定向到 `/login`，产生「闪主页 → 回登录」 |
| 禁止 | mount 前同步依赖「当前路由」做 login/shell 之类的布局分支判断（此时路由未解析） |

### 1.2 数据屏不得先闪假空态（loading gate）

> ⚠ **本节的「怎么占位」部分已被 `LAYOUT-STABILITY-SPEC` §7 取代（2026-08-28）。**
> 仍然成立的是**目的**：取数完成前不得渲染依赖数据的空态 / 零值。
> 不再成立的是**手段**：版式已知的屏（判据 `useFitRows` —— 三个输入全是布局常量，数据到达前就算得出该画几行）
> **必须用骨架，不许用居中转圈**，门禁 `frontend/src/views/__tests__/exactPlaceholder.spec.ts`（5 条断言，绿）。
> 下表的 `.page-loading` 只适用于**版式真的未知**的地方（如图表容器）。照下表给列表屏加转圈会当场撞门禁。
>
> 另：KPI 容器**不进**加载门 —— 整条被 `v-if` 挡掉会在插入时把下方内容整体下推，见 §1.4。
> 「兜底 `v-else` 紧邻状态链」那条铁律不受影响，仍然有效。

凡 `onMounted` 里异步取数的列表 / 数据屏，**取数完成前不得渲染依赖数据的「空态 / 零值」内容**——`共 0 份`、`没有匹配`、空 KPI、`全部 0 / 草稿 0` 之类的 0 计数 tab 都会被读成「已加载但无数据」，造成卡顿错觉。

| 规则 | 实现 |
|---|---|
| 包裹数据体 | 把 tabs / 工具栏 / 表格 / 空态 / 分页器整块用 `<template v-if="<loaded 信号>">…</template>` 包住。**KPI 除外**（§1.4：容器常驻，只把瓦片内的数值显 `—`） |
| 未就绪占位 | `v-else` 渲染 `<div class="page-loading"><span class="page-spin" /></div>`（居中转圈，样式在 `base.css`，全局可用） |
| loaded 信号 | 列表屏复用与列表同批到达的 `summary`（非空即已加载，省一个 ref）；无 summary 的屏（如 ledger ⓪ 选公司）用独立 `xxxLoaded` ref |
| 标题/工具栏计数 | 未就绪显占位「…」：`共 {{ summary ? list.length : '…' }} 份` |
| 多级屏 | 每级各自 gated（`v-else-if="该级数据 && …"`），级间过渡加 `v-else` 兜底转圈，避免切换瞬间空白（参照 `LedgerView.vue` 的 ⓪/①/② + 末尾 `v-else`） |

参照实现（2026-09-13 实测）：只有 `LedgerView` 还是本节这个写法（3 处 `.page-loading`，多级屏 ⓪/①/② 需要级间兜底）。
`BuildingsView` / `TenantsView` / `ContractsView` 已按 `LAYOUT-STABILITY-SPEC` §7 改成骨架，`.page-loading` 命中 0 —— 
**它们不再是本节的范例，是 §7 的范例。** 占位样式 `.page-loading` / `.page-spin` 在 `styles/base.css`，仍为版式未知处保留。

> **⚠️ 铁律：兜底 `v-else` 必须紧邻状态链，不可被带自身 `v-if` 的兄弟节点隔开。**
> Vue 的 `v-else` / `v-else-if` 只绑「上一个相邻」的 `v-if` 兄弟。若把 `<ImportResultToast v-if="importResult">`（或任何自带 `v-if` 的 overlay）插在 ⓪/①/② 状态链和末尾 `<div v-else class="page-loading">` **之间**，兜底 `v-else` 会改绑到那个 overlay 的 `v-if` 上——`importResult` 恒为 null → **兜底转圈永久显示**（曾致「月度台账一直转圈」，2026-07-02 修复）。**overlay / toast 一律放在兜底 `v-else` 之后**，作为独立的尾部 `v-if` 节点。正确顺序：`…② v-else-if` → `<div v-else class="page-loading">` → `<ImportResultToast v-if="…">`。

### 1.3 已知局限（性能，非本节约束）

本节只保证「**不闪假空态 / 不闪主壳**」，不解决「切页非无缝」——当前仍是 CSR + `onMounted` 取数的瀑布（先渲转圈 → 取数 → 渲内容；localhost 快到近乎无感，网络慢时可见转圈）。无缝化手段（路由级预取 loader、SWR 缓存、hover 预取、骨架屏、keep-alive、后端 gzip/ETag 等）属性能优化范畴，另行评估，不在保真规范内。

> 2026-08-11 更新：其中「路由切换零反馈」已由 §1.5 收编为硬约束（不再算"另行评估"）；预取/SWR 仍不在本规范内。

### 1.4 加载完成不得撑开容器（Layout Stability）

> 来源：2026-08-11 全面审计，用户原话「点一个卡片，还没加载出来的时候是缩放状态，过一下子加载完了把卡片或者页面撑开了的变形」。
> §1.2 保证了"不闪假空态"，但没保证"容器尺寸稳定"——占位和正文高度不等时，数据到达就是一次可见的撑开。

**铁律：容器的尺寸必须在打开/挂载那一刻就是终态，不得由后到的内容决定。**

| 场景 | 规则 | 反例（已修） |
|---|---|---|
| **抽屉 / 弹窗** | 凡「先打开、再 `await` 取详情」的覆盖层，一律传 `:fixed-height="true"`（`FPDrawer` 已内置 `.fp-dwr--fixed{height:min(85vh,760px)}`）。内容后到只在 `.fp-dwr-body` 内部滚动，外框零位移。**只有"内容一次性同步给全、不再异步补"的小弹窗**才允许内容定高。 | `BuildingsView` 打开楼栋抽屉：先渲 6 个 FPStat（约 260px）+ 入场 `scale(.985)` 动画，`buildingApi.detail` 回来后 18 层单元图（800px+）插入，抽屉从 260px 弹到 760px |
| **抽屉内的高块** | 抽屉里最高的那块内容若用 `v-if="detail"` 挡住，必须给等量级 `v-else` 骨架占位（`min-height` 取真实内容量级），不得让它高度归零 | `BuildingDrawer` 楼层单元图块 |
| **KPI 条 / 统计条** | KPI 容器**不得**被 loaded 门整条挡掉。门只挡瓦片内的数值（显 `—`），容器本身连同 `min-height` 常驻——否则它插入时会把下方全部内容整体下推 | `AnaShell` 的 `v-if="loaded && $slots.kpis"`，瓦片 68px + padding 12px = **下推 80px**，19 个分析屏里 16 屏中招 |
| **图表容器** | `<div>` 必须有显式高度（`AnaEChart` 的 `:style="{height: height+'px'}"` 是正确范例），不得靠内容撑——高度为 0 时 `echarts.init` 拿不到尺寸，数据到达再撑开是双重抖动 | ✅ 现状已正确，勿改 |
| **表格列宽** | 见 LIST-PAGE-SPEC §4「列宽铁律」——窗口化表格必须 `table-layout:fixed` + `<colgroup>` | ✅ `MeterLedgerGrid` 已正确 |
| **Web 字体** | 禁止远程 webfont（见 §1.5）。字体换入会改变 mono 金额列与 KPI 数字的字宽，触发整页二次重排 | `tokens.css` 曾 `@import` Google Fonts |

`.page-loading` 本身是合规的（`flex:1 1 auto; min-height:240px`，配合 `AppShell` 的 `scrollbar-gutter: stable both-edges` 无横向抖动），**前提是它的父容器已由布局链定高**（参照 `.anx-body{flex:1;min-height:0}`）。放进一个高度 auto 的块级父容器就会退化成 240px 再撑开——新屏套加载门时必须确认父链定高。

### 1.5 点击必须立刻有反馈（Navigation Feedback）

> 来源：同上审计，用户原话「点击一个页面、按钮或 Tab 的时候会出现点了有几秒卡顿」。
> 根因不是慢，是**没反馈**：45 屏全部 `() => import()`，vue-router 要 `await` 完 chunk 才 confirm 导航，而页签高亮读的是 `route.meta`——confirm 前面包屑不动、药丸不动、内容区还是上一页、连转圈都没有。

| 规则 | 实现 |
|---|---|
| 路由切换必须有全局反馈 | `router.beforeEach` 置 `ui.navigating = true`、`afterEach`/`onError` 置 false；`AppShell` 主卡顶部渲染 2px 进度条。**这是导航期间唯一的反馈，不可省** |
| 空闲期预取 | `requestIdleCallback` 里预拉全部路由 chunk，让第二次点击起零等待 |
| 禁止远程 webfont | CSS `@import` 远程字体是渲染阻塞样式表里的**串行子请求**（下 index.css → 解析 → 发 googleapis → 发 gstatic，三跳）。境内访问境外字体 CDN 常是连接挂起而非立即 RST，首屏白屏等 TCP 超时。字体一律自托管或用系统栈 |
| 重型第三方库按需引入 | ECharts 一类必须 `echarts/core` + 显式 `use([...])`，禁止 `import('echarts')` 引包根（全量 1.13MB，实际只用 7 种 series）。**新增图表类型时同步在 `AnaEChart.vue` 的 `use([...])` 里注册**，忘了会运行时报「Series bar is used but not imported」 |
| 主线程长任务必须让出 | 循环里做同步重活（`XLSX.write` 批量导出、大数组序列化）时，每轮之间 `await new Promise(r => setTimeout(r))` 让出**宏任务**。只 `await` 一个已 resolve 的 Promise 是微任务，**不让出渲染帧**，界面会僵死到循环结束（`billExcel` 批量导出 136 户实案） |

---


## 2. 弹窗 / 覆盖层（Modal / Overlay）— 居中卡，**取代 handoff 原型的右侧抽屉**

**用户决策（2026-07-02）**：所有原「从右侧滑出的抽屉」一律改为**屏幕居中弹窗**，视觉基准 = 命令面板 `CommandPalette`（Ctrl-K 弹卡）。**此为对设计原型（`screen-*.jsx` 右抽屉）的有意偏离，以本规范为准。**

> **2026-09-30 改（已实现（2026-10-01，jfen/hint-impl），画布 06-C）**：之后又长出来的 7 处右侧抽屉（`FPSideDrawer`，440 宽带遮罩：
> 公共电核算、楼栋损耗、催缴单、计费参数、月度台账、附表10 的问题清单，和顶栏通知）**不改成居中卡**。
> 问题清单换成**贴着入口弹出的问题面板**（方案 A：420 宽，页面不变暗；分组、一句「这是什么、不处理会怎样」、
> 可点的明细、处理按钮都保留；问题多于 20 条时在面板里滚动；完整规则在 `LAYOUT-STABILITY-SPEC` §6）；顶栏通知换成铃铛面板（§5）。
> 两者都是贴附浮层，照 `UI-OVERLAY-SPEC` 点外关。明细 / 记录 / 录入仍走本节的居中卡。
> 审核「已退回」胶囊和它的理由浮层保持原样。原来这 7 处是右侧整高抽屉，本节没有管到。

### 2.1 承载方式（改共享件，全局生效）

| 场景 | 组件 | 消费方 |
|---|---|---|
| 明细 / 记录 / 录入抽屉 | `components/fp/FPDrawer.vue` | 楼栋/租户/合同明细 + 各附表 record 抽屉 + 台账租户抽屉（10 处） |
| Excel 导入 | `components/import/FpImportModal.vue` | 导入中心 + 7 录入屏（8 处） |

**新增任何覆盖层一律复用 `FPDrawer` / `FpImportModal`，不得自建右滑面板。** 两者已从右抽屉改为居中卡，故所有消费方自动生效。
（2026-09-30 改：问题清单和通知除外，走问题面板 / 铃铛面板，见本节开头的改动注；原来这句不分用途，一律复用这两件。）

### 2.2 居中弹窗基准（`.fp-dwr` / `.fpimp` / `.fp-pal` 同构）

| 部位 | 值 |
|---|---|
| 背板 backdrop | `position:fixed; inset:0; background:rgba(28,28,28,.32~.34); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; padding:24px`（`FPDrawer`/`FpImportModal` 用垂直居中；`CommandPalette` 用 `align-items:flex-start; padding-top:11vh`——顶部居中，二者皆可） |
| 卡片 card | `border-radius:16px; border:1px solid var(--border-subtle); box-shadow:0 24px 64px rgba(28,28,28,.28); overflow:hidden; display:flex; flex-direction:column` |
| 宽度 | `width:min(<W>px, 92~96vw)`（FPDrawer 由 `width` prop 定，默认 640） |
| 高度 | `max-height:85~88vh`；**头/脚 `flex:0`、体 `flex:1; overflow-y:auto`**（内容超高时体内滚动，不撑破视口） |
| 进入动画 | 淡入 + 轻微 `translateY(8px) scale(.985)→none`（不再是 `translateX` 右滑） |
| 关闭 | 背板 `@mousedown="close"` + 卡片 `@mousedown.stop`（拖选不误关）；`Esc` 关闭。例外：必须处理的居中弹窗（编辑权被接管、别的标签页退出或换了账号）背板和 `Esc` 都不关，只能点按钮（2026-10-01 补） |
| 挂载 | `<Teleport to="body">`（避免被祖先 transform/overflow 裁剪的层叠上下文问题） |

参照实现：`CommandPalette.vue`（基准）、`FPDrawer.vue`、`FpImportModal.vue`。已知：Vite dev 对「组件根结构改动（新增 Teleport）」的热更新会 `Failed to reload` 并回退整页重载，**非语法错**（`npm run build` 通过即证）。

### 2.3 弹窗 / 抽屉里的说明也不另起满宽一条

已实现（2026-10-03，jfen/elev-reports-params-import，横条收尾）。弹窗正文里同样按 `LAYOUT-STABILITY-SPEC` §2 六级找位置，
不在正文里插一条随状态出没的满宽说明（它一出现就把下面的选项、表格、按钮往下推）：

| 说明属于谁 | 放哪 | 例 |
|---|---|---|
| 某个选项的后果 | 那个选项自己的副句，每个选项都写（选不选它高度都一样） | 改归属「从哪个月起改」：「水电按月抄表，2025年3月整月算给 X。」 |
| 某一格 / 某一组字段被锁 | 被锁的那一格下面，常驻 18 高的说明位，带重试 | 表档案「区域」格下：「{原因} 归属和位置暂时只能看。重试」 |
| 某几个按钮点不了 | 按钮本来所在的位置，带重试 | 合同绑定页：候选合同下「{原因} 暂时不能改绑定。重试」 |
| 某一家 / 某一行 | 那一家 / 那一行旁边就地标记 | 导出通知单：收款账户下拉旁「不印」 |
| 整块数据的状态 | 弹窗标题旁的状态签，悬停写原因，旁边带重试 | 档案变更页签：「旧数据 · 只读」 |
| 切换口径时的定义 | 同一行副句按口径换文案，长定义挂在切换按钮的悬停说明上 | 欠费清单「按家族」 |
| 保存后会发生什么 | 并进标题下那句副句 | 账册模板编辑态：「… 保存将存成新版 v4 …」 |
| 一类说明只和某一块有关、出没由数据定 | 块内提示（`FPNote`）常驻 32px 预留位，空时透明 | 合同明细「租金行还没绑单元」、电表抽屉「改归建议」 |

确认弹窗（第 6 级）正文里给数的那一段不在此列，照旧。

## 3. 层级（z-index）令牌

> 来源：2026-08-11 审计——全站 20 个不同 z-index 取值、8 个遮罩档位，`tokens.css` 里零 `--z-*` 变量，已经出现 `BuildingNewDialog` 用内联三元 `:style="isEdit ? 'z-index:340' : ''"` 打补丁。

**七级阶梯（`tokens.css`）。取值刻意沿用现状数值，只做令牌化不做重编号——零视觉回归。**

| 令牌 | 值 | 用途 | 现有落点 |
|---|---|---|---|
| `--z-sticky` | 20 | 表头 / 工具条 / sticky 列 | `AnaShell .anx-tools` |
| `--z-popover` | 60 | 下拉 / 浮层 / 跳页 popover（**贴附在触发元素上的**） | `FPPager`、`FPTenantPicker`、`FPUnitPicker`、`TabStrip` |
| `--z-palette` | 200 | 命令面板（Ctrl-K） | `CommandPalette` |
| `--z-modal` | 300 | 页面级弹窗 / 抽屉 / 遮罩 | `FPDrawer`(卡片用 `calc(var(--z-modal) + 1)`)、三大报表 `.fin-mask`、`ReconWorkbench`、附表屏 masks、ledger dialogs |
| `--z-modal-2` | 320 | **弹窗之上再开**的弹窗 / 抽屉 | `BuildingDrawer`、`ContractDrawer`、`ContractNewDialog`、`TenantDrawer`、`FpImportModal`、`LedgerWideTable` 批量 |
| `--z-confirm` | 350 | 保存 / 删除二次确认、导入结果（必须盖住一切弹窗） | `SaveConfirmDialog`、`ImportResultToast` |
| `--z-toast` | 400 | 全局提示（最高，不被任何层遮挡） | `AppShell .fp-net-toast` |

### 3.1 规则

- **新增覆盖层一律用令牌**，禁止写字面量 z-index；禁止用内联 `:style` 覆盖层级（层级是结构问题，不是实例问题）。
- **模态遮罩不得用 `--z-popover`**。popover 档是给"贴附浮层"的，页面级弹窗放这一档会被任何抽屉盖住。
  - 已修两处错位：`CockpitView .cv2-mask`、`FinCashflowView .fin-mask` 原为 `z-index:60`（模态却在 popover 档）。
- 层内平级冲突靠 DOM 顺序决定，不再加中间档。需要"盖住同级"就升一档。

---



---

## 4. 被删像素表里仍然管用的几条

> 2026-09-13 立，同日订正过一次框架。初稿标题是「对设计系统的有意偏离」，**那个框架是错的**：
> skill `SKILL.md:15-16` 明写设计令牌与组件实现**实现即标准**（`demo3/frontend/src/styles/tokens.css`、
> `components/{ds,fp}/*.vue`），包里 `tokens/*.css` 是 demo3 的**镜像**，`components/**/*.jsx` 是
> 2026-06 冻结的 React 原型基线、`:20` 明写**不再更新、改样式看 `.vue`**。
> 所以**不存在「demo3 与设计系统对立」**，设计系统本来就把实现认作标准。

本节真正的用处是：`DESIGN-FIDELITY.md` 删除后，下面这几条**只在代码里以既成事实存在，
没有任何文字出处**。少了它们，下一个照 skill 里那些冻结原型重写组件的人会把它们改掉。

逐条都在 2026-09-13 实测过两边。分三类：

| 类 | 含义 |
|---|---|
| **A · 实现即标准** | 值只在 `.vue` 里，skill 那侧是冻结原型或镜像。以代码为准，动它要拍板 |
| **B · skill 文本过期** | skill 写的和现网不一致，要改的是 skill 不是代码 |
| **C · 真缺口** | 两边都没定，或定了没收敛。不是偏离，是没人管 |

### 4.1 侧栏面板宽 234px —— A 类，且是 demo3 内部两个数打架

| 侧 | 值 | 落点 |
|---|---|---|
| demo3 | `width:234px; flex:0 0 234px` | `frontend/src/components/shell/SidebarPanel.vue:101-102`（写死，不读令牌） |
| 设计系统 | `--sidebar-width: 212px` | skill `tokens/spacing.css:41` |
| demo3 令牌 | `--sidebar-width: 212px` | `frontend/src/styles/tokens.css:236`（抄自设计系统，**面板不消费它**） |

差 22px，而且**这不是 demo3 与设计系统的分歧，是 demo3 内部的分歧**：skill 的 `spacing.css` 是
`demo3/frontend/src/styles/tokens.css` 的镜像，两边都写 212；真正跑的 `SidebarPanel.vue` 写死 234，
从不读那个令牌。`SIDEBAR-UX-REDESIGN` 把「面板 234 不动」写进冻结约束，所以跑的那个才是标准。
**不要把 `SidebarPanel.vue` 改成 `var(--sidebar-width)`** —— 那会当场窄 22px。要统一得先拍板改屏上宽度。

### 4.2 叶子项图标打头，不渲染前导箭头占位 —— A 类

**叶子项（无 `children`）= 图标打头，无任何前导占位。** 子元素顺序：
`[激活时 3px accent bar (absolute, left:0)]` → `[图标 span 16×16]` → `[标签 span flex:1]`。

⚠️ **不要在叶子项图标前渲染「展开箭头占位」**（例如 14px 空 `<span>`）—— 那会把图标+标签整体右推约 22px
（14 占位 + 8 gap），看起来「居中」而非左对齐。**只有存在 `children` 的目录项才渲染 chevron**；
本系统 FP_NAV 无目录项，故 nav-item 一律图标打头。
自验：图标 `left-offset = 12px`（= padding-left），标签 `left-offset = 36px`（12 + 16 + 8）。

**skill 那侧写的是相反的代码，但那份不算标准**：`components/navigation/SidebarNav.jsx:190` 写的是
`{isDir ? <Chevron open={isOpen} /> : <span style={{ width: 14, flex: "0 0 auto" }} />}` —— 正是这里禁止的那个 14px 空 span。
demo3 侧是 `frontend/src/components/ds/SidebarNav.vue:165` 的 `isDir ? Chevron(isOpen) : null`。
那个 `.jsx` 是 2026-06 冻结原型（`SKILL.md:20`），`SidebarNav.prompt.md` 里对此**一字未提** ——
所以这条规则今天除了本节没有任何文字出处，这才是它必须留下的理由。
（这条也是 2026-09-03 侧边栏重设计里方案 B「目录项」被否决的理由之一。）

### 4.3 白底卡片有描边并裁切，表格卡片 padding 传 0 —— A 类

| 属性 | demo3 | 设计系统 |
|---|---|---|
| `surface="white"` 的 border | `1px solid var(--border-subtle)`（`ds/Card.vue:33`） | `Card.jsx:4` 注释明写 **no border** |
| `surface="white"` 的 overflow | `hidden`（`ds/Card.vue:34`） | 无此规则 |
| 表格 / 列表卡片的 padding | 调用方显式传 `:padding="0"`，内部表格行自行处理 `14px 4px 0` | `Card.jsx:7` 默认 `padding = 24`，无表格例外 |

### 4.4 变长文本：手段两边一致 —— B 类（skill 过期）+ C 类（一处真缺口）

> 2026-09-13 订正。本节初稿写成「设计系统要求缩字号、demo3 不照做」，**那是错的** ——
> 我读的是已删除的 `Factory Park Design System.zip` 旧快照。live skill 的 `CLAUDE.md:13`
> 自己写着「原规则要求**缩字号**并用 `FitText` / `fitFontSize` 实现。**这一手段已作废**」（2026-08 更正），
> 手段换成「省略号 + 定宽列」，`:26` 还明写 `FitText.jsx` **新代码不要引用**。
> **所以这一条不是偏离，两边同向。** 留在 §4 里只为记住剩下那两处真的对不上的地方。

共同目标：长度不定的文本（KPI/统计数值、表格金额、轴刻度、环图中心、徽标计数）必须单行，
不换行、不裁切半个字、不把邻居挤出对齐。手段：固定字阶；文字放不下用省略号，数字不省略。KPI 数值放不下先降一档（`KPI-CARD-SPEC` §3），还放不下换成以「万」为单位、悬停看全数（2026-10-01 改：原写「固定字阶 + 定宽 + 省略号，不缩字号」。定稿·待实现；还差：KPI 降一档后仍是省略号 + 悬停看全，没换成以「万」为单位）。
`FitText` 已于 2026-08 整个移除，全仓命中 0。

**真正对不上的两处：**

| # | 设计系统怎么说 | demo3 实际 |
|---|---|---|
| 1 | KPI 数值 `var(--fs-display)` + `line-height:1.1`（`CLAUDE.md:17`、`SKILL.md:55`） | `ds/KpiCard.vue:76` 是 `var(--fs-h1)` + `var(--font-mono)` + `line-height:1.1`；`ana/AnaKpiTile.vue:43` 是 `var(--fs-h3)` + `font-mono` + `tabular-nums`。**skill 那两行是过期的**，不是 demo3 违规 |
| 2 | 「不得裁切半个字」 | `ds/KpiCard.vue:76` 数值那一层**没有任何溢出策略** —— 既没 `nowrap` 也没 `ellipsis`。副标题（`:95`）和 `AnaKpiTile`（`:43`）都有省略号，只有数值这一格漏了。撤掉 `FitText` 时没补上 |

第 1 条要改的是 skill，不是代码。第 2 条是真缺口：给 `KpiCard` 数值补 `white-space:nowrap` +
`text-overflow:ellipsis`（或按等宽金额列的对齐要求另定），**本轮未改**，动它要看真实超长值长什么样。
> 2026-10-01 用户拍板：不补省略号。数值 `nowrap`，放不下先降一档，还放不下换成以「万」为单位、悬停看全数（定稿·待实现；2026-10-01 jfen/hint-impl 只把悬停换成深色气泡，「万」和撤省略号都还没做）。`AnaKpiTile` 数值现有的省略号（`AnaKpiTile.vue:54`）也要撤；上面引 skill 的「省略号 + 定宽列」是 09-13 的原话，skill 已于 09-30 / 10-01 改成本段的写法。

### 4.5 KPI 网格断点：204 已废，现状未收敛 —— C 类

原 `DESIGN-FIDELITY §3.5` 写的是 `repeat(auto-fit, minmax(204px, 1fr))` + `gap 16px`。
`204` 现在全仓 0 命中，设计系统给的是 `minmax(170px, 1fr)`（`templates/dashboard-app/OverviewScreen.jsx:135`）。
各屏实际自写了至少七个断点：280 / 248 / 238 / 210 / 190 / 150 / 120。

这一条**不是有意偏离，是没人管**。记在这里是为了别把它当成已收敛。要收敛得单独排一轮。

---

## 5. 通知（铃铛）

> 2026-09-30 用户拍板。图在画布「提示层级与公共电核算」06-D / 06-E / 06-F / 06-G：
> `../../../运维文档/设计稿/未实现/提示层级与公共电核算-2026-09-29/`（线上 https://claude.ai/artifact/6EeNrVfvacktpfgMsrbw4F ）。
> **图是规格**，本节是它的文字版，不一致以图为准。现有 25 种通知逐条对过源码的盘点在同目录 `通知类型盘点-2026-09-30.json`，
> 记号规则的对标出处在 `铃铛记号参考-2026-09-30.json`。
>
> 「通知」= 别人或系统让你知道的事。你自己刚做完的动作成没成是结果回执（`UI-OVERLAY-SPEC` §7），不是通知。

### 5.1 一律进铃铛，分三类 —— 已实现（2026-10-01，jfen/hint-impl；2026-09-30 定稿，画布 06-F）

通知一律进顶栏铃铛（手机顶栏是同一个铃铛）。面板里分三类：

| 类 | 放什么 | 怎么消失 |
|---|---|---|
| **等你处理** | 授权请求、待审的表、被退回的表 | 事情办完自己消失（批了、拒了、审了、重新交了、过期了），不用点已读 |
| **有结果了** | 你请的授权被批准 / 拒绝 / 超时；你交的表审核通过；审核被撤销（带理由）；你确认的催缴单被取消确认或作废（带理由）；你的角色或权限被改了（「刷新后生效」） | 打开铃铛就算看过，变灰；只留最近 30 条 |
| **系统** | 新版本（带「刷新」）；没看过的更新记录（带「看看」） | 刷新或点开看过就消失 |

- 面板一行一件事，点整行跳到那张表那个月；最高到屏幕的 70%，超出在面板里滚动；手机上贴着顶栏下方、占满宽。面板是贴附浮层，照 `UI-OVERLAY-SPEC` 点外关。
- 收进铃铛的旧东西：版本更新的底部深色条（`VERSION-UPDATE-SPEC` §6）、顶栏 ✦ 上的蓝点、账号菜单版本号旁的蓝点、手机导航抽屉「版本更新」那一行的未读标记。**✦ 只留作更新记录入口**，不再挂点。
- 「本月出账」原来主管条上的「待批授权 N」点开的也是铃铛面板，和铃铛重复，2026-10-03 撤掉（jfen/elev-reports-params-import）；主管在标题行只留一颗「N 人在编辑」胶囊。
- 审核「已退回」胶囊和它的理由浮层留在那张表的工具条上，保持原样。

**分两步做**（2026-09-30 拍板；2026-10-01 jfen/hint-impl 两步一起做完，「有结果了」由后端 `user_notice` 按人记、带已读）：

1. **第一步**：前端就能做的「等你处理」和「系统」两类。前者今天已由心跳送到（授权请求、待审、被退回），后者来自前端的版本轮询和更新记录。
2. **第二步**：后端加**每人一份、带已读的消息记录**，再上「有结果了」。今天服务端不存通知、没有已读，页面关着时发生的事收不到，这一类只能等这张表。

### 5.2 不进铃铛、当场出现 —— 已实现（2026-10-01，jfen/hint-impl；2026-09-30 定稿，画布 06-E）

正在做的事被打断、要马上知道的，不进铃铛：

| 事 | 怎么出现 |
|---|---|
| 编辑权被接管 | 居中弹窗（不变，`CONCURRENCY-SPEC` §4.3） |
| 编辑态失效（锁没了） | 居中弹窗（不变） |
| 正在编辑的表被交审或审核通过 | **新增**：用同一个居中弹窗，写谁交审 / 谁审过。原来是静默退出编辑 |
| 临时授权到期 / 一份先到期 / 被系统提前收回 | 底部一句，三种分开写（`EDIT-MODE-SPEC` §6.2）：「授权已到期」/「「{权限名}」的授权已到期」/「授权提前失效了」，确实有屏退出编辑时句尾带「，已退出编辑」。2026-10-03 改（画布 08）：原来三种共用「授权已到期，已退出编辑」，被提前收回时说「到期」是假话；满宽授权条已撤，倒数在顶栏胶囊（`ELEVATION-SPEC` §4.5）。再往前：到期是授权条倒数到 0 后静默退出，被提前收回时什么都不说 |
| 断网或服务出错 | 底部，走结果回执（⑧）：失败类不自己收，带「刷新」。2026-09-30 改：原写「底部深色条（不变）」；06-B ⑧ 已把断网收进回执（已实现（2026-10-01，jfen/hint-impl），画布 06-B ⑧） |
| 这一页属于新版本 | 点导航时底部深色条（不变，`VERSION-UPDATE-SPEC` §6 第 2 种） |
| 被踢回登录页一类 | 在登录页说：账号已停用、登录已过期等（画布 06-E「登录页」一组） |
| 别的标签页退出或换了账号 | 居中弹窗，不能点外面关，只有一个「刷新」按钮。2026-10-01 用户拍板：原来是页面顶部红色满宽横幅；这时本页所有请求都已发不出去（已实现（2026-10-01，jfen/hint-impl），画布 06-E） |

「本次更新」弹卡照旧：功能更新后自动居中弹一次，保持原设计（`VERSION-UPDATE-SPEC` §2–§3、`RELEASE-NOTES-SPEC` §7），不进铃铛。

不算通知、留在原处的：谁在线（顶栏头像）、谁在编辑（侧栏橙点、编辑按钮）、参数改过待重算、合同快到期、异常提醒中心、
本月出账标题行的「待处理」入口（合同缺计费行、参数待重算；2026-10-03 前是年份条下的满宽前置条）、关掉「本次更新」后 ✦ 下的指路气泡、保存成功这类回执。

### 5.3 铃铛记号 —— 已实现（2026-10-01，jfen/hint-impl；2026-09-30 定稿，画布 06-G）

| 项 | 规则 |
|---|---|
| 红数字 | 「等你处理」的件数：一条授权请求、一张待审的表、一张被退回的表，各算 1。事情办完才减，**打开铃铛不减**。待审的表不含自己交的（不是系统管理员时，自己交的要别人审，RBAC-SPEC §12.4），清单同一条判据 |
| 蓝点 | 没有要动手的、只有没看过的结果或更新时出。打开铃铛就消失；面板里上次打开之后新来的行挂小蓝点，关掉面板后变灰 |
| 两种都有 | 只显示红数字 |
| 封顶 / 0 | 超过 99 写 99+；0 不显示，整个记号不出现 |
| 位置与大小 | 贴铃铛右上角，数字变多只往宽里长；数字 16 高、蓝点 8；外圈 2px 底色描边；不改铃铛大小，不挪工具条 |
| 动效 | 出现、消失 120ms 淡入淡出；不闪、不循环跳动，数字变化直接换 |
| 读屏 | 铃铛按钮的名字里带数：「通知，4 件等你处理」「通知，有新消息」「通知」；记号本身不读 |
| 只挂在铃铛上 | ✦、账号菜单、手机导航抽屉不再各挂一个点 |
| 多个标签页、多台电脑 | 红数字由服务端算，处处一致；「看过」也要服务端记，蓝点才会跨电脑一致（「有结果了」记在 `user_notice.seen_at`，系统类记在 `user_seen`，随心跳回来） |

取代 `VERSION-UPDATE-SPEC` §1 原来的「红色数字只归待批授权」和 ✦ / 账号菜单 / 手机抽屉三处蓝点（2026-09-30 已在那边改）。
