# 侧边栏与使用动线重设计 + 审核机制（SIDEBAR-UX-REDESIGN）

2026-09-03 立档，**全部决定已拍板（D1–D20，见 §0.2）**。P1、P4、P0a、P0b、P0c、P3 已在分支 `jfen/sidebar-ux-redesign-450c37` 实施（复查记录见各期计划末尾），其余未实施。
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

- pin 缺省规则：来源屏正坐在 preview 槽 → 目标 `pin: true`；否则目标进 preview（`LedgerView.gotoTenants` 规则通用化，`ledgerLeaveAndReturn.spec` 三条不动）。分析层 **16 处、10 个文件**硬编码 `pin:true` 删除（原文写「9 处」是 P0c 之前的旧数）。（P3 落地：规则收成 store 动作 `tabs.openDeep(value)` = `openFresh(value, { pin: 来源屏正坐在预览槽 })`；**来源取 `recent[0]`** —— `open()` 每次都把目标推到队首，且 `router/index.ts` 有全局 `afterEach` 无条件 `open(v)`，所以进函数时队首必是当前屏，不必往 store 里塞「当前屏」也不必引 router 进来。`ReconWorkbench` 两处与 `LedgerView.gotoTenants` 按 §4.1 保持硬编码 pin，门禁**正向**钉住。）
- `tabs.open` 顶掉 preview 时记录 `evicted`；**仅当被顶屏处于编辑态**出 4s toast「『月度台账』预览页签已被替换 — [固定它]」（复用 `.fp-net-toast` 位置，`position: fixed`）。其余情况静默。（P3 落地：编辑态判定**不查服务端座位** —— `presence.mode` 慢一拍、`self` 又是按 user 比对不按 sid（同一人两个浏览器标签页两条座位都是 self），改用新增的 `presence.holdsEditUnder(prefix)` 直接读本地 `editCallbacks`，前缀边界与 `editorsUnder` 逐字同规则；屏 → 锁根走现成的 `NAV_SCOPE_PREFIX`。载体不是 `FPToast`（它没有动作按钮插槽），是 `AppShell` 里 `.fp-net-toast` 的兄弟块；两条同时在场靠 `.stacked` 上移一格，**S 档要单独再抬一次** —— `@media` 不加特异度，桌面那条 `bottom:84px` 在手机上照样赢。`evicted` 在编辑态判断**之前**就清掉，否则非编辑态那次不清、同一屏第二次被顶时值没变、watch 不触发。）
- `tabs` store 增内存态 `ctx: Record<value, { p?: string; coName?: string; review?: ReviewStatus }>`，`setCtx / clearCtx`；`close`/`dropState`/`logout` 清对应项；三个 localStorage 键格式不变。（P3 落地：`review?` 归 R2，本期只有 `p?` / `coName?`；`setCtx` 是**整条替换**不是浅合并 —— 期变了公司也可能变，合并会把上一家公司的名字留在标题里。**五个写入点收在 `composables/useDeepPeriod` 一处** watch：接了深链的 18 处屏本来就都经过这条路，而那里天然拿得到「我是哪个页签」（`route.meta.value`）与「期变了」的时机；分散写则要给 `useMonthGate` / `billingPeriod` 造出「我在哪个页签」的知识。**ctx 的取值不复用 `current().p`** —— 三大报表与收入核对停在选期矩阵 / 月份层时 `current.p` 是光秃秃一个年份（那是 P0c 为「只有年的链停在矩阵」造的相等条件，不是用户选了期），照抄会在页签上写出用户没点过的期；opt 是一个 `ctx?: () => { p, coName? }`，只有台账 / 三大报表 / 附10 / 收入核对传。「logout 清」见 §12 遗留。）

---

## §5 「本月出账」屏（`views/data-home/DataHomeView.vue`，value 不变）

### 5.1 P1：改名 + 5 步 + 行带期

- `fpNav.ts:10` label「本月出账」，icon `calendar-check`。
- `DataHomeService.buildChain` 4 → 5 步：头插 `params`，`done = ps.priceTotal() > 0 && ps.priceOk() == ps.priceTotal()`，`detail = "本月电价 " + priceOk + "/" + priceTotal + " 已录"`（`paramService.status(ym)` 在 :92 已调，改为整个 DTO 传入，**不用 `stale`**——月初 pool/bill 皆 null 时 stale 恒 false 会假绿）；`stale` 继续只做 `buildBlockers` 的 `param-stale` 前置条。硬编码「恒 4 步」六处同改：`DataHomeApiIT:51`、`DataHomeView.spec.ts:151,160`、`DataHomeView.vue:79` 骨架 `v-for="i in 4"`、`DataHomeServiceTest` 六处调用与 `currentIndex` 期望 +1、service 内循环与 `new ArrayList<>(4)`、`types/dataHome.ts:32` 注释。
- 矩阵 4 颗点不变（`billingChain.ts:40-45` 判断保留）；本 spec 明写口径差：**矩阵 4 点、清单 5 步**。
- `DataHomeView.go(v)`：按 §4.1 首页行语义（链屏先 `period.pick` 再 push）；链屏行与 `reconciliation` 行走 `periodLink(v, { p })`（P0a；`ReconView` 经 `parsePeriodQuery` 的委托认 `p`）。附13/附14 的 `extra.tab = office | phase3` 与附6/7/8/11 的 `extra.mode = summary`（覆盖 localStorage 记住的运营账模式）**随 P0b 目标屏接 `useDeepPeriod` 时一起加**——目标屏读不到之前不发死参数（P0b 已加：月表行 `p=YYYY-MM`、年表行 `p=YYYY` + `mode=summary`、附13/14 行 `p=YYYY` + `tab`，按行 `tag` 分）。

### 5.2 P2：年份条 + 两栏清单 + 主管条

- 年份条复用 `BookMonthMatrix`。**落地形状（P2 实施，2026-09-06）**：
  - 锁角标是 `MonthCell.locked?: boolean` **字段不是插槽**（该组件全文零 `<slot>`，加具名插槽要动 7 个调用点与 4 份快照类断言），
    且必须是**独立 absolute 角标**、不进 `pips → badge → rowCount → 空` 那条 `v-else-if` 互斥链 ——
    年份条恒传 pips，写进链里锁标一次都画不出来，而那种用例接对接错都绿。**本期 `locked` 无调用方**（全月已审核归 R1 §7.2），它是那一期的落点。
  - 年份行取 `ov.months`（后端 `allMonths` 明发的「链 ∪ 附表」全集），**不取 `billingPeriod.dataYears`** ——
    后者只有链的四个源，只有附表数据的年整年点不进去，而「切到 2025-06 补台账」正是这屏最常用的一步。`hasData` 同源。
  - 链数据未到（`billingPeriod.loaded` 为 false）时**整个 `pips` 字段不给**：四颗灭点会被读成「这个月一道工序没走」。
  - 首页传 `manageYears: false`（新增可选 prop，默认 `true`，其余 7 个调用点零改动），隐藏「补更早年份 / 添加次年 / 行尾移除」——
    总览屏这条是导航不是账册管理（在这儿「添加 2027 年」不产生任何数据），且省约 80px 竖向空间。
  - 默认选中 = 出账链最新有数据月（现锚规则不变）；**描边跟当前显示月走**，不是 `ChainMonthGate` 那套「最近有数据月」。
  - 本屏因此成为链数据的常驻消费者：`onMounted` 补 `loadChain`，并登记进 `readScreenRefresh` 的 `REACTIVATED_SCREENS` ——
    切走再切回不重取 `ov` 的话，年份条读的是活的 `billingPeriod.cells`、两栏板子读的是只取一次的旧快照，**同屏对同一件事说反话**
    （实测：抄完读数点回首页，该月第一颗工序点已亮而正下方那一行仍显「○ 未做」；新月更因 `hasData` 仍为 false 被 `v-if="m.hasData && m.pips"` 吞掉整组点、画成虚线「空」卡）。
  - `buildYearRows` 自带年份钳位（`currentYear-30 .. +9`，与 `utils/yearGate.ts` 同源），调用方另用 `inYearWindow` 先滤脏年 ——
    **两道都要**：钳位只保证一条 `'0001-01'` 不撑爆堆内存（实测过 OOM），滤掉才不会把年份条从 4 行拉成 31 行。
- 两栏（1366×620 内视口下内容区 ≈ 1027 × 502，行 38px，两栏各 7-8 行，一屏装下）：

| 出账列 | 记账列 |
|---|---|
| 计费参数 · 园区抄表 · 公共电核算 · 楼栋损耗 · 催缴单 · 收入核对 · **本月锁账**（派生，D20） | 月度台账 [公司 chips] · 附表10 [期区 chips] · 附表12 · 办公·三期水电 · 附表6 · 附表7/8 · 附表11 · 导入中心 |

- 行状态**由数据派生**不可手勾：未做 / 已做 / 需重算；前置未满显 padlock（悬停 / 点按说前置）；计数源缺显「—」不显 0。行右侧审核态列（§7.5）。
- **落地（P2 实施）**：出账列 7 行、记账列 8 行 —— 后端**仍是 9 个附表源**，附13+附14 / 附7+附8 各并一行、加导入中心，
  这一折全部在前端 `views/data-home/monthClose.logic.ts` 里做，`Schedules(done, 9, items)` 的 9 **不动**。
  - **屏上的计数从渲染出来的行算**，不抄 DTO 的 `total`（§8.1 计数与屏内同源），且**结构性恒 `na` 的行不进分母**
    （导入中心无「本月导没导」的源、本月锁账等 R1）—— 所以今天是**记账 n/7、出账 n/6**。分母若含永远做不完的行，
    「记账 7/8」就永远差一格，用户会去找那一格是什么。等 R1 让锁账变真状态、导入中心拿到账期，分母自己长回 8 和 7。
  - **有 chips 的行，行 done 收严成「所有 chip 都 done」**：改前台账「任一公司有行」即 done，而同一行右边并排挂着两个灰 chip，一行之内自相矛盾。
    ⚠ 实现必须按 `chips.length` 守 —— `companies` / `phases` 线上发 null 时 chips 是空数组，`[].every()` 恒 true，不守会把 todo 翻成 done。
  - **chips 是「这一行有子入口」的通用装置**，不只给公司 / 期区：附13+附14 出「办公」/「三期」两个 chip、附7+附8 出「汽车」/「电动车」两个，
    各带自己的 `tab` 或 nav value —— 合并成 8 行之后，P0b 立的每一个深链入口都还在。
  - 两栏按**业务时序**固定排序，取消 P1 的「未录在前、已录在后」（那是给一排扁平胶囊用的可供性，两栏板子里它会让「月度台账」跳来跳去）。
- 主管条：`can('lock:takeover') || can('system:view')` 时渲染，32px 定高常驻（无待批显「暂无」，不 `v-if`）：「待批授权 N」（`presence.approvals`，开 `FPApprovalDrawer`；抽屉「页面」行改为 `periodLink` 可跳）+「谁在编辑」chips + 审核计数（§7.5，**归 R1**）。审核员条见 §7.5。
  - **chips 落地（P2 实施）**：`presence.others` 中 `mode === 'edit'` 且握着锁的座位，**一人一枚**（`presence.others` 的单位是**座位不是人**，
    同一个人开两个标签页会出两枚一模一样的 chip，主管读成两个人在抢 —— 按 `user` 去重，与 `presence.editingNote` 按 sid 去重同源），取 `editScopes[0]`。
  - **文案与目的地用两个不同的源**：
    文案中段用**座位自带的 `label`**（`AppShell` 按 `route.path` 实时写的「层名 · 屏名」）—— 那才是「这个人此刻真的在哪一屏」；
    目的地用 `utils/lockScopes.scopeTarget(scope)`。
    ⚠ **不能拿目的地当文案**：出账链三屏与系数簿共用一把 `billing-chain` 月锁，`navOfScope` 按声明序取第一个（对目的地是要的确定性），
    握这把锁的人**四分之三的时候不在计费参数屏**，照抄就会言之凿凿写错屏名。
    ⚠ 也**不用 `scopeNote()`** 当文案：它返回的是一整句解释（「……锁住一个就是锁住四个」），32px 一行装不下。
  - **点跳必须带上锁 scope 的第二维**（`scopeTarget` 就是为此存在）：台账的公司 id、附10 的期区、三大报表的公司、附13/14 是哪一张。
    只发期的话会落到目标屏的**默认子视图**，而那里恰恰没有人在编辑 —— 主管点了「张三卡在月度台账」，到了首册看到一片风平浪静，
    正好把这条 chip 存在的理由反过来。（充电桩不用特判：`NAV_SCOPE_PREFIX` 已把 `sched:charging:7` / `:8` 分成两个 nav value。）
  - 抽屉「页面」行改为 `periodLink` 可跳 —— **推后**，见 §12（提权 DTO 无 nav 无规范化的期，10 个调用点各自拼字符串）。
- **无 `view=mine|all`**：所有人同一份清单。
- 数据契约（D8）：`DataHomeOverviewDTO.Item` 增 `companies?: [{ id, short, done, review }]`（台账按 `company_id`）与 `phases?: [{ no, done, review }]`（附10 按 slot）；`scheduleSources` 改 ≈ 20 行；审核态来自 `GET /api/review?period=` 一次拉全月（§7.4）—— **归 R1**；P2 的 `companies[]` / `phases[]` **只发 `done` 不发 `review`**
（审核机制在仓里一行都没有：`review_state` / `review_log` / `GET /api/review` / `ReviewGuard` / `Perm.REVIEW_APPROVE` 全仓 grep 命中 0）。
另：台账公司全集取 `management_company` 且**按 `status = 1` 过滤** —— 停用的公司会永远占着「该录几家」的分母、板子清不干净。
三个年度源（附6 光伏 / 附7·8 充电 / 附11 电费）加一道 `acctMonth` 过滤，**改前一月录了数据十二月仍显「已录」**，这是删掉一个假绿不是回归。
- `views/data-home/monthClose.logic.ts`（纯函数）：`rowsOf({ overview, recon, review }) → CloseRow[]`；`closeChecks(rows)` → 两栏计数与全月已审核判定。
  `review` 本期恒传 `null`（审核机制归 R1），行右侧审核态列渲染「—」。
- ⚠ **清单五步一律读 `overview.chain.steps[i].status`，绝不用 `chainStepsOf`**（P2 执行中被对抗复查坐实的阻断）：
  `nav/billingChain.ts` 里 `chainStepsOf` 的第一步是 `{ ...CHAIN[0], state: c.stale ? 'stale' : 'done' }` —— **计费参数恒 done**，
  那是**矩阵 4 点**的口径（同文件注释写明理由：「这个月配过参数没有」对参数不是一个有答案的问题）。
  清单要的是 P1 立的另一套判据 `priceTotal > 0 && priceOk == priceTotal`，它只在后端算、只在 `overview.chain.steps[].status` 里。
  照 §5.1 原文「**矩阵 4 点、清单 5 步**」两套口径：`chainStepsOf` 只喂年份条格子的 pips / stale。
  叠加时序还有第二重理由：清单先于年份条落地，那时 `billingPeriod.cellOf()` 恒返回全 false 的 EMPTY，照 `chainStepsOf` 走会得到
  「参数 done + 四步 todo」的固定假象，与后端无关。

---

## §6 外壳

| 项 | 改法 |
|---|---|
| 页签标题 | `${ROUTES[value].page} · ${ctx.p} · ${ctx.coName}` 有几段写几段；页签**定宽 148px**（`flex: 0 0 148px`，ellipsis + `title` 全文），改名不改宽；溢出下拉同款 |
| 上下文 chip | 面包屑后**常驻预留位**，定宽 132px，无期显「—」；内容 = `ctx.p · coName`，审核态时加锁/勾图标 |
| 收藏 ★ | `aria-label="固定为常驻页签"`，`@click="tabs.pin(activeValue)"` |
| 主题 ☀ | 删（`Toolbar.vue:65-67`） |
| 搜索 | 按钮文案「搜索页面 / 分组（Ctrl K）」；`fpAllPages()` 输出加派生字段 `group = section.title`（`fpBuildRoutes` 不吃）；`filterPages` 增匹配 `group`；命令面板占位「输入页面名或分组名」 |
| 角色行（`IconRail.vue:20` / `MobileNavDrawer`）✅ | 读 `auth.roleLabel`：后端 `roleNames` 有值则显真名（多角色顿号拼）；无值按 `can('system:view')` → 系统管理员 / `can('review:approve')` → 审核员 / `can('lock:takeover')` → 财务主管 / 任一 `:edit` → 财务专员 / `navLayers` 仅 analysis → 园区股东 / 其余 → 只读账号，并标「（派生）」。⚠ 派生表里**没有「总经理」这一档**：总经理与只读账号的权限完全相同（V101 头注写死），派生只能算出「只读账号」——「（派生）」那三个字因此是必需的，不标就是让人以为系统认得他。药丸 `max-width:176px` + 省略号：兼岗真名是顿号拼的，不封顶会撑宽账号浮层 |
| 后端（D6）✅ | `UserPermissionCache.UserAuth` 加 `List<String> roleNames`（已 join `auth_user_role`）；`LoginResp` 与 `SeatDTO` 同时改读它；`FPPresenceBar.vue:59` 显真名（零改动，它读的就是 `SeatDTO.role`）。⚠ **是 7 个预置角色不是 6 个** —— `reviewer` 是 R1 的 V124 加的，本行写于它之前 |
| 落地页（`navAccess.landingPath`）✅ | 加参 `readonly`（零 `:edit`）与 `reviewer`（`can('review:approve')`）：`reviewer && navLayers.includes('data')` → `/data-home`；`readonly && navLayers.includes('analysis')` → `/cockpit`；其余沿用三档。**两档次序不能反** —— 审核员本身零 `:edit`（D16 录审分离），readonly 在前会把他也送去驾驶舱。⚠ 调用点是**六处不是四处**：规范只点了 `router/index.ts` 那四处，`LoginView` 与 `ChangePasswordView` 也各调一次。实施时四个判据收进 `auth.landing` 一个 computed，六处全改读它 —— 各传一遍的话漏传一个不报错，只是那条路径悄悄回到旧的三档 |
| 基底页签 ✅ | `tabs.baseHome()` 改取 `auth.landing.slice(1)`；`tabs.spec` 的默认身份改成「带一颗 `:edit` 的财务专员」（零权限的 store 会被判成只读 → 落驾驶舱，而那几条讲的是页签模型本身）。顺带收 P3 遗留：换人时整体重置 `tabs` / `preview` / `recent` / `epoch`（依赖 watcher 默认 `flush:'pre'` —— `login()` 里 `me` 比 `permissions` 先赋值，同步执行会拿上一个人的权限算落地页） |
| `AnaEmpty.vue:11` ✅ | 「去录入」链接按 `isLayerVisible` 显隐（股东不被引到不可见层）。判在**组件里**而不是 17 个调用点：调用点只知道自己缺什么数、不知道看的人是谁，且漏掉一处不报错。`to` 先剥 `/` 与 query 再查导航表；查不到的目标一律放行（认不出来是导航表的问题，不该表现成「链接凭空少了一个」）。说明文字照旧全给 |
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
| 附表6/7/8/11 | `pv:YYYY-MM` · `charging-car:YYYY-MM` · `charging-ebike:YYYY-MM` · `elec-cost:YYYY-MM` | 年表屏内按月份行上锁（D18）。`elec-cost` = 附表11 的**报送台账**（`elec_record` / `ElecService` / `/api/elec`）—— 清单行 `go='elec-cost'` 的 done 判据读的就是它 |
| （无清单行） | `elec-model:YYYY-MM` | **园区电费模型**（`elec_cost_entry` / `ElecCostService` / `/api/elec-cost`），2026-09-07 用户拍板与上一行拆成两把键 |

附表11 一屏两本账（`ElecView` 左栏 `BookRailShell`），数据分躺两张表，故两把键。`elec-model` 没有清单行，随之两条：交审前置不走「清单行 done」，改判**该月 `elec_cost_entry` 有行**；且**不进整月锁账的键集合**（见 §7.2）—— 否则锁账永远达不成，且 P2 已落地的六项计数要跟着改（§12：计数与审核键集合必须与屏内同源，假绿栽过三次）。

收入核对与报表层本轮不进审核。键格式：`kind[:scope]:period`，`kind` 白名单在后端 `ReviewKind` 枚举（14 个），`period` 恒为 `YYYY-MM`。

**交审权限用的 kind → perm 表是新写的一张，不是复用 RBAC-SPEC §5.2**（§7.3 原文那句「映射复用」不成立）：§5.2 是 126 条 **URL 路径 → 权限点**的有序表，且该映射对 `params`（policy / monthly 两档）与 `elec-cost`（`/api/elec-cost/price-cfg` 归 param-policy、其余归 entry）根本不是函数。表落在后端 `ReviewKind` 枚举的 `perms()` 上，同步记在 RBAC-SPEC。

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
- 撤销前置（D19）：下游有 `approved` 时上游 `withdraw` 返回 409「先撤销 公共电核算 / 催缴单 的审核」。依赖图只在出账链五键内；记账列各键互不依赖。完整的上游 → 下游图**比通过前置多两条边**：

  ```
  params → { alloc, alloc-loss }      meters → { alloc, alloc-loss }
  alloc  → { bill-notices }           alloc-loss → { bill-notices }
  ```

  多出的 `params → alloc-loss` 与 `meters → alloc-loss` 是 R1 实施时补的：池结果与损耗结果是 `AllocService.generate(ym)` **同一次**算出来的，同样吃 meters 的读数与 params 的电价。只照通过前置那两条连的话，「meters 已审 → alloc-loss 已审 → 撤 meters」这条路会放行，抄表员改完读数，已审核的损耗结果就和读数对不上了。
- 交审前置：该键派生状态为「已做」（清单行 done）；未做不能交审。判据**复用 `DataHomeService.overview(ym)`**，不另写一份（METRIC-SOURCE-SPEC §1：同一件事不许有第二份实现）；代价是每次交审跑一遍首页聚合，交审低频，接受。例外是 `elec-model`（无清单行）：判「该月 `elec_cost_entry` 有行」。
- 整月「本月锁账」行 = 该月**全部**审核键 `approved`（键集合 = 出账 5 + 台账公司数 + 附10 期区数 + 其余 7 张），派生（D20）；月格显 ✓ 锁标。`elec-model` **不计入**这个集合（它没有清单行，见 §7.1），所以「其余 7 张」仍是 7。后端 `ReviewKind.countsTowardMonthClose()` 是这条的唯一落点。

### 7.3 权限与角色

- `Perm.REVIEW_APPROVE = "review:approve"`，第 **18** 个权限点，进 `Perm.ALL`（角色屏矩阵自动多一行）；进不可提权名单（审核不是能当场借的权限）。交审不设独立权限点：该表的 edit 权即交审权（映射复用 RBAC-SPEC §5.2 的 kind → perm 表）。
- 新预置角色 `reviewer`「审核员」（`builtin=1`，`nav_layers='data,reports,analysis'`）：只有 `review:approve`；零 `:edit`、无 `elevate:request`。
- 六个既有角色的权限不变（D16）；例外是 `admin`：它是「全部权限」角色（V101 起每个新权限点都给它），所以也持有 `review:approve`。录审分离靠角色分配保证，系统不拦「同一账号既录又审」。
- 后端强制：四个审核端点挂 `review:approve`（submit 挂该 kind 的 edit 权）；**已审核 / 待审核态由写路径守卫拦**，与调用方持有何种 edit 权无关（主管接管锁、当场提权都过不去）。

### 7.4 后端

| 项 | 内容 |
|---|---|
| 迁移 `V124__review.sql` | `review_state(review_key VARCHAR(64) PK, kind VARCHAR(24), period CHAR(7), scope VARCHAR(16) NULL, status VARCHAR(12), submitted_by VARCHAR(64), submitted_at DATETIME, reviewed_by VARCHAR(64), reviewed_at DATETIME, reason VARCHAR(255), KEY idx_review_period (period))`；`review_log(id BIGINT PK AUTO_INCREMENT, review_key, action VARCHAR(12), actor VARCHAR(64), at DATETIME, reason VARCHAR(255), KEY idx_rl_key, KEY idx_rl_at)`；`auth_role` 插 `reviewer`；`auth_role_perm` 给 `admin` 与 `reviewer` 各插 `review:approve`（admin 是「全部权限」角色，保持这一语义） |
| 端点 | **R2 加了两条读端点**：`GET /api/review/states?year=YYYY`（闸道 —— 只发已落库的行，不跑聚合、不发派生 `entered`、不算前置；12 个编辑入口都走它，年表屏一屏 12 个月一趟）与 `GET /api/review/closed-months`（整月全审的月集合，年份条月格的 ✓，与四个 `/months` 端点同形）。原有：`GET /api/review?period=YYYY-MM` → `[{key, kind, scope, status, submittedBy, submittedAt, reviewedBy, reviewedAt, reason, blockedBy?: string[]}]`（含派生 `entered` 与前置缺项）；`POST /api/review/{key}/submit`（kind 的 edit 权）；`POST /api/review/{key}/approve` · `/return` · `/withdraw`（`review:approve`；return/withdraw 必带 `reason`，空则 400） |
| 守卫 | `security/ReviewGuard`，三个重载：`assertEditable(kind, period, scope)`（单月）· `assertEditable(kind, Collection<period>, scope)`（一批跨多月，文案点名最早的锁月）· `assertNoLockedMonth(kind, scope)`（拿不到被写月时的兜底，用于 `LedgerService.rechain` 与参数长期默认行）。查 `review_state`，`submitted / approved` → **`ResultCode.LOCKED(423)`，仍走 HTTP 200 + `body.code=423`**（项目口径，见 `GlobalExceptionHandler` 头注释；不是真发 HTTP 423）。与 409 分开：409 是「上游没审完」的前置冲突，423 是「这张表本月已审 / 待审」，合成一个码前端就分不出「去催上游」和「去找审核员撤销」。message「2024-02 A 公司月度台账 已审核（李审 2024-03-05），撤销审核后才能修改」。<br>调用点 = RBAC-SPEC §5.2 表里所有碰期间数据的写 service，共 **12 个 / 67 个写方法**：`ParamService`（守 `req.acctMonth()` **不守形参 ym** —— ym 是 URL 月）、`MeterService`（改月的读数**旧月新月都判**）、`AllocService`（`generate` 一次守 `alloc` 与 `alloc-loss` **两把键**）、`BillNoticeService`、`LedgerService`、`S10Service`、`SalaryService`、**`OfficeService`**（附13/14；spec 原写的 `UtilitiesService` 不存在）、`PvService`、`ChargingService`、**`ElecService`**（附表11 报送台账 = `elec-cost` 键）、**`ElecCostService`**（园区电费模型 = `elec-model` 键）。导入不是独立 service，是这些类各自的 `importRows`。守卫按被写数据的月判，不按 URL。<br>**本轮不进审核并用 `@NoReviewGuard(reason)` 标注**：`PvMeterService` / `CpMeterService`（光伏、充电桩分栋抄表 —— 是附表6/7/8 的**下游**派生第二本账，依赖方向是附表 → 抄表）、`BookService`（已有同型守卫 `assertMonthEditable`，P6 录入即冻结） |
| 覆盖率测试 `ReviewGuardCoverageTest` | **从源码推导**，四步链：① 读 `PermissionRegistry` 源码抓出全部 `add(...)` 的 URL pattern ② 匹配 controller 的 `@RequestMapping` ③ 找非 GET 端点方法调的 service 方法 ④ 断言该方法体含 `reviewGuard.assert` 或方法上有 `@NoReviewGuard(reason)`（例外须写理由，且理由非空有断言）。不用手写清单（stage-review 2026-08-31 新1 的教训）。<br>三条不许省的自证：**任一步解析不出来一律 `fail()` 并打印是哪个 controller 的哪个方法，不许 `continue`**（「解析不了就跳过」是这类测试最常见的假绿源，一个正则失配能悄悄放掉半张表）；`hasSizeGreaterThan(60)` 防空扫（照 `PermissionCoverageTest` 那条 `hasSizeGreaterThan(150)`）；`everyReviewKindIsGuardedSomewhere` —— 14 个 kind 每个至少在某个 service 源码里出现一次，少一个就是「审了却锁不住」，屏上显示已审核而数据照改，是最坏的一种假绿。白名单也设上限（超过 25 条就该重想），它是例外不是常态 |
| 集成测试 `ReviewApiIT` | 提交 / 通过 / 退回 / 撤销；前置阻断 409；已审核后写端点 423；`review_log` 逐条落；`reviewer` 角色调写端点 403 |
| 日志 | `review_log` 进「操作日志」时间线，作第 4 张来源表（RBAC-SPEC §7 表补一行；`SystemLogsView` 类型筛选加「审核」） |
| 通知 | 交审 → 有 `review:approve` 的在线用户铃铛计数 +1。**复用的是 ping 这条轮询「通道」，不是 `approvals` 那个字段** —— 后者是定向的（`inboxOf(approver)`）、2 分钟 TTL、纯内存，承不了持久的待审队列。落点：`PingResp` 新增第 5 个组件 `int pendingReviews`（javadoc 那句「一条通道四件事」同步改成五件事）；受众判定复用 `UserPermissionCache`（ping 路径上唯一零 DB 的权限查询），无该权限者恒 0 不查库。**只发个数不发清单** —— ping 是 3 秒一拍，发清单等于每 3 秒推一遍全月审核态；要清单去 `GET /api/review`。<br>**R1 / R2 的边界就画在这个字段上**：后端发它 = R1；前端读它、进 store、并进铃铛计数、`FPApprovalDrawer` 加「待审核」段 = R2（**已落地**）。<br>R2 另开了第 6 个字段 `int myReturned`（「我交的表被退回了几张」）：从 `review_state WHERE status='returned' AND submitted_by=me` 派生，**零迁移且自清**（重新交审时 `submit()` 把 status 翻回 submitted，数自己掉下去，不需要已读位）。**撤销没有对应字段，也做不到** —— `withdraw` 是删行，`submitted_by` 随行没了，见 §12。铃铛红点 = 三件事的总和（授权 + 待审 + 被退回），抽屉里分三段；两段都只给「几件 + 一个去处」，清单去本月出账屏 |

### 7.5 前端

> 以下为 **R2 实施后的落地形状**（2026-09-07）。设计期原文有五处与实际不符，逐条写明偏离与理由 —— 照原文改回去会重新打开对应的洞。

- **编辑模式闸有三条路，不是一条**（偏离 ①）。全仓只有三个地方持编辑态：
  - `composables/useEditMode.ts`（10 屏）
  - `components/sched/SchedHeader.vue`（附表族 7 屏 —— 它自己接了一份 `useEditLock`，**不走 `useEditMode`**，见其头注）
  - `views/ledger/LedgerWideTable.vue`（宿主 `LedgerView` 是裸的 `const edit = ref(false)`，前两条都不沾）

  三条各接一次，判据共用 `stores/review.ts` 的 `blockOf(keys)` 一份。只改 `useEditMode` 等于放过一半的审核键。
- **闸落在 `enter()`，不是 `toggle()`**（偏离 ②）。`toggle` / `onElevated`（主管授权后）/ `onTaken`（接管后）三条路都汇进 `enter()`；只挂 `toggle` 的话，叫主管授权进来的人和接管进来的人照样改得了已审核的表 —— 而 §7.3 明写这两条路都过不去。`toggle()` 里另留一道，位置在**提权窗之前**（否则已审核的表会先弹「请主管授权」，主管批完再被挡回来，白叫一次主管；即原文那句「`elevate:request` 弹窗不出现」）。
- **闸只读已经到手的审核态，不在点击那一下 await 网络**（偏离 ③）。取数在进屏 / 换期的 watch 里发；把它放进点击的关键路径会让每次进编辑态多等一个往返。真赶在取数落地之前点进来，由「在编辑态里被审了就退出」那条守卫拉回来。
- **审核态拉不到 / 还没到 ⇒ 不挡**（偏离 ④），与旁边编辑锁的「拿不准就不进」**故意相反**：锁失灵会两人同改同保存、双方都提示成功（静默丢数据，不可逆）；审核态失灵后端那道闸照样拦，最坏是白录一次。
- 屏声明 `reviewKey`（`useEditMode` 传函数 `() => string | string[] | null`；`SchedHeader` / `LedgerWideTable` 传 prop）。一屏可压多把键（公共电核算屏同时管 `alloc` 与 `alloc-loss`），**任一把锁着就锁**。
- 按钮位渲染同尺寸禁用药丸「待审核 · 已交审」/「已审核 · 李审 03-05」（零位移，逐项对齐 `ds/Button` 的 `size="sm"`），tooltip「撤销审核需审核员」。文案在 `types/review.ts` 的 `reviewNoteOf` 一份，三条闸共用。
- **两条取数道，别混**：闸道 `GET /api/review/states?year=`（只发已落库的行，不跑聚合、不算前置；按年缓存，年表屏一屏 12 个月一趟）；清单道 `GET /api/review?period=`（全部键含派生 `entered` + 通过前置缺项，只有本月出账屏用）。混用的后果：拿闸道当清单会把「还没交审」显示成「这个月没有这张表」；拿清单道喂闸会让 12 个屏的编辑入口挂在跑首页聚合的端点上。
- **年表屏按月份行上锁**（D18）：附6/7/8/11 与附13/14 是一屏 12 个月的行，闸不能长在页头那颗按钮上（会连没审的月一起锁死）。锁月的行：删除位换同尺寸锁标、备注只读、勾选框禁用；`toggleSelect` 与 `selectAll` 两处都拦（只画 `disabled` 拦不住批删）。判据在 `useSchedScreen` 的 `reviewKinds` / `reviewScope` 与 `sched/reviewLock.ts`，四屏共用。
- **屏内提示**：矩阵月格全审 ✓（`BookMonthMatrix.locked` ← `ChainCell.closed` ← `GET /api/review/closed-months`）。顶栏上下文 chip 的审核态图标**不做**，理由见 §12。
- **清单行**：审核态列 未交审 / 待审核 / 已审核（人 · 日期）/ 已退回（理由 tooltip）。**行动作作用于该行全部适用的键**（偏离 ⑤）：台账每公司一把、附10 每期区一把、附13/14 两个 scope、附7/8 两个 kind，一共占 19 把键里的 8 把 —— 原文只给 chips 配了颜色，没说这 8 把的动作挂哪儿，只给单键行配动作的话它们在全站一个入口都没有。交审按 chip 各自的 done 判（只录了 A 公司就只交 A 公司）；多键逐把做，碰到第一个失败就停。
- 行动作按权限：有该表 edit 权 → 「交审」（**行没做完时画得出来但按不动**，直接不画会让人以为界面坏了；「有没有这张表的 edit 权」是粗判，见 §12）；`can('review:approve')` → 待审核行「通过」「退回」，已审核行「撤销」；通过前置缺项时「通过」禁用并点名缺谁。台账公司 chips 与附10 期区 chips 各自带审核态色（`data-review` 与既有 `data-done` **两维叠加** —— 合成一个属性就分不出「已录未交审」和「已交审待审核」）。
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
| `RBAC-SPEC.md` §2 / §3 / §4 / §5.2 / §6 / §7 | 第 18 权限点（顺带订正 §2 标题里过期的「14 个」）；`reviewer` 角色行；§5.2 补四条审核端点；落地页规则；操作日志第 4 张表；新增一小节 **kind → perm 表**并写明它不是 §5.2 的复用 |
| `ELEC-COST-SPEC.md` 头部 | 「现有附表11 保持原样不动」那句之后补：两本账现在各有一把审核键（`elec-cost` / `elec-model`），指向本 spec §7.1。不补的话下次动电费模型的人不会来读审核 spec |
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
| **R2** ✅ | §7.5 前端全部 | 审核员有队列；录入方知道卡在谁手里 | 把 `approved` 改 `entered` → 编辑按钮出现；理由为空不能提交（实施时另做了 60+ 处破坏验证，五处偏离见 §7.5 / §12） |
| **P5** ✅ | §6 落地页 + 角色行 + 后端 `roleNames` + `baseHome`（顺带 `AnaEmpty` 层门 + P3 遗留的 tabs 整体重置） | 总经理直落驾驶舱；七角色真名 | zero-edit 落 `/cockpit`；`reviewer` 落 `/data-home`；自建纯管理员仍 `/sys-users`（实施时 19 处破坏验证，四处偏离见 §6 各行的 ⚠） |
| P6（可选） | 命令面板「本月」组（清单未完成行进面板） | Ctrl-K 直达 | `palette.spec` 3 + 1 组 |

P4 与 P0/P3 无依赖；R1/R2 依赖 P2 的清单行；P5 最后。

---

## §10 测试面

- **不变**：`fpNav.spec` 4 层；`palette.spec` 6 条；`tabs.spec` epoch 12 条；`ledgerLeaveAndReturn.spec`；`lockScopes.spec` 护栏；8 份 flow/gate spec 的断言（只改注释口径）；`billingPeriod.spec:84-88`。
- **翻转 1 条**：`mobileNavDrawer.spec:35-42`（目录条目 epoch 0）。2026-09-03 实跑 vitest：只改 `SidebarPanel` 0 红；同改 `MobileNavDrawer.goItem` 恰 1 红。
- **改数**：`fpNav.spec` 51 → 50 并加「`contracts` 在档案组 / `anomaly` 是分析层第一组第 2 项 / 经营·能源两组存在 / `bank-flow` 不存在」；`routeMap.spec` 改「无任何屏落 PlaceholderView」+ `/bank-flow` 有 redirect；`tabs.spec:80-85` 基底页签随落地页；`DataHomeView.spec:151,160` 与 `DataHomeApiIT:51` 4 → 5；`Perm` 覆盖率回归 18 点。
- **新增**：`navHeight.spec` · `deepLink.spec`（p / ym / y&m / company 名兼容、越界丢弃、pin 规则）· `useDeepPeriod.spec`（同 fullPath 只 apply 一次；query 变更再 apply；无 p 不 apply；dirty 不切）· `sidebarPanel.spec`（当前项 no-op / open / Shift / 折叠追加不收回 / scrollIntoView）· `iconRail.spec`（当前层 guard）· `tabStripTitle.spec`（定宽、ctx 拼接、非激活签退回屏名）· `monthClose.logic.spec`（五步读 `overview.chain.steps[i].status`——**不是** `chainStepsOf`，见 §5.2、padlock、锁账派生、审核态映射、恒 na 不进分母、chips 收严按 `chips.length` 守）· `useEditMode.spec` +3（approved / submitted 不进、returned 可进）· `reviewDialog.spec`（理由必填）· `sidebarLockNote.spec` +3（期 / 折叠组聚合点 / aria）· `lockScopes.spec` +1（`scopePeriod`）· `auth.spec` +1（`roleLabel` 派生表）· 后端 `ReviewGuardCoverageTest` · `ReviewApiIT` · `V124` 迁移测试。
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

- **P5 边界（2026-09-07 实施时新增）**：
  - **`roleNames` 的顺序实际是 `role_id` 序，不是挂载序**（2026-09-07 复查订正：`auth_user_role` 的主键就是 `(user_id, role_id)`、**没有 id 列**，先挂哪个根本记不下来；`UserPermissionCache.reload()` 的 `selectList(null)` 无 ORDER BY，扫的是聚簇主键，于是同一个人的角色按 role_id 升序出来）。所以兼岗恒显「财务主管、审核员」（2、7）而不是反过来。**这是实现的副产物，不是约定** —— 想让它稳定就该显式写 `ORDER BY role_id`；想按别的序（builtin 优先、常用角色在前）是个显示口径决定，不该由我替客户拍。
  - **派生角色名没有「总经理」档**，见 §6 角色行那一行的 ⚠。
  - **跨层引导只收住了 `AnaEmpty` 那 17 处，组件外的手写链接是漏网的**（2026-09-07 验收复查发现）：`ParkView.vue:283` 的「去补录可租面积 →」（`/buildings`）与 `TenantPortfolioView.vue:298` 的「去租户管理补录类目」（`/tenants`）是直接写在模板里的 `RouterLink`，不经 `AnaEmpty`，园区股东照样点得进去。危害与 `AnaEmpty` 那条同类（把只有分析层的人送进一个侧栏没有入口的屏），但修它要么把 `canGo` 那段抽成一个可复用的判断（`useLayerVisible(to)`）、要么给这类链接包一层 —— 是个新落点的决定，不在 §6 那一行的字面范围里，另开。
  - **验收时可用的三张恒显空态卡**（不需要制造缺数据）：现金流量分析屏的「现金流量表数据待录入」→ 去报表中心、结构与续约屏的「续约风险」→ 去合同管理补录、资产负债分析屏的「资产负债趋势」→ 去录入资产负债表。另有一张条件型的：驾驶舱把年份切到没有损益附表的年（如 2026）→「X 年损益附表未录入」→ 去录入损益附表。
  - **在场座位的角色名只在会话第一拍取**：与 `displayName` 同一条既有代价（`PresenceService` 头注写着「改了显示名，已开着的标签页要到下次开页才更新」）。改角色同理。
  - **落地页不受当场授权影响**：`auth.landing` 读 `can()`，但它用到的两个权限点 `system:view` / `review:approve` 都在不可提权名单里，而 `isReadonly` 读的是 `permissions` 不是 `can` —— 三个判据一个都提不动。这是巧合成立的，不是设计出来的：往 landing 里加第四个判据前先核一遍。
  - **`auth_user.role` 那一列没动**：V32 的 JWT role claim 仍在签它，`LoginResp.role` 也仍在发它。P5 只是不再拿它当名字显示。删它要连 JWT 签发与老前端一起改，不在本期。
  - **破坏验证的坑（工具问题，记着别再踩）**：用 `shutil.move` 还原被破坏的 Java 源文件会**保留旧 mtime**，maven 认为源比 class 新才重编 —— 结果被破坏的 class 留在 `target/`，下一趟 verify 红得莫名其妙。还原一律用重写（新 mtime），或 `touch` 一下。

- **R2 边界（2026-09-07 实施时新增）**：
  - **撤销审核不发提醒，且做不到**：`withdraw` 是删行（`ReviewService.withdraw` 头注：不留 `returned`，理由进 `review_log`），`submitted_by` 随行一起没了，没有任何列能反查「这张表原来是谁交的」。退回的提醒（`PingResp.myReturned`）是从 `review_state WHERE status='returned' AND submitted_by=me` 派生的，零迁移且自清；撤销要发就得加列或加每人一份的已读位。
  - **前端「有没有这张表的 edit 权」是粗判**：只按「持有五个写权限中的任一个」决定交审按钮画不画。真正的 kind→perm 表在后端 `ReviewKind.perms()`，前端不重列一份（§7.1 明写它不是 RBAC §5.2 的复用，重列必漂移）。代价：没有某张表 edit 权的人会看见一颗按不动的「交审」，点下去由后端 403 兜底并把原话弹出来。
  - **顶栏上下文 chip 不带审核态图标**（§7.5 原文有这一条，实施时判断不做）：编辑按钮的药丸就在同一条工具栏上、说的是同一件事；而要做它就得在 `Toolbar.vue` 里再抄一份「屏 → kind」表，正是 `reviewGateCoverage.spec` 存在的理由。要做的话正确路子是让当前屏把自己的审核态发布到一个共用位置，而不是让工具栏自己去猜。
  - **年表屏的「导入 Excel」与「清空本期导入」不按月拦**：它们跨整年，按「该年任一月已审就禁用」会让审掉一月之后整年再也导不进去。行级闸（D18）覆盖的是删除 / 备注 / 批删勾选；导入与清空由后端逐行按月 423 兜。
  - **新增记账抽屉不过滤已审核的月**：抽屉的年份可以选到别的年，而那一年的审核态没取（闸道按年缓存）。往已审核的月新增由后端拦，文案是准的。
  - **`GET /api/review/closed-months` 的候选月下限写死 12**：= 固定键 5(出账链) + 1(附12) + 2(附13/14) + 1(附6) + 2(附7/8) + 1(附11)。台账按公司数、附10 按期区数只会更多，所以这个下限恒成立；但**改了 `ReviewKind` 的键集合就要同步改这个数**，改小只是多跑几次聚合，改大会漏掉真的锁账月。

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
- **`LedgerService.rechain(companyId)` 的守卫粒度**：守在循环里真正要 `updateById(l)` 的那一行（该行的月），不是「该公司有任一已审月就整体拒」—— 后者会让审掉 1 月之后连 5 月都录不进去（每次 save 都调 rechain）。代价：错误文案必须自解释「你改的是 2024-01，被拒是因为 2024-03 审过，结余链会顺着改到那个月」，否则用户以为系统坏了。升级路径：等 rechain 改成按月增量重算后可收窄。
- **计费参数的长期默认行**（`acctMonth=''`）与 `AllocService` 空 `memberMonth` 的规则行：它们是「所有未被月度行覆盖的月」的取值来源，拿不到单一被写月，故走 `assertNoLockedMonth`（该 kind 存在任一已审 / 待审月就整体拒）。比按月精确判粗，一旦有月审过默认行就锁死；换精确判要先算出「这一改影响哪些月」的区间，`from` 行那半边已经用 `VersionResolver.nextFrom` 做了，默认行没有对应的上界概念。
- **交审前置跑一遍 `DataHomeService.overview`**：约十几条 count 查询换「done 判据与屏上同源」。交审是低频动作（一个月十几次），接受。升级路径：`DataHomeService` 拆出单键 done 查询后换过去。
- **第二本账本轮不进审核**：光伏分栋抄表（`pv_reading` / `PvMeterService`）与充电桩分桩抄表（`cp_reading` / `CpMeterService`）在已审月仍可改。依据是依赖方向 —— 附表6 的源是 `pv_record`、附表7/8 的源是 `charging_record`，两个抄表账是它们的**下游**派生（`PvMeterService.simulate` 按附表6 月度汇总推导分栋明细），不回写附表。`@NoReviewGuard` 的理由里写死了这条，改这个判断前先核依赖方向。
- **`ReviewGuard` 自己校验 period 格式**：正则 `^\d{4}-(0[1-9]|1[0-2])$`。不能信调用方洗过 —— 8 个 service 一个 `requireYm` 都没有，`MeterService` 那份是 `\d{4}-\d{2}`，放行 `2024-00` / `2024-13`。
- **P3 遗留（2026-09-06）**：
  - `tabs.openDeep` 的判据是「**会不会顶掉别人**」（`preview` 有人且不是目标本身 → 钉住目标），不是 §4.3 字面的「来源在不在预览槽」：后者只护得住第一跳，驾驶舱 → 附10 → 台账的第二跳会把驾驶舱顶没，而改前 16 处恒 `pin:true` 不会（整期复查实测坐实）。本判据是它的超集，且不必知道来源是谁。
  - `auth.logout()` 至今**不重置已实例化的 tabs store**（`tabs` / `preview` / `recent` / `epoch` 都留着，它只清三个 localStorage 键）。P3 只让 `ctx` / `evicted` 跟着 `auth.me` 变化清；整体重置留给 P5（那期本来就要动 `auth.ts`）。
  - **ctx 只写给接了 `useDeepPeriod` 的屏**：`views/analysis/` 的 11 屏与导入中心不接（分析屏的期本来就不吃 URL，见上一条），所以它们的页签标题只有屏名、顶栏 chip 恒显「—」。与「给 `usePeriod` 开深链入口」是同一件事，一并留后期。
  - **Shift 点当前项仍然重建**（不 push、只 epoch++）：偏离 §4.1 的字面次序（那里 guard 写在 Shift 之前）。理由：改前「点当前项」走的就是 `openFresh`，不放开这条出路，当前屏在本期之后再没有任何强制刷新手势。
  - **纯读屏切回重读补了 13 屏，3 屏没补**：`SystemRolesView`（`load()` 收尾 `fillForm` 重置编辑区 + 屏内有真草稿态）、`PvRoiView`（`onMounted` 无条件重置选中期）、`PvMeterAnaView`（屏头铁律「只有换年才重新取数」，且每次切回要重跑抛光 / 变点检验）。这三屏在侧栏改「恢复现场」之后没有刷新入口，用户要靠 Shift 点击或关签重开。
  - 被顶提示与网络错误 toast 同底 28px，两条同时在场靠 `.stacked` 上移一格 —— **三条以上没有排队机制**。
  - **被顶提示会为「你没编辑过的那一屏」弹出**：出账链三屏（计费参数 / 公共电核算 / 催缴单）共用一把 `billing-chain` 月锁（§3.3 明写），`holdsEditUnder` 按锁根判，所以在计费参数编辑态时公共电核算被顶也会弹。要精确到屏得让 `holdLock` 登记时带上 `route.meta.value`。
  - **「恢复现场」不含滚动位置**：`AppShell` 的 `.fp-content` 是各档共用、永不卸载的一个滚动容器，路由无 `scrollBehavior`、全仓没有按签存 `scrollTop`。期、公司、抽屉、编辑态都回来了，唯独位置不回来 —— 这是这句承诺里最显眼的一个洞。
  - **★ 有 `aria-pressed` 却不可反按**：`tabs.pin()` 幂等，全站没有 unpin 入口，读屏会把它读成一个按下去就弹不起来的开关。要么给一个 unpin，要么去掉这个属性。
  - 页签定宽 148px 之后溢出下拉从「几乎不发生」变常态入口（6–7 签就撑破一行），`.fp-tab-overflow` 的 `v-if` 一进一出会挤窄 `.fp-tabs`；不算 §1 违规（开第 7 个签本来就要重排那一行），要不要给 `.fp-tab-actions` 一个恒定占位宽留下一期定。
  - `CommandPalette` 自 P3 起懒加载（`defineAsyncComponent` + `v-if="paletteEverOpened"`，index 190.8 → 184.1KB）。连带它的 reset+autofocus watch 加了 `immediate` —— 首次打开时它是**带着 open=true 挂载**的，没有 false→true 这个变化。
- **P2 遗留（2026-09-06）**：
  - **审核机制整条链归 R1**：本期 `Item.companies[] / phases[]` 只发 `done` 不发 `review`，行右侧审核态列与「本月锁账」行恒显「—」+ padlock（悬停说「审核机制未上线」）。**不许**临时降级成「五步全 done 就算锁账」—— 那是假绿。第 18 个权限点 `review:approve` 与 `V124` 迁移同归 R1（碰它会连锁 `BookPinApiIT:432` 的 `hasSize(17)` 与两处种子断言）。
  - **`CloseRow.stale` 今天没有生产路径**：后端 `buildChain` 只发 `done` / `current` / `todo`（`DataHomeApiIT` 有契约测钉着取值域），它是防御分支、夹具靠类型放宽造出来的。如实记着比假装能走到强。
  - **`MonthCell.locked` 本期无调用方**，是 R1 §7.2「全月已审核 → ✓ 锁标」的落点；本期唯一有效的守是组件级那条「同传 pips 与 locked 时两者都在 DOM 里」（屏级怎么写都绿）。
  - **审批抽屉的「页面」行不可跳**：`Pending` 只有 `page / action / impact` 三个自由文本（`api/approvals.ts` / `ApprovalDtos.java`），10 个调用点各自拼字符串，既无 nav value 也无规范化的期。要做得给提权审批 DTO 加两个字段并改 10 个调用点 —— 为一个便利改动去动安全相邻的提权流程，不划算。**推后**。
  - **导入中心没有「本月导没导」的数据源**：`import` 不在 9 个 source 里，导入日志按天数窗口取、DTO 无账期字段。该行**只做入口**，状态位恒「—」，且不进计数分母。
  - **`navOfScope` 一把锁命中多个 nav 时取 `NAV_SCOPE_PREFIX` 声明序的第一个**（出账链三屏与系数簿共用一把月锁）。⚠ 这个结果**只可用作目的地，不可用作文案** —— 握这把锁的人四分之三的时候不在第一个屏上。文案见 §5.2。
  - **`sched:s10` 一个前缀两种粒度**（月锁 `…:2025-06` 与年锁 `…:2025` 并存），`scopePeriod` **照实返回**混粒度，不把年补成月（`periodLink` 的 `p` 本就允许只有年）。
  - **★ 年锁的深链会被目标屏静默丢弃**：主管条 chip 点跳带出去的 `p` 若只有年（`meters:2025` / `sched:s10:1:2025`），目标屏的 `applyDeep` 是 `if (t.month == null) return` —— 人落在那一屏，但不在那一年，且没有任何提示。修它要动 `S10View` 与 `useDeepPeriod` 两处别的屏，超出 P2；本期只用一条用例把**现状**钉住。
  - **首页骨架的年份条按「一年」给高度**：年份数在 `ov` 到达之前不可知，所以真版式若是四年，这一块会长高。T3 修掉的是**轴向**从单列跳成两栏（版式塌），这是同轴同序的增高，量级不同，不假装能对齐。
  - **「点附表项不触发 loadChain」这条断言随 P2 整条删**：年份条要四颗工序点，本屏自 T4 起**永远**是链数据的消费者（`onMounted` 就发），那句话不再成立。同时 `DataHomeView` 登记进 `readScreenRefresh` 的 `REACTIVATED_SCREENS`。
  - **主管条是第二个「待批授权」入口**（`Toolbar` 已有一个，移动端 `MobileTopBar` 是第三个），三处读同一份 `presence.approvals`、开同一个 `FPApprovalDrawer`，没有共享的开合状态 —— 各自一个实例，同时只会开一个。
  - **两栏清单取消了 P1 的「未录在前、已录在后」排序**（改按业务时序固定排），`DataHomeView.spec` 里那条断言随之整条删 —— 那条排序是给一排扁平胶囊用的可供性，两栏板子里它会让「月度台账」跳来跳去。
- 四张年表屏（`ElecView` / `UtilitiesView` / `PvView` / `ChargingView`，dirty 闸与 `current` 逐字同形；`UtilitiesView` 的 apply 少一道 `mode === 'summary'` 门）的 dirty 闸未按年幂等（同年不同月的链在有抽屉 / 导入窗时会误弹提示），与损益附表的裁定不一致 —— 遗留；`CpMeterView` 的 `?station=` 「只有年」pending 分支从唯一发链方不可达。
