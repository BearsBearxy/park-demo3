# 侧边栏与使用动线重设计 + 审核机制（SIDEBAR-UX-REDESIGN）

2026-09-03 立档，**全部决定已拍板（D1–D20，见 §0.2）**。P1、P4、P0a、P0b、P0c 已在分支 `jfen/sidebar-ux-redesign-450c37` 实施（复查记录见各期计划末尾），其余未实施。
上游：`docs/research/2026-09-03-sidebar-ux-research/`（01 现状动线审计 · 02 同类产品调研 · 03 综合结论 · 04 方案与拍板过程）；
BOOK-WORKBENCH-SPEC §7 · RBAC-SPEC v2 · EDIT-MODE-SPEC v5 · CONCURRENCY-SPEC · RESPONSIVE-LAYOUT-SPEC · DESIGN-FIDELITY · LAYOUT-STABILITY-SPEC。
设计稿：https://claude.ai/code/artifact/521bb00c-d981-4e55-8685-5ca7fe8834f7（源文件 `_design/sidebar-redesign/`）。

---

## §0 一句话与拍板记录

### 0.1 一句话

**容器不动，内容重排，语义修对，审核加闸。** 66px 轨 + 234px 面板保留；数据层第一项改成「本月出账」工作台（现首页改名补全，零新屏）；侧栏点击从「全新重建」改为「恢复现场」；一套期间深链协议；分组按动词重切并可折叠；分析层「异常提醒中心」升到第 2 行；死 UI 清零；新增审核员角色，审过的表按「一张表 × 一个月」锁死。

### 0.2 拍板记录（2026-09-03）

| # | 决定 | 结果 |
|---|---|---|
| D1 | 侧栏点击语义：全新重建 → 恢复现场；全新退为 Shift+点击 / 关签重开 / 换层（翻 2026-07-07 §二 B3，含首页「去做事」行） | 翻 |
| D2 | 首页/清单行点击 = 显式选月，覆盖会话里已选的期；链屏处于编辑态时先确认 | 是 |
| D3 | 出账链期只记会话（2026-08-29 拍板） | 维持 |
| D4 | 银行流水：删条目 + `/bank-flow` 重定向（51 → 50 屏） | 删 |
| D5 | 收入核对搬到数据层 | 不搬 |
| D6 | 角色徽记与落地：后端 `LoginResp` 加 `roleNames`，派生作老 token 兜底；顺手修 `PresenceService` 同一遗留列 | 加字段 |
| D7 | 合同管理移入「档案」组 | 移 |
| D8 | P2 后端 `DataHomeOverviewDTO.Item` 增 `companies` / `phases` | 批 |
| D9 | KeepAlive `max` 10 → 16 | 提 |
| D10 | 页签定宽 148px（Chrome 式）换零位移 | 是 |
| D11 | 单独的锁账落库（period_close 表 + 锁账按钮） | 不做，被 D20 取代 |
| D12 | 屏名「本月出账」 | 定 |
| D13 | 迁移顺序 | P1 → P4 → P0 → P3 → P2 → R1 → R2 → P5 → (P6) |
| D14 | 审核粒度 | 一张表 × 一个月 |
| D15 | 已审核 = 只读；谁能撤销 | 只有审核员 |
| D16 | 审核员独立预置角色；财务主管默认不带审核权 | 是 |
| D17 | 待审核期间也锁 | 是 |
| D18 | 附表 6/7/8/11 年表按月审（表内按月份行锁） | 是 |
| D19 | 下游已审核时上游不能撤销 | 是 |
| D20 | 整月锁账 = 该月全部审核键已审核，派生，不落库不设按钮 | 是 |

---

## §1 诊断（摘要，证据见 01 / 03）

| 问题 | 事实 |
|---|---|
| 装不下 | 数据层面板需 913px、分析层 987px；1366×768 办公机浏览器内视口 ≈ 620 → 导航区真实可用 **≈ 509px**（620 − stage 24 − 卡边框 2 − 面板 padding 32 − 头 24 − 间隙 28 − 分割线 1）。附表 6 起 9 行在折叠线下，无 scrollIntoView（`SidebarPanel.vue:76`） |
| 点侧栏归零 | 侧栏 = `tabs.openFresh` → epoch++ → KeepAlive 重建（`SidebarPanel.vue:42-46`，`tabs.ts:85-91`，`App.vue:52-58`）；台账 `activeBookId/year/month` 屏内 ref 全清（`LedgerView.vue:48-51`）；点当前项也重建 |
| 期不带 | 首页 `go()` 不带月（`DataHomeView.vue:37-41`）；报表层期间条 push 不 openFresh，目标屏只在 setup 读 query，KeepAlive 命中时期不跟（`useFinStatementScreen.ts:101`） |
| 角色一视同仁 | 6 角色一棵树；股东 rail 只剩一钮仍占 66px；异常提醒中心是分析层第 19 行（`fpNav.ts:71`）；账号菜单只显两态（`IconRail.vue:20`） |
| 死 UI | 收藏 / 主题钮无 handler（`Toolbar.vue:43-45,65-67`）；搜索文案承诺「租户 / 凭证」实际只搜页名（`paletteFilter.ts:22-29`）；银行流水占位常驻（`fpNav.ts:30`） |
| 无审核 | 任何有 edit 权的人随时能改任何月；催缴单只有主管业务确认（`draft→confirmed→exported`，V94），台账与附表零闸 |

---

## §2 导航树（`frontend/src/nav/fpNav.ts`）

4 层不变；`NavItem / NavSection / NavLayer` 接口不加字段；51 → **50** 项。

### 2.1 数据中心

`caption` 改「本月出账 · 记账 · 导入 · 档案」；`home` 仍 `'data-home'`。

| 组 | 项（value 逐字沿用） | 默认态 |
|---|---|---|
| （无标题） | `data-home`，label **本月出账**，icon `calendar-check`（icon.ts 已登记） | 常显 |
| 档案 | `buildings` · `tenants` · `contracts`（从出账链移入） | 折叠 |
| 出账 · 每月工序 | `params` · `meters` · `alloc` · `alloc-loss` · `bill-notices` | 当前屏为 `data-home` 或组内屏时展开 |
| 记账 · 按月 | `ledger` · `sales-income` · `salary` | 折叠 |
| 记账 · 按年 | `pv-income` · `car-charging` · `ebike-charging` · `elec-cost` · `utilities` | 折叠 |
| （无标题） | `import` | 常显 |

- 月/年分组依据：后端 `DataHomeService.scheduleSources` 的 `monthly()/yearly()` 与门型（`BookMonthMatrix` vs `SchedYearGate`）一致；`utilities` 用 `SchedYearGate`，归年组。
- `bank-flow` 条目删除；`router/index.ts` VIEWS 删 `'bank-flow'` 行，加 `{ path: '/bank-flow', redirect: '/data-home' }`（与 `/price-cfg` 同款）。旧页签由 `tabs.ts:33` 的 ROUTES 过滤自动丢弃。
- 文件头注释「数据层按业务时序三组」改写为「按动词四组：档案 / 出账 / 记账（月｜年）/ 导入」；`billingChain.ts:2` 注释里的组名同步。

### 2.2 账簿与报表

不变。两个带标题组可折叠。收入核对留在本层（D5）；在「本月出账」清单里以出账列第 6 行出现，是行不是导航项。

### 2.3 经营分析

| 组 | 项 |
|---|---|
| （无标题） | `cockpit` · `anomaly`（撤销「监控」组，`fpNav.ts:71` 删） |
| 园区维度 | `park` · `park-energy` |
| 租户维度 | `tenant-energy` · `tenant-portfolio` |
| 管理公司维度 | `fin-pnl` · `fin-balance` · `fin-cashflow` · `fin-expense` |
| 经营专题 | `churn` · `expiry` · `breakeven` · `budget` · `pnl-analysis` |
| 能源专题 | `pv-roi` · `pv-meter-analysis`（icon `sun` → `table-2`）· `elec-analysis` · `charging-analysis` |

带标题组全部手风琴。`analysis/anaData.ts:58` 直读 `FP_NAV.sections` 改为 `fpAllPages().filter(p => p.layer === 'analysis')`。PV-ANALYSIS-SPEC §01 与 `fpNav.ts` 里的 PV 注释随迁。

### 2.4 系统管理

不变。

---

## §3 面板行为

### 3.1 高度预算

常量 `PANEL_BUDGET = 500`，只写在 `nav/__tests__/navHeight.spec.ts` 一处，注释写明推导（§1 第一行）。
算式（`SidebarNav.vue` 实测常量）：行 34 · 组内 gap 2（含标题到首行）· 组标题 30（`--type-label` 18 行高 + padding 6×2）· 组间 16。

| 层 | 默认态 | 最坏单组展开 |
|---|---|---|
| 数据中心 | 448（出账展开） | 448 |
| 账簿与报表 | 284（三大报表展开） | 356 |
| 经营分析 | 300 | 480 |

`navHeight.spec`：对每层断言「默认态 ≤ 500」与「任一单组展开 ≤ 500」；破坏验证 = 往「出账」组塞 3 个假项应红。

### 3.2 折叠

- 带标题组的标题行变 `button`，30px 不变，chevron `position:absolute; right:12px`；DESIGN-FIDELITY §2.3 补修订记录「组标题可点折叠」。
- 展开集合 `openTitles` 是内存态（`SidebarPanel` 内），换层清空，不落盘。
- 路由变化：**只追加**含当前屏的组，**不收回**用户手动展开的组。
- 用户手动多开、或同层内连续导航累积（只追加不收回）导致超预算 → 面板滚动；`SidebarPanel` 在 `activeValue` 变化后 `scrollIntoView({ block: 'nearest' })`（2026-09-03 P4 复查：数据层首页 → 附表12 即 556px，接受滚动、不收回）。
- 折叠组标题行右侧聚合子项在场点：`items.some(editingHere)` → 同款 6px 橙点，`title` 拼子项文案。
- 删除 `SidebarNav.vue:223-320` 不可达的折叠轨道 / flyout 分支及 `.fp-sbnav-tip / .fp-sbnav-flyout` 样式（`collapsed` prop 全仓零调用点）。

### 3.3 在场点

- `utils/lockScopes.ts` 增 `scopePeriod(scope): string | null`（`billing-chain:2025-06` → `2025-06`；`meters:2025` → `2025`；`ledger:3:2025-06` → `2025-06`；无期 → null）。
- `SidebarNav.editingHere` 上提为 `stores/presence.ts` 的 `editingNote(navValue)`，侧栏 / 清单行 / 主管条共用；文案「李四 正在编辑 · 2025-06 · 三屏共用一把月锁」，仍喂 `editScopes` 里命中前缀的锁（不喂 seat）。
- 点：`role="img"` + `aria-label` + `tabindex=0`；点按 / Enter 弹 `ds/Popover`（capture mousedown 点外关）。

---

## §4 导航语义

### 4.1 入口语义表

| 入口 | 现状 | 本稿 |
|---|---|---|
| 侧栏项（`SidebarPanel.onSelect`）/ 手机抽屉目录项（`MobileNavDrawer.goItem`） | `openFresh` | `if (value === activeValue) return; e.shiftKey ? tabs.openFresh(value) : tabs.open(value); router.push('/' + value)` |
| 轨层钮（`IconRail.goLayer`）/ 手机底栏（`MobileBottomNav`） | 点当前层也跳走 | `if (layer.id === activeLayer.id) return`；换层 `openFresh(layer.home)` + push |
| 页签 / 命令面板 / 最近 / 期间条 | `open` | 不变 |
| 关闭页签 | `dropState` | 不变（关签重开 = 全新） |
| 首页 / 清单行 | 裸 push | `period.pick(y, m)` 显式选月 + `periodLink`；**本人（本标签页）握着任一出账链 / 抄表锁时先确认**——`openFresh` 会重建目标屏，编辑中的草稿不分同月异月都会丢（2026-09-03 对抗复查 F3 裁定；P3 侧栏改恢复现场后再收窄） |
| 报表中心 / 期间条 / 分析层深链 9 处 | 各自约定，`pin:true` | 统一走 `periodLink`；pin 规则见 4.3 |
| 收入核对 → 台账 / 附10 | `openFresh({pin:true})` | 不变（spec 2026-07-07 §一） |
| `LedgerView.gotoTenants` | `open({pin:true})` | 不变 |

`App.vue` KeepAlive `:max="10"` → `16`（D9）。

### 4.2 期间深链协议（`frontend/src/nav/deepLink.ts`，唯一出口）

- `periodLink(value, { p: 'YYYY-MM', co?: number | 'all', extra? })` → `{ path: '/' + value, query: { p, co, ...extra } }`。
- `parsePeriod(query)` 接受 `p`（新）| `ym`（出账链四处旧链）| `y & m`（报表层 / 台账 / 附10 旧链）；`co` 接受 id | `'all'`；公司名只经 `company` 键 / `extra.company` 传。`nav/reportPeriod.parsePeriodQuery` 委托 `parsePeriod`（留作兼容层）；`utils/deepLink.ts` 两个解析器 P0c 已删（零消费方），旧格式用例由 `nav/__tests__/deepLink.spec` 与台账 / 附10 挂载测承接。
- 目标屏用 `composables/useDeepPeriod(apply)`：**setup 期同步跑一次**（2026-09-03 P0a 裁定：赶在各屏 `watch(ym)` 注册与 `onMounted` 取数之前落期，首跑不查 dirty；原文写 `onMounted`）；再用**已有的** `composables/onReactivated.ts`（7 屏在用，天然跳过首次 activated）跑一次；按 `route.fullPath` 去重（被拒的地址在同一实例不重试）；`parsePeriod` 为 null 或与当前 (period, co) 相同 → 不动；目标屏有未保存改动（`dirty > 0`）→ 不切期，屏内提示「地址栏要求 X 期，本期有 N 处未保存」（`FPToast` warning，下一次真的 apply 时清空）。链屏 apply 后补 `loadChain`（门被深链跳过时它是唯一加载点）。分析层「去改常数」带的 `adopt=YYYY-12` 不是选月：只在没有期时认领（`billingPeriod.adoptYm` 仅剩的调用方），不覆盖已选期（P0a 复查 P0A-2）。
- 出账链五屏：`apply` 调 `billingPeriod.pick`（不改 `adoptYm` 语义，`billingPeriod.spec:84-88` 原样）；运营账三屏 `screenPeriod.pick`（经 `useMonthGate.pick`，apply 只 pick，取数交给既有 onMounted / watch）；台账 `co` 落 `activeBookId` + `year/month` 直落宽表（没给 `co` 落当前册 / 首册 —— P0b 裁定，公司 chips 随 P2）；附10 `co` = 期区 1..4，`apply` 直写 `activeBookId` 不经 `selectBook`（P0b 实测：`selectBook` 不在深链路径上，它在表格态末行 `goGate`；`co` 缺席时旧 `?phase=` 兜底）；台账 / 附10 的 apply 是异步的（先等 books 回来）；年表屏 `p` 只取年（`current` 也只报年）；导入中心 `p` 预填表单（`ImportCenterView` 接 `useRoute`，读一次，不接 `useDeepPeriod`；台账 / 附10 / 附12 导完给「去查看」）。`extra.mode` / `extra.tab` 只在首载认（首页行走 openFresh）、不写回 localStorage。apply 后紧跟 `onReactivated` 重读（先改期后重读），有草稿不重读当前期；dirty 只在切走后草稿仍在的屏上有（附10 `dirty.size`、台账 `dirtyCount`、年表四屏开着的抽屉 / 导入窗），切走即收浮层的屏（附12、分栋抄表、分桩明细、电费成本）不传 dirty 也不加提示（P0b 复查）。
- 报表层三屏（`useFinStatementScreen` / `PnlScheduleView` / `ReconView`）接 `useDeepPeriod`，修「第二圈期不跟」；`ReportsHomeView.go()` 带 `co: 'all'`。（P0c 落地：三大报表一处改三屏，apply 异步先等公司名单，`co` 指名公司不存在不落、字符串 `co` 视同没给，只有年的链落在停在正文的缓存实例上显式回矩阵；损益附表 `current` 只报年、apply 与 dirty 闸都按年幂等、`carry` 改 ref 只在 apply 写；收入核对 `maxYear` 只由不带年的 overview 决定、无 dirty；期间条 query 改 `{p, co}`，`periodQuery` 删；`reportPeriodGate.spec` 钉九屏期间条。）
- 分析层假下钻的三个目标屏与 `anaData.ts` 五条规则 link 一并改走 `periodLink` 带 query（P0c 落地）：`ElecView` 读 `mode`（P0b 的键；改前发 `view=` 键名对不上，从未生效）+ `ElecCostView` 读 `p`；`ChargingView` 读 `mode=meter` + 子屏 `CpMeterView` 读 `station`（点桩柱带月 `p=YYYY-MM`；环图 / 费率图点的是运营商，只带 mode + 年）；`ContractsView` 读 `contractNo` 预填搜索（合同无期，不走 periodLink；切回按 fullPath 去重再读，没 query 不重置）。`AnaAnomaly.link` 仍是路径，加 `company?` / `tenant?`，消费方 `goAnom` 按 ym 组链；落 `/fin-cashflow` `/park-energy` `/churn` 的三条 `p` 今天不被消费（见 §12）。分析层 / 收入核对工作台 12 处发链统一 `periodLink`：公司名走 `extra.company`，期区走 `co`（缺席不写，S10View 落当前册），`openFresh({pin:true})` 不动（pin 规则 §4.3 归 P3）。

### 4.3 页签模型

- pin 缺省规则：来源屏正坐在 preview 槽 → 目标 `pin: true`；否则目标进 preview（`LedgerView.gotoTenants` 规则通用化，`ledgerLeaveAndReturn.spec` 三条不动）。分析层 9 处硬编码 `pin:true` 删除。
- `tabs.open` 顶掉 preview 时记录 `evicted`；**仅当被顶屏处于编辑态**（`presence` 本人 `mode === 'edit'` 且 scope 命中该屏）出 4s toast「『月度台账』预览页签已被替换 — [固定它]」（复用 `.fp-net-toast` 位置，`position: fixed`）。其余情况静默。
- `tabs` store 增内存态 `ctx: Record<value, { p?: string; coName?: string; review?: ReviewStatus }>`，`setCtx / clearCtx`；`close`/`dropState`/`logout` 清对应项；三个 localStorage 键格式不变。写入点：`billingPeriod.pick` · `screenPeriod.pick` · `LedgerView` 选册选月 · `useFinStatementScreen` 的 y/m/co 变化 · `useDeepPeriod.apply` · 审核态拉取。

---

## §5 「本月出账」屏（`views/data-home/DataHomeView.vue`，value 不变）

### 5.1 P1：改名 + 5 步 + 行带期

- `fpNav.ts:10` label「本月出账」，icon `calendar-check`。
- `DataHomeService.buildChain` 4 → 5 步：头插 `params`，`done = ps.priceTotal() > 0 && ps.priceOk() == ps.priceTotal()`，`detail = "本月电价 " + priceOk + "/" + priceTotal + " 已录"`（`paramService.status(ym)` 在 :92 已调，改为整个 DTO 传入，**不用 `stale`**——月初 pool/bill 皆 null 时 stale 恒 false 会假绿）；`stale` 继续只做 `buildBlockers` 的 `param-stale` 前置条。硬编码「恒 4 步」六处同改：`DataHomeApiIT:51`、`DataHomeView.spec.ts:151,160`、`DataHomeView.vue:79` 骨架 `v-for="i in 4"`、`DataHomeServiceTest` 六处调用与 `currentIndex` 期望 +1、service 内循环与 `new ArrayList<>(4)`、`types/dataHome.ts:32` 注释。
- 矩阵 4 颗点不变（`billingChain.ts:40-45` 判断保留）；本 spec 明写口径差：**矩阵 4 点、清单 5 步**。
- `DataHomeView.go(v)`：按 §4.1 首页行语义（链屏先 `period.pick` 再 push）；链屏行与 `reconciliation` 行走 `periodLink(v, { p })`（P0a；`ReconView` 经 `parsePeriodQuery` 的委托认 `p`）。附13/附14 的 `extra.tab = office | phase3` 与附6/7/8/11 的 `extra.mode = summary`（覆盖 localStorage 记住的运营账模式）**随 P0b 目标屏接 `useDeepPeriod` 时一起加**——目标屏读不到之前不发死参数（P0b 已加：月表行 `p=YYYY-MM`、年表行 `p=YYYY` + `mode=summary`、附13/14 行 `p=YYYY` + `tab`，按行 `tag` 分）。

### 5.2 P2：年份条 + 两栏清单 + 主管条

- 年份条复用 `BookMonthMatrix`（4 点 + 锁角标插槽；全月已审核 → ✓ 锁标，§7.2）。默认选中 = 出账链最新有数据月（现锚规则不变）。
- 两栏（1366×620 内视口下内容区 ≈ 1027 × 502，行 38px，两栏各 7-8 行，一屏装下）：

| 出账列 | 记账列 |
|---|---|
| 计费参数 · 园区抄表 · 公共电核算 · 楼栋损耗 · 催缴单 · 收入核对 · **本月锁账**（派生，D20） | 月度台账 [公司 chips] · 附表10 [期区 chips] · 附表12 · 办公·三期水电 · 附表6 · 附表7/8 · 附表11 · 导入中心 |

- 行状态**由数据派生**不可手勾：未做 / 已做 / 需重算；前置未满显 padlock（悬停 / 点按说前置）；计数源缺显「—」不显 0。行右侧审核态列（§7.5）。
- 主管条：`can('lock:takeover') || can('system:view')` 时渲染，32px 定高常驻（无待批显「暂无」，不 `v-if`）：「待批授权 N」（`presence.approvals`，开 `FPApprovalDrawer`；抽屉「页面」行改为 `periodLink` 可跳）+「谁在编辑」chips（`presence.others` 中 `mode === 'edit'`：姓名 · `scopeNote` · `scopePeriod`，点按 `periodLink`）+ 审核计数（§7.5）。审核员条见 §7.5。
- **无 `view=mine|all`**：所有人同一份清单。
- 数据契约（D8）：`DataHomeOverviewDTO.Item` 增 `companies?: [{ id, short, done, review }]`（台账按 `company_id`）与 `phases?: [{ no, done, review }]`（附10 按 slot）；`scheduleSources` 改 ≈ 20 行；审核态来自 `GET /api/review?period=` 一次拉全月（§7.4），前端在 `monthClose.logic.ts` 合并。
- `views/data-home/monthClose.logic.ts`（纯函数）：`rowsOf(cell, overview, seats, review, companies, ym) → CloseRow[]`；`closeChecks(...)` → 全月已审核判定。五步状态直接用 `chainStepsOf`（与 `ChainMonthGate` / `FPStepStrip` 同函数）。

---

## §6 外壳

| 项 | 改法 |
|---|---|
| 页签标题 | `${ROUTES[value].page} · ${ctx.p} · ${ctx.coName}` 有几段写几段；页签**定宽 148px**（`flex: 0 0 148px`，ellipsis + `title` 全文），改名不改宽；溢出下拉同款 |
| 上下文 chip | 面包屑后**常驻预留位**，定宽 132px，无期显「—」；内容 = `ctx.p · coName`，审核态时加锁/勾图标 |
| 收藏 ★ | `aria-label="固定为常驻页签"`，`@click="tabs.pin(activeValue)"` |
| 主题 ☀ | 删（`Toolbar.vue:65-67`） |
| 搜索 | 按钮文案「搜索页面 / 分组（Ctrl K）」；`fpAllPages()` 输出加派生字段 `group = section.title`（`fpBuildRoutes` 不吃）；`filterPages` 增匹配 `group`；命令面板占位「输入页面名或分组名」 |
| 角色行（`IconRail.vue:20` / `MobileNavDrawer`） | 读 `auth.roleLabel`：后端 `roleNames` 有值则显真名（多角色顿号拼）；无值按 `can('system:view')` → 系统管理员 / `can('review:approve')` → 审核员 / `can('lock:takeover')` → 财务主管 / 任一 `:edit` → 财务专员 / `navLayers` 仅 analysis → 园区股东 / 其余 → 只读账号，并标「（派生）」 |
| 后端（D6） | `UserPermissionCache.UserAuth` 加 `List<String> roleNames`（已 join `auth_user_role`）；`LoginResp` 与 `SeatDTO` 同时改读它；`FPPresenceBar.vue:59` 显真名 |
| 落地页（`navAccess.landingPath`） | 加参 `readonly`（零 `:edit`）与 `reviewer`（`can('review:approve')`）：`reviewer && navLayers.includes('data')` → `/data-home`；`readonly && navLayers.includes('analysis')` → `/cockpit`；其余沿用三档。`router/index.ts:90,106,124,130` 四处补传 |
| 基底页签 | `tabs.baseHome()` 改取 `landingPath(...).slice(1)`；`tabs.spec:80-85` 断言随改 |
| `AnaEmpty.vue:11` | 「去录入」链接按 `isLayerVisible` 显隐（股东不被引到不可见层） |
| `IconRail` 命令钮 | 补 `aria-label="搜索 / 跳转"` |

---

## §7 审核机制

### 7.1 审核键（一张表 × 一个月，D14）

| 清单行 | 键 | 备注 |
|---|---|---|
| 计费参数 | `params:YYYY-MM` | 审该月生效的参数快照 |
| 园区抄表 | `meters:YYYY-MM` | 抄表屏按年锁，审核按月：守卫按读数所属月判 |
| 公共电核算 | `alloc:YYYY-MM` | `POST /params/recalc` 也受它守 |
| 楼栋损耗 | `alloc-loss:YYYY-MM` | |
| 催缴单 | `bill-notices:YYYY-MM` | 与现有 `draft→confirmed→exported`（主管业务确认，V94）是两条轴，都保留 |
| 月度台账 | `ledger:{companyId}:YYYY-MM` | 每公司一键 |
| 附表10 | `s10:{phase}:YYYY-MM` | 每期区一键 |
| 附表12 | `salary:YYYY-MM` | |
| 办公·三期水电 | `utilities:office:YYYY-MM` / `utilities:phase3:YYYY-MM` | 附13 / 附14 |
| 附表6/7/8/11 | `pv:YYYY-MM` · `charging-car:YYYY-MM` · `charging-ebike:YYYY-MM` · `elec-cost:YYYY-MM` | 年表屏内按月份行上锁（D18） |

收入核对与报表层本轮不进审核。键格式：`kind[:scope]:period`，`kind` 白名单在后端 `ReviewKind` 枚举，`period` 恒为 `YYYY-MM`。

### 7.2 状态机（每键）

```
录入中 ──交审（录入方，需该表 edit 权）──▶ 待审核 ──通过（审核员）──▶ 已审核（只读）
   ▲                                          │                          │
   └──────────退回（审核员 + 理由）─────────────┘                          │
   ◀────────────────────────撤销审核（审核员 + 理由）─────────────────────┘
```

- 「录入中」是派生态（该键无 `review_state` 行或 `status='entered'`）；落库三态 `submitted / approved / returned`（`returned` 只是留痕，可编辑性等同录入中）。
- **待审核也锁**（D17）。
- 通过前置：`alloc` 通过需 `params` 与 `meters` 已审核；`bill-notices` 通过需 `alloc` 与 `alloc-loss` 已审核。清单行显 padlock + 原因；端点返回 409 带缺项。
- 撤销前置（D19）：下游有 `approved` 时上游 `withdraw` 返回 409「先撤销 公共电核算 / 催缴单 的审核」。依赖图只在出账链五键内；记账列各键互不依赖。
- 交审前置：该键派生状态为「已做」（清单行 done）；未做不能交审。
- 整月「本月锁账」行 = 该月**全部**审核键 `approved`（键集合 = 出账 5 + 台账公司数 + 附10 期区数 + 其余 7 张），派生（D20）；月格显 ✓ 锁标。

### 7.3 权限与角色

- `Perm.REVIEW_APPROVE = "review:approve"`，第 **18** 个权限点，进 `Perm.ALL`（角色屏矩阵自动多一行）；进不可提权名单（审核不是能当场借的权限）。交审不设独立权限点：该表的 edit 权即交审权（映射复用 RBAC-SPEC §5.2 的 kind → perm 表）。
- 新预置角色 `reviewer`「审核员」（`builtin=1`，`nav_layers='data,reports,analysis'`）：只有 `review:approve`；零 `:edit`、无 `elevate:request`。
- 六个既有角色的权限不变（D16）；例外是 `admin`：它是「全部权限」角色（V101 起每个新权限点都给它），所以也持有 `review:approve`。录审分离靠角色分配保证，系统不拦「同一账号既录又审」。
- 后端强制：四个审核端点挂 `review:approve`（submit 挂该 kind 的 edit 权）；**已审核 / 待审核态由写路径守卫拦**，与调用方持有何种 edit 权无关（主管接管锁、当场提权都过不去）。

### 7.4 后端

| 项 | 内容 |
|---|---|
| 迁移 `V124__review.sql` | `review_state(review_key VARCHAR(64) PK, kind VARCHAR(24), period CHAR(7), scope VARCHAR(16) NULL, status VARCHAR(12), submitted_by VARCHAR(64), submitted_at DATETIME, reviewed_by VARCHAR(64), reviewed_at DATETIME, reason VARCHAR(255), KEY idx_review_period (period))`；`review_log(id BIGINT PK AUTO_INCREMENT, review_key, action VARCHAR(12), actor VARCHAR(64), at DATETIME, reason VARCHAR(255), KEY idx_rl_key, KEY idx_rl_at)`；`auth_role` 插 `reviewer`；`auth_role_perm` 给 `admin` 与 `reviewer` 各插 `review:approve`（admin 是「全部权限」角色，保持这一语义） |
| 端点 | `GET /api/review?period=YYYY-MM` → `[{key, kind, scope, status, submittedBy, submittedAt, reviewedBy, reviewedAt, reason, blockedBy?: string[]}]`（含派生 `entered` 与前置缺项）；`POST /api/review/{key}/submit`（kind 的 edit 权）；`POST /api/review/{key}/approve` · `/return` · `/withdraw`（`review:approve`；return/withdraw 必带 `reason`，空则 400） |
| 守卫 | `security/ReviewGuard.assertEditable(kind, period, scope)`：查 `review_state`，`submitted / approved` → 423 LOCKED，body 统一信封，message「2024-02 A 公司月度台账 已审核（李审 2024-03-05），撤销审核后才能修改」。调用点 = RBAC-SPEC §5.2 表里所有碰期间数据的写 service，含：`ParamService`（月度键 PUT、recalc、复制上月、系数簿生效月）、`MeterService`（读数增删改、导入）、`AllocService`（生成 / 池 / 规则生效月）、`BillNoticeService`（生成 / 备注）、`LedgerService`、`S10Service`、`SalaryService`、`UtilitiesService`、`PvService`、`ChargingService`、`ElecCostService`、导入 service 各 kind 分支。守卫按被写数据的月判，不按 URL |
| 覆盖率测试 `ReviewGuardCoverageTest` | **从源码推导**：扫 §5.2 表列出的 controller 写方法 → 对应 service 方法，逐个断言方法体内调用了 `ReviewGuard.assertEditable`（或标注 `@NoReviewGuard(reason)` 的白名单例外，例外须写理由）。不用手写清单（stage-review 2026-08-31 新1 的教训） |
| 集成测试 `ReviewApiIT` | 提交 / 通过 / 退回 / 撤销；前置阻断 409；已审核后写端点 423；`review_log` 逐条落；`reviewer` 角色调写端点 403 |
| 日志 | `review_log` 进「操作日志」时间线，作第 4 张来源表（RBAC-SPEC §7 表补一行；`SystemLogsView` 类型筛选加「审核」） |
| 通知 | 交审 → 有 `review:approve` 的在线用户铃铛计数 +1（复用 `presence.approvals` 轮询通道，`FPApprovalDrawer` 加「待审核」段，行点击 `periodLink` 到清单）；退回 / 撤销 → `submitted_by` 铃铛 +1 |

### 7.5 前端

- **编辑模式闸**：`useEditMode.toggle()` 在权限检查之后、`enter()` 占锁之前查 `reviewState(kind, period, scope)`（屏声明 `opts.reviewKey?: () => string | null`，与 `opts.scope` 同风格）；`submitted / approved` 时不进，按钮位渲染同尺寸禁用药丸「待审核 · 已交审」/「已审核 · 李审 03-05」（零位移），tooltip「撤销审核需审核员」；`elevate:request` 弹窗不出现。屏内状态从 `GET /api/review?period=` 缓存在 `stores/review.ts`（按月一份，写操作后失效）。
- **屏内提示**：顶栏上下文 chip 带审核态图标；矩阵月格全审 ✓。
- **清单行**：审核态列 未交审 / 待审核 / 已审核（人 · 日期）/ 已退回（理由 tooltip）；行动作按权限：有该表 edit 权 → 「交审」（行 done 时可用）；`can('review:approve')` → 待审核行「通过」「退回」，已审核行「撤销」。台账公司 chips 与附10 期区 chips 各自带审核态色（已审 绿勾 / 待审 橙钟 / 录入中 灰底 / 未录 虚线）。
- **审核员落地**：`/data-home`；主管条位置换成审核条「待审核 N」+ 「只看待审」筛选 + 「本月已审 n/总」。
- **退回 / 撤销弹窗**：居中弹卡（DESIGN-FIDELITY §七），理由必填，确认后写 `review_log` 并刷新清单。
- **与编辑锁的关系**：审核态不占锁、不发在场点；已审核屏没人能进编辑，在场点自然消失。
- **与催缴单确认的关系**：主管「确认无误」→ 交审 → 审核员通过，三步并存；是否合并等清单跑一个月再议。

---

## §8 约束与既有规范修订

### 8.1 守住（03 §4 的 13 条）

fpNav 唯一事实源（无新字段，折叠按 `section.title` 派生）· 可见性 = `visibleLayers` 且落地页在可见层内 · tabs 三键格式不变（ctx / openTitles / evicted 全内存）· KeepAlive key = `value:epoch`（机制不变，只改侧栏入口语义，D1）· 深链协议扩展不替换 · 响应式四档、XL 轨 66 / 面板 234 不动、L/M 浮层复用同一 `SidebarPanel` · 零布局位移（页签定宽、chip 预留位、主管条定高、在场点 / 锁角标 absolute、toast fixed）· 浮层规范 · `NAV_SCOPE_PREFIX` 正反向护栏（`data-home` 不登记锁根）· index 191KB（P4 前主仓 `npm run build` 取基线，超线先瘦身）· BOOK-WORKBENCH §7（清单行点击 = 显式选期）· DESIGN-FIDELITY 像素 · 一次一屏 + 对抗复查 + 计数与屏内同源。

### 8.2 需同步修订的规范

| 文件 | 改什么 |
|---|---|
| `2026-07-07-demo3-recon-jump-tab-state-design.md` §二 | B3 侧栏 = 恢复；首页「去做事」行同条；全新 = Shift / 关签 / 换层 |
| `RBAC-SPEC.md` §2 / §3 / §4 / §6 / §7 | 第 18 权限点；`reviewer` 角色行；落地页规则；操作日志第 4 张表 |
| `RESPONSIVE-LAYOUT-SPEC.md` §4.1 / §4.2 | 底栏当前层 no-op；抽屉目录条目 = open |
| `DESIGN-FIDELITY.md` §2.3 | 组标题可点折叠（像素不变，加 chevron） |
| `BOOK-WORKBENCH-SPEC.md` §7 | 补第 7 条：清单行点击 = 显式选期，目标门被前置满足；补第 8 条：已审核 / 待审核的表任何写入口一律拒 |
| `EDIT-MODE-SPEC.md` | 编辑模式三道闸：权限 → 审核态 → 锁 |
| `CONCURRENCY-SPEC.md` | 审核态与锁正交的一段 |
| `PV-ANALYSIS-SPEC.md` §01 · `fpNav.ts` 注释 | 分析层分组随迁 |
| `LAYOUT-STABILITY-SPEC.md` | 页签定宽与 chip 预留位登记为「零位移做法」 |

---

## §9 落地顺序（每期一屏，独立上线，独立对抗复查）

| 期 | 范围 | 独立价值 | 破坏验证 |
|---|---|---|---|
| **P1** | §5.1：改名 + 5 步 + 行带期 | 落地即见 5 步；行直落该月 | 首页选 2024-02 点参数应直落（去掉 `pick` 一行应回矩阵）；后端 5 步断言；把判据改回 `stale` 月初应假绿变红 |
| **P4** | §2 + §3：动词分组、手风琴、分析层重组、删银行流水、死钮清理、`navHeight.spec`、`anaData` 改 `fpAllPages` | 三层一屏装下；高管第 2 行即异常中心 | 塞 3 假项 `navHeight` 红；`anomaly` 放回末尾 `fpNav.spec` 红；DESIGN-FIDELITY 像素比对 |
| **P0a** | `deepLink.ts` + `useDeepPeriod` + 出账链 5 屏 + `ReportsHomeView.go` | 报表中心带 co='all' | 带 p 进屏直落；同 fullPath 二次 activated 不重复取数 |
| **P0b** | 台账 / S10 / `useSchedScreen` 族 / Salary / 运营账三屏 / 导入中心 | 附表行各省一次门；导后「去查看」 | 附10 chip 深链不撞 `goGate` |
| **P0c** | 报表层三屏 + `FPStepStrip` + 分析层 9 处 + 三个假下钻目标 + `anaData` 规则 link | 报表二圈期跟随；异常一击落位 | mount → deactivate → 改 query → activate 期跟随；无 query 激活不重置 |
| **P3** | §4.1 侧栏 / 轨 / 抽屉语义 + KeepAlive 16 + §4.3 ctx / evicted + §6 页签 / chip | 导后重过门 16 次 → 0 | 关签重开仍全新；Shift 点击 epoch++；点当前项不 push；toast 仅编辑态出 |
| **P2** | §5.2 年份条 + 两栏清单 + 主管条 + 公司 chips + 后端 DTO + 在场点补全（§3.3）| 主管落地即知谁卡在哪 | 六计数任一源缺显「—」；chip 点击带 p/co；反向护栏不红 |
| **R1** | §7.3 / §7.4 后端全部 | 审过的表任何入口都改不了 | 删掉某 service 的守卫调用 → 覆盖率测试红；已审核后写端点 423 |
| **R2** | §7.5 前端全部 | 审核员有队列；录入方知道卡在谁手里 | 把 `approved` 改 `entered` → 编辑按钮出现；理由为空不能提交 |
| **P5** | §6 落地页 + 角色行 + 后端 `roleNames` + `baseHome` | 总经理直落驾驶舱；六角色真名 | zero-edit 落 `/cockpit`；`reviewer` 落 `/data-home`；自建纯管理员仍 `/sys-users` |
| P6（可选） | 命令面板「本月」组（清单未完成行进面板） | Ctrl-K 直达 | `palette.spec` 3 + 1 组 |

P4 与 P0/P3 无依赖；R1/R2 依赖 P2 的清单行；P5 最后。

---

## §10 测试面

- **不变**：`fpNav.spec` 4 层；`palette.spec` 6 条；`tabs.spec` epoch 12 条；`ledgerLeaveAndReturn.spec`；`lockScopes.spec` 护栏；8 份 flow/gate spec 的断言（只改注释口径）；`billingPeriod.spec:84-88`。
- **翻转 1 条**：`mobileNavDrawer.spec:35-42`（目录条目 epoch 0）。2026-09-03 实跑 vitest：只改 `SidebarPanel` 0 红；同改 `MobileNavDrawer.goItem` 恰 1 红。
- **改数**：`fpNav.spec` 51 → 50 并加「`contracts` 在档案组 / `anomaly` 是分析层第一组第 2 项 / 经营·能源两组存在 / `bank-flow` 不存在」；`routeMap.spec` 改「无任何屏落 PlaceholderView」+ `/bank-flow` 有 redirect；`tabs.spec:80-85` 基底页签随落地页；`DataHomeView.spec:151,160` 与 `DataHomeApiIT:51` 4 → 5；`Perm` 覆盖率回归 18 点。
- **新增**：`navHeight.spec` · `deepLink.spec`（p / ym / y&m / company 名兼容、越界丢弃、pin 规则）· `useDeepPeriod.spec`（同 fullPath 只 apply 一次；query 变更再 apply；无 p 不 apply；dirty 不切）· `sidebarPanel.spec`（当前项 no-op / open / Shift / 折叠追加不收回 / scrollIntoView）· `iconRail.spec`（当前层 guard）· `tabStripTitle.spec`（定宽、ctx 拼接、非激活签退回屏名）· `monthClose.logic.spec`（5 步与 `chainStepsOf` 同源、padlock、锁账派生、审核态映射）· `useEditMode.spec` +3（approved / submitted 不进、returned 可进）· `reviewDialog.spec`（理由必填）· `sidebarLockNote.spec` +3（期 / 折叠组聚合点 / aria）· `lockScopes.spec` +1（`scopePeriod`）· `auth.spec` +1（`roleLabel` 派生表）· 后端 `ReviewGuardCoverageTest` · `ReviewApiIT` · `V124` 迁移测试。
- 每条新断言按 memory 节奏逐条破坏验证；子 agent 写的测试由本人独立重做破坏验证。
- **P0c 例外**：`reportWorkbenchFlow.spec` 期间条断言由 `{y,m,co}` 改 `{p,co}`（发链形状迁移）；`reportPeriod.spec` 「期包」3 条随 `periodQuery` 删；`utils/deepLink.spec` 整份随模块删；`nav/deepLink.spec` 「utils/deepLink 两个解析器」1 条删；`ledgerDeepLink.spec` / `s10DeepLink.spec` 各一条只改标题。新增：`reportPeriodGate.spec`（九屏期间条源码门禁）· `reportDeepLink.spec`（附表 / 核对 10 条）· `anaDeepLink.spec`（发链形状 16 条）· `contractsDeepLink.spec`（4 条）· `reportWorkbenchFlow` +5 · `schedDeepLink` +1 · `cpMeterFlow` +2。

---

## §11 不做

- 编辑模式权限组「子集进入」/ 按出账链会话一次提权（I4）；主管审阅不占锁（I5）——**专员每月 4 次主管输密码原样保留**，§9 各期的点击数不含它。建议另立 ELEVATION-SPEC v2。
- 催缴单签发 / 作废 UI、远程授权 toast / 标题角标、主管本人一键接管、操作日志给主管（I12）；异常处置落库 / 指派（I13）。
- 四种门型统一；五处期存储合并；出账链期持久化（D3）。
- 命令面板实体搜索（需搜索端点）；页签条在场点。
- 园区股东无轨 / rail 退成 header 徽记；系统层退到轨底齿轮；分析层卡片墙；分析层公司单例与 fin 三屏左栏切换。
- 移动端布局（RESPONSIVE §11 拍板范围外）；S 档只做语义对齐，抽屉目录与桌面同一份 `NEW_NAV` 数据。
- 审核：单元格级批注、两级审核、审核时限与逾期提醒、收入核对与报表层进审核、审核态进页签标题。

---

## §12 已知边界

- 「恢复现场」只对 KeepAlive 命中成立：`max` 提 16 后覆盖专员月内 15 屏；关签 `dropState` 仍全新。
- 8 张附表屏 + 台账月表的切回重读 P0b 已补（有草稿不重读当前期）；切回且地址栏换了期时，重读会先按旧期发一趟被竞态守卫丢弃的请求（已知、接受，若要收敛改在 `useDeepPeriod` 一处）。
- 公司 chips 只在台账（公司数由 `/companies` 决定）与附10（4 期区）有；其余 7 张是园区级表。
- 报表层页签标题的写入点必须含屏内换期，否则标题假。
- 六项计数与审核键集合必须与屏内 / 后端同源，源缺显「—」——假绿栽过三次（memory）。
- 附10 期区深链直写 `activeBookId`，不经 `selectBook`，不撞 `goGate`（P0b 实测，`s10DeepLink.spec` 钉住）；chip 深链免月卡。
- 抄表屏按年锁、审核按月：同年另一月编辑态下，已审核月的读数由后端守卫拦，前端行内提示「2024-02 已审核」并禁用该月行。
- `review:approve` 进不可提权名单；客户若给主管勾了审核权，录审分离由客户自己负责，系统不拦。
- `PnlScheduleView` 的期间条在 977af27 合并时被 sed `\1` 吃掉、2026-09-04 修回；`reportPeriodGate.spec` 钉九屏（`<FPStepStrip` 与 `current=` 两断言未绑定同一标签 = 已知天花板）。
- 分析屏的期（`usePeriod`）不吃 URL：落 `/fin-cashflow` `/park-energy` `/churn` 的三条异常 `p` 暂无消费方（AnomalyView 那一列今天等于原样 push）；给 `usePeriod` 开深链入口留后期。
- `ReconView` 深链首载发两次 overview（默认年定上限 + 深链年）：接受，上限与落年解耦的代价；`overview(y)` 失败时永久转圈与改前同款。
- `ChargingView` 的 dirty 闸未按年幂等（同年不同月的链在有抽屉 / 导入窗时会误弹提示），与损益附表的裁定不一致 —— 遗留；`CpMeterView` 的 `?station=` 「只有年」pending 分支从唯一发链方不可达。
