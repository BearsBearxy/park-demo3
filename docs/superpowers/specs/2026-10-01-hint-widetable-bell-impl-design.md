# 提示层级 · 宽表 · 铃铛 · 三屏 · 实现规范（2026-10-01）

**管什么**：怎么实现。「做成什么样」以画布为准，规则写在页面级规范和 system design 里，本文不重复。
- 画布：`../运维文档/设计稿/未实现/提示层级与公共电核算-2026-09-29/`（Design 画布第 26 版，01–07 节）。**图就是规格**，文字是摘要；图文不一致以图为准。
- 规则：`docs/design/` 下标「定稿·待实现」的条目（LAYOUT-STABILITY、LIST-PAGE §9、PAGE-BEHAVIOR §2/§4/§5、UI-OVERLAY §3.5/§7、EDIT-MODE §6、TAB-BAR、VERSION-UPDATE、RESPONSIVE-LAYOUT 等）；skill `factory-park-design` 的 `components/feedback/hints.prompt.md`、`components/data/datagrid.prompt.md`。
- 勘察底稿：2026-10-01 四个只读勘察员对着画布截图和源码逐块列出的清单（任务、文件、覆盖表），计划见 `docs/superpowers/plans/2026-10-01-hint-widetable-bell-impl.md`。

---

## 1. 共享件

每件只有一个实现，屏上不许再自写同类东西。收口时两条门禁（§5）兜底。

### 1.1 结果回执（十件 ⑧）
- `utils/receipt.ts`：`receipt.ok(text, action?)` / `receipt.warn(...)` / `receipt.fail(text, action?: {label, run})`。模块级队列，最多 3 条，第 4 条挤掉最旧。
- `components/fp/FPReceiptHost.vue`：挂在 AppShell，底部居中。成功 4 秒自收；失败不自收，带动作按钮和 ×。
- `FPToast` 默认时长改 4000；`tone="error"` 不自收，支持 `retryText` / `@retry`。卡内回执（贴表格区底边）仍用它。
- 断网：`AppShell` 的 `.fp-net-toast` 删掉，改 `receipt.fail(ui.netError, {label:'刷新'})`。
- 收藏：`Toolbar` 的 `.fp-star-note` 改 `receipt.ok('已收藏，在「首页」上能找到', {label:'撤销'})`。
- `alert()` 报成败的一律换成回执；报字段错误的一律换成字段报错（1.5），不走回执。

### 1.2 确认弹窗与离开确认（十件 ⑨、02-A）
- `utils/ask.ts`：`ask({title, body?, action, cancel='取消', danger?}): Promise<boolean>`；`askLeave({page, count, verb='关闭'}): Promise<boolean>`，`count === 0` 直接 `true` 不弹。
- `components/fp/FPConfirmHost.vue`：挂在 AppShell。居中 440，标题是问句，正文给数，主按钮写动作本身（「删除 76 条」不写「确定」）；`danger` 时主按钮红、默认焦点在「取消」；Esc、点外面 = `false`。
- 离开确认文案（02-A）：标题「关闭「{页}」？」，正文「这页有 {N} 处改动还没保存。」，按钮「继续编辑」/「放弃改动并关闭」。
- 自写确认遮罩（`cd-dlg` / `bd-dlg` / `fin-dlg` / `lg-bulk` / `fin-mask` / `pnl-mask` / `LedgerDeleteCompanyDialog` 等）换成 `ask`。
- **不并进 ask**：`SaveConfirmDialog`（保存 / 放弃 / × 三钮）照旧。
- **必须处理的弹窗**（编辑权被接管、别的标签页退出或换了账号）不走 ask：点外面、Esc 都不关，只能点它自己的按钮（UI-OVERLAY §3.5 例外）。

### 1.3 悬停说明（十件 ⑩）
- 全局指令 `directives/tip.ts`：`v-tip="'一句'"` 或 `v-tip="{text, sub}"`。单例深色气泡挂 body，12px；停 500ms 出、按下即收；触屏点一下出；宿主没有可读文字时补 `aria-label`。在 `main.ts` 和 `test-setup.ts`（`config.global.directives`）注册。
- 外观抄 `ShellTip`（顶栏/图标轨/页签条继续用 ShellTip）。
- 替换对象：原生 `title=`（464 处 / 89 文件）。**图表读数气泡**（ECharts、光伏 cz-tip、SVG 读数）要零延迟跟鼠标，不套 500ms；外观照图 ⑩ 统一成 ShellTip 同款（S4），行为不动。
- 不加 ⓘ 触发图标（用户已推翻 ⓘ 浮层）。悬停说明挂在元素本身上。

### 1.4 空状态 · 加载失败（十件 ⑦）
- `components/fp/FPEmpty.vue`：`<FPEmpty tone="empty|error" :sub action="生成本月" @action>一句</FPEmpty>`。占住内容区居中：图标方块 + 一句 + 副句 + 至多一个按钮。
- `FPLoadError` 改成 `FPEmpty tone=error` 的封装：默认插槽一句、`sub` 副句、按钮恒为「重试」，**换掉表格本身**，不再是表格上方的流内红条。调用处要让表格和它互斥（`v-if` / `v-else`）。
- `AnaEmpty` props 不变，外形换成 FPEmpty 同款；分析屏 `AnaEmpty failed/err` 一律换 `FPLoadError` 并接上重载（首载请求包成 `load()`，`onMounted` 和 `@retry` 共用）。
- 流内「本月暂无…」灰虚线条（`bn-bar` / `mt-empty` / `ll-bar` / `pl-bar` / `ec-empty` / `cm-empty` / `pm-empty` / `cb-bar`）换成标题旁页面状态（1.5）+ 内容区 FPEmpty。
- 失败态沿用房内定型写法：每个数据源独立错误槽、seq 竞态守卫、错误只在成功分支清；写入口 `&& !loadErr`；`FPEditModeButton :disabled="!editMode && !!loadErr"`。

### 1.5 页面状态 · 块内提示 · 就地标记 · 字段报错（十件 ⑥④①⑤）
- `FPStateTag`：`<FPStateTag tone="warn|edit|muted">本月未生成</FPStateTag>`，22 高，贴标题或期间选择旁。
- `FPNote`：`<FPNote tone="info|warn|danger">一句<template #action>去绑定</template></FPNote>`，12px、圆角 8、一行；无竖条、无虚线。左侧状态图标点不动（不是 ⓘ 浮层）。
- `FPMark`：`<FPMark tone="warn|danger|muted">缺起止日期</FPMark>`，6px 圆点 + 12px 字。只替换「只有圆点、意思全靠 title」的约 10 处（`bn-gapdot` / `bn-arch` / `ex-dot` / `pb-dot` / `lg-unbound-dot` / `s10-unbound-dot` / `mlg-book` / `lc-mdot`）。
- `.fp-field-err`（`styles/base.css`）：12px 红字，`line-height` / `min-height` 18px，常驻占位。替换 14/16/17 三种高度的自写报错行。
- 分析屏期间回退：删 `AnaPeriodBanner`。整页回退 → `AnaShell` 新开的 `#period-note` 插槽里放 `FPStateTag`（「显示 2026-08 · 9 月无数据」）；单图回退 → 那张图卡头放 `FPStateTag`（「显示 2026-07」）。

### 1.6 入口胶囊 · 问题面板（十件 ②③、06-C 方案 A）
- `FPAlertChip`：28 高带 ▾；有 / 无（「无待处理」灰）/ 筛选生效（实底 + ×，`@clear`）三态。
- `FPAlertPanel`：从右侧抽屉改成以 chip 为触发的 `ds/Popover`，420 宽，页面不变暗；组头可收起、带件数和处理按钮（如「重算本月」）；明细点一条跳到表里那一行并闪一下；多于 20 条面板内滚动；留默认插槽（台账 / 附表10 的 `FPTenantIssuePanel` 原样放进去）。
- 替换 `FPSideDrawer` 作问题清单的 6 处；`FPSideDrawer` 本身等铃铛换掉 `FPApprovalDrawer` 后删。
- 合同管理「待补档案」：删 `mx-gapbar`，工具条「按某天查看」左侧放胶囊「待补档案 ▾」（不写总数，件数在弹层每一行上）。
- 催缴单明细：标题里的告警徽标改成 Popover 触发，`bn-apanel` 从流内橙块改成贴着徽标的浮层。
- 已退回胶囊 + 理由浮层（`FPReviewActions`）保持原样。

### 1.7 改动数（02-A、02-D）
- `stores/auth.ts`：`openEditor(id, screen, dirty?: () => number)`（缺省按 1，宁可多问）；`dirtyOn(screen)`、`dirtyTotal`。`beforeunload` 只在 `dirtyTotal > 0` 时拦。
- `useEditLock(onExit?, canEdit?, dirty?)`、`EditModeOpts.dirty?` 透传。各屏把自己的改动数接进来。
- 会卸掉页面实例的地方走 `askLeave`：关页签、重新加载、关闭其他 / 右侧、切账期、退出登录。页签 `dirty > 0` 时 × 前挂 6px 橙点。
- 侧栏跳转不弹：正在编辑的屏点侧栏会开新页签，不卸载（TAB-BAR 例外二）。

### 1.8 宽表固定列与表格高度（07）
`composables/useWideTable.ts`，纯函数 + composable：
- `planFixed(visW, cols: {key, side:'L'|'R', w, rank, name?}[])` → 每列的 sticky 样式、内沿阴影列、名称列宽。名称列封顶 `floor(visW/5)`；左右固定列合计 > `0.4·visW` 时按 `rank` 从大到小退，退到只剩 rank 0；offset 只累加仍固定的列；`visW ≤ 0` 全留。
- `heightStage(availH, {grpH, leafH, rowH, footH})` → 0 全贴 / 1 分组表头不贴顶 / 2 合计也不贴底 / 3 另加 `min-height = leafH + 8·rowH`、整页往下滚。
- `numW(strs, px=12, pad=16)`：按整列最长的数（含合计）算宽，Roboto Mono 0.6em + 2px 余量；`textW` CJK 1em、其余 0.6em。**不量 DOM**。
- `useWideTable(wrap, cols, dims)` → `{fix, nameW, hStage}`：`watch(wrap)` + ResizeObserver 量表格区 `clientWidth/clientHeight`（照抄 `useFitRows` 的挂法，能接 `v-else` 里的 wrap）；只在宽高真变、或数据换了（换月、换账册、数字位数变了）时重算，滚动翻页不重算。S 档（≤600）高度恒 0 级，卡片化不动。
- 固定数字列不再锁 128、不带省略号；名称列超 1/5 省略、悬停看全称（`v-tip`）；编辑态勾选列跟名称列绑在一起，计入 40%，永远不退。
- 删掉各表按屏幕档退列的旧逻辑（`FPLedgerTable:51-53`、`MeterLedgerGrid:95-112`、`PoolLedgerView:314-326`、`LossLedgerView:174-181`、`PnlTable` / `S10Table` / `SalaryTable` 的 `@media(max-width:600px)` sticky 块）。

各表先后（rank 0 起）：

| 表 | 先后 |
|---|---|
| 月度台账 | 租户 → 本月结余 → 应收合计 → 上月结余 → 收款（10-01 用户确认）；备注不固定 |
| 园区抄表 | 用途 → 用量 → 位置 → 状态 |
| 损益附表 1–5 | 科目细分（编辑态勾选列随它）→ 本年合计 → 分组 → 填入；备注不固定 |
| 附表10 销售收入 | 租户 → 合计 |
| 公共电核算 | 用途 → 位置 |
| 楼栋损耗 | 位置 |
| 附表12 工资 | 姓名 → 序号 |

### 1.9 三屏小件（03–05）
- `utils/touColumns.ts`：`touMode(有分时的表数, 总表数)` → `'none' | 'row' | 'cols'`（0 → none，过半 → cols，其余 → row）；开关记忆 `loadTouPref/saveTouPref`（localStorage，读写包 try/catch）。公共电核算、园区抄表共用。
- `components/fp/FPTableTools.vue`：表格卡内右上一条：可选开关（「分时用量」/「分时列」）+「列 · N 列隐藏」勾选菜单 + 默认插槽（放「批量确认」）。`mode='none'` 不出开关。
- `FPMoreMenu` 加可选 `label` / `icon`（渲染「图标 字 ▾」描边按钮）和 `MoreItem.danger`；不传保持「…」原样。
- `Segmented`（sm，28 高）做状态页签，label 传「字 + 灰色计数」。
- 表格样式（03-C）：行高 40、正文 14、表头 12、字左数右、读数和金额两位小数、无字距；钱那一列加粗浅底，不用品牌蓝。

### 1.10 铃铛（06-D 左、06-E / F / G）
前端：
- `stores/bell.ts`：`red` = 待批授权 + 待审 + 被退回（三个服务端数，来自心跳）；`blue` = `red === 0` 且（`unseenResults > 0` 或系统项自上次开铃后有新）；`markText`（'4' / '99+' / null）；`ariaLabel`（「通知，4 件等你处理」/「通知，有新消息」/「通知」）；`openPanel()` 记系统项已看（按账号 localStorage）、取三份明细、调 `noticesApi.seen()`；关面板清行上的小蓝点。
- `components/shell/NotifyBell.vue`：按钮 + 记号。数字 16 高只往宽里长，蓝点 8，外圈 2px 底色描边，120ms 淡入淡出不跳动，记号 `aria-hidden`；悬停说明只写「通知」（补 TAB-BAR §6.4 的待定）。
- `components/shell/NotifyPanel.vue`：三组 等你处理 → 有结果了 → 系统，底部「全部标为已读」（= 有结果了全置已读 + 更新记录标已看；新版本行照旧刷新才消失）。授权行当场处理（倒计时 / 你的密码 / 拒绝 / 批准 / 后果一句），照 06-F 压成两行；点整行跳到那张表那个月；桌面 420 宽贴铃铛，高 ≤ 70vh 内滚；手机贴顶栏下方满宽；点外面关、Esc 只关自己。替换 `FPApprovalDrawer`（删）。
- 本月出账主管条「待批授权 N」点开的是铃铛面板。
- ✦、账号菜单、手机导航抽屉上的点全部去掉，只挂在铃铛上。
- 新版本不再走底部深色条，进铃铛「系统」；「这一页属于新版本」那条照旧。「本次更新」弹卡照旧自动弹。
- 当场出现、不进铃铛：
  - 编辑中的表被别人交审或审核通过 → `FPEvictedDialog` 加 `review` 分支，写谁交审 / 谁审过，只有「知道了」；
  - 临时授权到期 / 被系统提前收回 → 底部一句（编辑中「授权已到期，已退出编辑」，否则「授权已到期」）；
  - 别的标签页退出或换了账号 → 删顶部红色满宽 `.app-drift`，改居中弹窗，点外面和 Esc 都不关，只有「刷新」；
  - 登录页一句：登录已过期、账号已停用。
- `auth.refreshMe()`：App 挂载时调 `GET /auth/me`，让「角色或权限被改 · 刷新后生效」说实话。
- 远程授权等待中关掉弹窗 → `approvalsApi.cancel(id)`，不再按超时算。

后端（Spring Boot 3.3 + MyBatis-Plus + Flyway，迁移现到 V132）：
- `V133__user_notice.sql`：`user_notice(id, username, kind, title, detail, ref, actor, created_at, seen_at NULL=未读, KEY(username,id))`。
- `NoticeService`：`add(to, kind, title, detail, ref)`（发给当前操作人自己跳过；插入后只留该人最近 30 条）、`list(me)`、`markSeen(me)`、`unseenCount(me)`。
- 接口：`GET /api/notices`、`POST /api/notices/seen`、`GET /api/review/returned`、`DELETE /api/auth/approvals/{id}`（仅请求者本人）、`GET /api/auth/me`；心跳响应加 `unseenResults`、`elevated`。
- 写入点：`ReviewService.approve`（→ 交审人）、`withdraw`（删行**前**读交审人 / 原审核人）；`ApprovalService.decide` 批准 / 拒绝（→ 请求者）、`ApprovalStore.sweep` 过期回调（→ 请求者；撤回的不回调）；`BillNoticeService.unconfirm` / `void`（清 `confirmed_by` **前**读原确认人）；`SystemService.updateRole`（→ 持该角色的人）/ `updateUser` 角色确有变化（→ 该人）。
- 停用：`UserPermissionCache` 另记停用账号集合，`JwtAuthFilter` 遇到签名有效但已停用的令牌回 `X-Auth-Reason: disabled`。登录口仍统一报「用户名或密码错误」（不给枚举口）。

---

## 2. 按推荐定下的做法（2026-10-01，用户说「按你推荐」）

勘察时冒出来、规范没写死的，按下表做。你不同意哪条，告诉我改。

| # | 问题 | 定为 |
|---|---|---|
| 1 | 除台账外各表的固定先后 | 见 §1.8 表；名称列取「用途」不取「位置」，因为一行是一块表 / 一个池 |
| 2 | 公共电核算、楼栋损耗、工资没有固定的结果数，要不要新加固定列 | 不加，稿上没画 |
| 3 | 什么时候重算列宽 | 宽度变了（拖窗口、收侧栏）、数据换了（换月、换账册）时重算；编辑中某个数变长、原列宽放不下时也重算（数字不许截断）。滚动、翻页、编辑但放得下时不重算（07-C「列不会莫名挪位」） |
| 4 | 屏顶瘦身（让位第 1 步）其余屏做不做 | 只做稿上画了的园区抄表、催缴单 |
| 5 | 7 张以外的固定列（催缴单 ≤600 钉租户、三大报表 S 档钉首列、光伏热力格） | 不动 |
| 6 | 02-A 标题里的「侧栏跳转」要不要弹离开确认 | 不弹，见 §1.7：编辑中点侧栏开新页签、不卸载，不会丢改动（TAB-BAR 例外二）。S6 把 LAYOUT-STABILITY、EDIT-MODE、UI-OVERLAY 三处「侧栏跳转」的字同步改掉 |
| 7 | 园区抄表整月删除原来要手输账期 | **待用户定**（图 02-B 右没有输入框）。先按 ⑨ 外形做，手输账期保留到用户定 |
| 8 | 驾驶舱「某年含离群月」提示条 | 改成那张图卡内一行 FPNote，不做横条，不加 ⓘ |
| 9 | 各屏手写、已占住内容区的空状态约 86 处 | 照图 ⑦ 收成一种样子：S4 一并换成 `FPEmpty`（图标方块 + 一句 + 副句 + 至多一个按钮），不再各写各的 |
| 10 | 催缴单取消确认用的 `window.prompt` | 这次不换，见 §4 |
| 11 | 铃铛授权行照 06-F 压成两行，原抽屉的「要改」一行和权限点胶囊 | 照图去掉 |
| 12 | 系统类「看过」存哪 | 照 06-G 末行：也存服务端，蓝点跨电脑一致 |
| 13 | 账号停用 | 照 06-E：登录页说「账号已停用」。为不给枚举口，**密码对了**才这么说，密码错统一报「用户名或密码错误」；被踢回登录页时也说清楚 |
| 14 | 公共电核算删掉的「备注」列 | 进用途格的悬停说明；导出 Excel 照旧带备注 |
| 15 | 三屏编辑态按钮 | 公共电核算：新增池 + 生成本月 / 重新生成 + 完成；催缴单：完成左边留「重新生成」；导出当月只在浏览态 |
| 16 | 园区抄表六张卡的去向 | 租户表已抄 → 标题旁一句；未抄、待核常驻页签；异常、待绑定、已拆、未在册非零才出页签（已拆 / 未在册的说明进页签悬停）；存疑走入口胶囊、非零才出；派生就绪不出；已停用走组尾「另有 N 块已停用 · 显示」 |
| 17 | 园区抄表楼栋下拉、重置、按名一键挂 | 楼栋交给分组行收起；重置删；一键挂进编辑态「…」（图上「…」只画了 3 项，一键挂是现有功能，不能丢入口） |
| 18 | 「导入 ▾」 | 去掉 ▾：现在只有一种导入，下拉里没有东西可放 |
| 19 | 分时段行出哪几段 | 照 04-C：有值的段各一行，全空的段合成一行（「平段 · 谷段」一行 –） |
| 20 | 没导册子的 `mt-bookbar` | 改标题旁页面状态「本月没导册子」 |
| 21 | 手机、平板档 | 三屏的 S/M 分支不动 |
| 22 | 05-A 浏览态画了「批量确认」和行内「确认」 | 仍只在编辑态出（EDIT-MODE：写入口只在编辑态） |
| 23 | 催缴单「有警告」页签算不算缺收款公司 | 算 |
| 24 | 三屏标题的图标（稿上没画） | 保留，和全站一致 |
| 25 | 分组行默认 | 默认全展开，收起不记忆 |
| 26 | 顶部蓝色满宽授权条 `.app-elev` | **待用户定**：01 节标题说页面顶上不再有横贯全宽的提示条，但稿上没给它新样子 |
| 27 | 入口胶囊带不带 ▾ | 点开出面板的一律带 ▾ |
| 28 | 表内竖分隔线 | 照图：列组之间 1px `--line` 整高竖线 |
| 29 | 钱那一列 | 加粗 + 整列浅蓝底 + 表头下蓝色下划线（03-A / 04-A / 05-A 同形），文字不用 `--hue-blue` |
| 30 | 06-D 左格与 06-F 的面板不一样 | 06-D 是缩略，以 06-F 为准 |

**2026-10-02 补（用户拍板，画布 09/10；不属于上表的「按你推荐」）**：表格每列按内容定宽（数字列按整列最长值撑开、永不省略；名称、文字列按最长内容），相关的格子挨在一起；容器比表格宽出来的那部分，统一放进最右边一列空列（filler：每行末尾空 `td`、表头空 `th`，`aria-hidden="true"`、`padding:0`，表头底色、行线、hover 底色照样铺满整宽）。不再让某一列文字列吸收余宽，也不再用 `min-width:100%` 按比例摊到所有列（§9 七张宽表原来都是这么摊的）。要横滚时 filler 宽 0，名称列 1/5 封顶、数字不截断、固定列退列都不变；有右固定列的表，不溢出时 filler 排最后、右固定列不必贴容器右沿，溢出时 filler 宽 0、不影响 `sticky right` 偏移。原因（用户原话）：「像这些表格，左右两边间隔过大且中间没有任何信息，不会导致用户查看时候获取信息过于疲劳吗」。规范：`LIST-PAGE-SPEC` §4 列宽铁律、§9.1。已实现（2026-10-02，jfen/hint-impl）。

---

## 3. 各阶段怎么切

按**文件归属**排，不按画布节排：同一个文件只在一个阶段里改一次大的，不同阶段顺序做。

| 阶段 | 内容 | 为什么这么排 |
|---|---|---|
| S1 地基 | 十件标准件 + 回执 / 确认 / 悬停宿主 + 改动数 + 关页签 / 退出登录离开确认 + 收藏回执 + 断网回执 | 后面每个阶段都用它 |
| S2 宽表 | `useWideTable` + 月度台账、附表10、损益附表、工资、楼栋损耗 | 独立；用 S1 的 `v-tip` |
| S3 三屏 | 公共电核算、园区抄表、催缴单：画布 03–05 全部 + 这三屏的宽表接入 + 这三屏的提示件替换 | 这三屏的文件三块都要动，合给同一个实现者一次改完 |
| S4 全站替换 | 分析屏期间回退、合同待补档案、台账 / 附表10 未绑定、楼栋损耗 / 计费参数问题面板、其余各屏机械替换（confirm / alert / title / 流内条 / 加载失败）+ 两条门禁 | 按文件分批并行 |
| S5 铃铛 | 后端消息表与写入点 + 前端铃铛、面板、记号、当场出现那几条、登录页两句 | 后端与前端并行；前端动 AppShell / Toolbar / DataHome，排在 S1、S4 之后 |
| S6 收口 | 规范摘「定稿·待实现」、版本号与更新公告、全量、浏览器实测、对稿核对 | |

---

## 4. 这次不做

| 项 | 理由 |
|---|---|
| ~~各屏手写、已占住内容区的空状态约 86 处~~ | 这次已照图 ⑦ 做了（S4，见 §2 第 9 条），不再列在这里 |
| 催缴单取消确认的 `window.prompt` | ⑨ 没有输入框；规范 §7 只点名 confirm / alert。要做就给 ask 加一个可选输入框 |
| 图表读数气泡（ECharts / cz-tip / SVG）改成 500ms 悬停 | 读数要零延迟跟鼠标。外观这次已照图 ⑩ 统一成 ShellTip 同款深色气泡（S4，`chartTipLook.spec` 钉住），只是不改延迟 |
| 顶部蓝色满宽授权条 `.app-elev` | 和「不许满宽横条」冲突，但稿上没给新样子，需要你定 |
| 行内标记里整行底色、头像橙环、图表 markPoint、锁图标、行闪 | 不是「点 + 字」的形态，照旧 |
| 7 张表以外的固定列 | §9 只点名 7 张 |
| 三屏的手机 / 平板档 | 稿上没画。园区抄表 S/M 档因此还留着 `mt-hidbar`、`mt-bookbar` 两条流内条 |
| KPI 放不下换「万」为单位、撤省略号（KPI-CARD §3、PAGE-BEHAVIOR §4.4，10-01 拍板） | 计划没排；S4 只把 `KpiCard` / `AnaKpiTile` 的 `title` 换成 `v-tip`，降一档后仍是省略号 + 悬停看全 |
| 荐桌面提示行撤掉、改挂编辑入口的悬停说明（RESPONSIVE-LAYOUT §5.3，10-01 拍板） | 计划没排；台账、附表10、利润表、科目余额表、损益附表、附表12 工资的「建议在桌面端操作」行还在 |
| 数字不省略推到全站（LIST-PAGE §4 列宽铁律） | 只做了 7 张宽表（§1.8）；`FPSortableTable` 等列表表格的数字列被压窄时仍省略 |
| 表格样式（03-C）推到三屏以外 | 只做了公共电核算、园区抄表、催缴单（§1.9）；如月度台账正文仍 12px、合计仍是蓝字 |
| 列表页「过滤后 0 行」空状态的按钮（LIST-PAGE §3） | 已换成 `FPEmpty`，但合同、租户、楼栋、账号等列表都没带「清除筛选」一类的按钮 |
| 「全部页签」下拉里被省略的行的悬停说明（LAYOUT-STABILITY §4.3） | 页签本身有悬停卡片；340 宽下拉里的行没有 |
| 分析屏「未归类占比 > 5%」卡头标签与深链（BOOK-WORKBENCH §6） | 没有检测代码，不在本轮计划内 |
| `FPMoreMenu` 「…」那一版面板照 05-A 改样式 | S3 只改了带字触发钮那一版；「…」那一版代码里注明暂不动、等定（`FPMoreMenu.vue:104`） |

最后 8 行（「KPI 放不下换『万』」起）是 S6 收口对着代码核出来的：各阶段提交说明里没列，代码里也没做；前 7 行落在 S4 / S5 的范围或计划外，最后一行属 S3。

---

## 5. 门禁与验收判据

- **两条新门禁**（S4 落地）：非测试源码里 `window.confirm` / `window.alert` / 裸 `confirm(` / `alert(` 为 0；`.vue` 模板里小写原生标签及透传到原生的 ds 组件上 `title=` 为 0（白名单只放声明了 `title` prop 的组件）。各做一次破坏验证：任一文件插一处必红。
- 每条新断言逐条破坏验证：改坏实现 → 只有对应那条转红 → 还原。破坏与还原用字符串替换，不用 `git checkout`。
- 类型门禁用 `npm run typecheck`（裸跑 `vue-tsc` 不查任何文件）。判绿看产物（vitest JSON 报告里的文件数与失败数），不看管道后的退出码。
- 过程中只跑相关 spec；全量在每个阶段收口跑一次。
- 后端集成测试判绿数 surefire / failsafe 报告文件里的 tests / failures / errors。
- 视觉：S2 做完进浏览器在 1366×768 侧栏展开时实测台账（应只剩租户 + 本月结余固定、露约 8.8 行）；S3 三屏各截一张和画布对照。
