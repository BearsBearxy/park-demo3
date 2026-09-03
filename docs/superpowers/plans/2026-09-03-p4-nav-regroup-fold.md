# P4 侧栏动词分组 + 手风琴 + 分析层重组 + 死钮清理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三层导航在 1366×768 办公机上一屏装下：数据层按动词四组、带标题组可折叠、分析层「异常提醒中心」升到第 2 行、删银行流水占位、顶栏死钮清零，并用 `navHeight.spec` 把高度预算钉死。

**Architecture:** `fpNav.ts` 仍是唯一事实源（接口不加字段），分组重切只改数据；折叠规则是纯函数 `nav/navFold.ts`（路由落在哪一屏时哪些组必须开），展开集合是 `SidebarPanel` 内存态（换层清空、只追加不收回），`ds/SidebarNav.vue` 只多一个 `openTitles` prop 与 `toggle` 事件（不传 = 老行为全展开），同时删掉它不可达的折叠轨道 / flyout 分支。银行流水条目删除 + 路由重定向；顶栏 ★ 接 `tabs.pin`、☀ 删除、搜索文案改成「页面 / 分组」并让命令面板真的按分组名匹配。

**Tech Stack:** Vue 3 `<script setup>` + render 函数组件（SidebarNav）· Pinia · Vitest + @vue/test-utils（jsdom）· vue-tsc。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §2 · §3 · §6（收藏 / 主题 / 搜索三行）· §8.2 · §9 P4 行 · §10。

## Global Constraints

- `fpNav.ts` 唯一事实源；`NavItem / NavSection / NavLayer` **接口不加字段**（折叠按 `section.title` 派生）。`fpAllPages()` 的**输出**可加派生字段 `group = section.title`，`fpBuildRoutes` 不吃它。
- 51 → **50** 屏；所有 `value` 逐字沿用；`bank-flow` 条目删除，`router` 加 `{ path: '/bank-flow', redirect: '/data-home' }`。
- 像素不变（DESIGN-FIDELITY §2）：行 34 / 组标题 30（`--type-label` 18 行高 + padding 6×2）/ 组内 gap 2 / 组间 16。chevron 与折叠态聚合在场点一律 `position:absolute`，出现与消失不改行尺寸（LAYOUT-STABILITY）。
- `PANEL_BUDGET = 500` **只写在 `nav/__tests__/navHeight.spec.ts` 一处**，注释写明推导（1366×768 → 内视口 ≈ 620 → 导航区 ≈ 509）。
- 本期**不动**：侧栏 / 抽屉 / 轨的点击语义（仍 `openFresh`，P3 才翻）；KeepAlive；`tabs` 三个 localStorage 键；`IconRail`；`MobileNavDrawer`（S 档目录与桌面同一份数据，不折叠）；`NAV_SCOPE_PREFIX`。
- `npm run build` 的 size-check：index ≤ 191KB（分支当前 190.5）。超线先瘦身，本期自带的瘦身来源是 SidebarNav 死分支删除；不上调预算。
- 每条新断言按 memory 节奏做破坏验证（改坏 production → 只有对应用例红 → **字符串替换还原，绝不 `git checkout`**）。
- 提交信息末尾：`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 所有命令在 worktree `C:\financial_dashboard\demo3\.claude\worktrees\model-12d043` 里跑；前端命令在 `frontend/`。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `frontend/src/nav/fpNav.ts` | 数据层四组 / 分析层六组 / 删 `bank-flow` / `pv-meter-analysis` 图标 / 头注释 / `fpAllPages` 加 `group` |
| `frontend/src/nav/navFold.ts`（新） | `autoOpenTitles(layer, activeValue)`：路由落在该屏时必须展开的组标题 |
| `frontend/src/nav/__tests__/fpNav.spec.ts` | 50 屏 + 分组断言 |
| `frontend/src/nav/__tests__/navHeight.spec.ts`（新） | 高度算式 + 预算 500 + `autoOpenTitles` 用例 |
| `frontend/src/analysis/anaData.ts:56-58` | `ANA_VALUES` 改走 `fpAllPages()` |
| `frontend/src/nav/billingChain.ts:2` | 组名注释 |
| `frontend/src/router/index.ts` | 删 `'bank-flow': PlaceholderView`；加 `/bank-flow` 重定向 |
| `frontend/src/router/routeMap.spec.ts` | 「无任何屏落 PlaceholderView」+ 重定向断言 |
| `frontend/src/stores/__tests__/tabs.spec.ts:92` | `'bank-flow'` → `'alloc'`（保住「9 次打开封顶 8」的用例意图） |
| `frontend/src/components/ds/SidebarNav.vue` | `openTitles` prop + `toggle` 事件 + 可点标题行 + 聚合点；删折叠轨道 / flyout 分支与样式 |
| `frontend/src/components/shell/SidebarPanel.vue` | `openTitles` 内存态 + `scrollIntoView` |
| `frontend/src/components/shell/__tests__/sidebarPanel.spec.ts`（新） | 折叠追加不收回 / 换层清空 / scrollIntoView |
| `frontend/src/components/ds/__tests__/sidebarLockNote.spec.ts` | +1：折叠组标题聚合在场点 |
| `frontend/src/components/shell/Toolbar.vue` | ★ → `tabs.pin`；删 ☀；搜索文案 |
| `frontend/src/components/shell/__tests__/toolbar.spec.ts`（新） | ★ 固定 / 无主题钮 / 搜索文案 |
| `frontend/src/components/shell/paletteFilter.ts` · `CommandPalette.vue:74` · `__tests__/palette.spec.ts` | `group` 匹配 + 占位文案 |
| `docs/design/DESIGN-FIDELITY.md` §2.3 · `docs/design/PV-ANALYSIS-SPEC.md` §01 / §10 · `docs/design/RESPONSIVE-LAYOUT-SPEC.md:317` | 规范随迁 |

---

### Task 0: 准备与基线

**Files:** 无代码改动。

- [ ] **Step 1: 记 BASE、确认 node_modules 联结**

```bash
git rev-parse --short HEAD
ls frontend/node_modules/.bin/vitest
```
Expected: HEAD = `e638b65`（或其后）；vitest 存在（`frontend/node_modules` 是指向主仓的 junction）。

- [ ] **Step 2: 跑本期会碰的 spec 取基线**

```bash
cd frontend && npx vitest run src/nav src/router src/components/shell src/components/ds/__tests__/sidebarLockNote.spec.ts src/stores/__tests__/tabs.spec.ts
```
Expected: 全绿（2026-09-03 实测基线 9 files / 65 tests）。

- [ ] **Step 3: 记 size-check 基线**

分支最近一次 `npm run build`（2026-09-03 P1 门禁）：`index 190.5KB / 191`，合计 `3870.3 / 3900`。Task 6 与它比。

---

### Task 1: fpNav 重分组（数据层四组 · 分析层六组 · 删银行流水）

**Files:**
- Modify: `frontend/src/nav/fpNav.ts:1-3, 9-32, 47-72`
- Modify: `frontend/src/nav/__tests__/fpNav.spec.ts`
- Modify: `frontend/src/analysis/anaData.ts:44, 56-58`
- Modify: `frontend/src/nav/billingChain.ts:2`
- Modify: `docs/design/PV-ANALYSIS-SPEC.md:80, 1042`

**Interfaces:**
- Consumes: 无。
- Produces: 数据层 section 标题 `'档案' / '出账 · 每月工序' / '记账 · 按月' / '记账 · 按年'`；分析层 `'园区维度' / '租户维度' / '管理公司维度' / '经营专题' / '能源专题'`；报表层 `'三大报表' / '损益附表'` 不变。Task 3 的 `navFold.ts` 与 Task 4 的 spec 按这些**字面量**取组。

- [ ] **Step 1: 改 fpNav.spec（先红）**

把 `frontend/src/nav/__tests__/fpNav.spec.ts` 整个替换为：

```ts
// src/nav/__tests__/fpNav.spec.ts
import { describe, it, expect } from 'vitest'
import { FP_NAV, fpAllPages, fpBuildRoutes, fpFindLayer } from '../fpNav'

const layer = (id: string) => FP_NAV.find(L => L.id === id)!
const itemsOf = (id: string, title: string) => layer(id).sections.find(s => s.title === title)!.items.map(i => i.value)

describe('fpNav', () => {
  it('has 4 layers and 50 items', () => {
    expect(FP_NAV).toHaveLength(4)
    expect(fpAllPages()).toHaveLength(50)
  })
  it('builds a route per item with layer back-refs', () => {
    const r = fpBuildRoutes()
    expect(Object.keys(r)).toHaveLength(50)
    expect(r['buildings'].layer).toBe('data')
    // 首页改名「本月出账」(SIDEBAR-UX-REDESIGN §5.1 / D12):value 不变,页签/面包屑/面板从这里取字
    expect(r['data-home'].page).toBe('本月出账')
    expect(r['data-home'].icon).toBe('calendar-check')
    // 计费参数(S21-PARAM-CENTER-SPEC §5):出账组第一道工序,取代价目管理(price-cfg 不再是导航项)
    expect(r['params'].layer).toBe('data')
    expect(r['params'].page).toBe('计费参数')
    expect(r['params'].icon).toBe('sliders-horizontal')
    expect(r['price-cfg']).toBeUndefined()
    expect(r['fin-pnl'].layerLabel).toBe('经营分析')
    // 能源分析两屏(ENERGY-ANALYSIS §5):能源专题组(2026-09-03 由「专题分析」拆出)
    expect(r['elec-analysis'].layer).toBe('analysis')
    expect(r['charging-analysis'].layer).toBe('analysis')
    // 池核算两屏(POOL-ENGINE-SPEC §6):出账组,公共电核算承接 alloc,楼栋损耗紧随
    expect(r['alloc'].page).toBe('公共电核算')
    expect(r['alloc-loss'].layer).toBe('data')
    // 催缴单(S4-BILL-NOTICE-SPEC §7 S4-4):出账组,楼栋损耗之后
    expect(r['bill-notices'].layer).toBe('data')
    expect(r['bill-notices'].page).toBe('催缴单')
    expect(r['bill-notices'].kind).toBe('billNotices')
    // 系统管理层(RBAC-SPEC §4):不进 navLayers,可见性按 system:view
    expect(r['sys-users'].layer).toBe('system')
    expect(r['sys-roles'].layerLabel).toBe('系统管理')
    // 操作日志(§7 P2):三张来源表 union 的只读时间线
    expect(r['sys-logs'].layer).toBe('system')
    expect(r['sys-logs'].page).toBe('操作日志')
  })
  it('fpFindLayer resolves owning layer', () => {
    expect(fpFindLayer('balance-sheet').id).toBe('reports')
    expect(fpFindLayer('nope').id).toBe('data') // fallback first
  })
  it('数据层按动词四组:档案 / 出账 / 记账(月|年) / 导入(SIDEBAR-UX-REDESIGN §2.1)', () => {
    expect(layer('data').sections.map(s => s.title))
      .toEqual([undefined, '档案', '出账 · 每月工序', '记账 · 按月', '记账 · 按年', undefined])
    // 合同管理从出账链移入档案(D7)
    expect(itemsOf('data', '档案')).toEqual(['buildings', 'tenants', 'contracts'])
    expect(itemsOf('data', '出账 · 每月工序')).toEqual(['params', 'meters', 'alloc', 'alloc-loss', 'bill-notices'])
    // 月 / 年分组 = 后端 scheduleSources 的 monthly()/yearly();utilities 走 SchedYearGate,归年组
    expect(itemsOf('data', '记账 · 按月')).toEqual(['ledger', 'sales-income', 'salary'])
    expect(itemsOf('data', '记账 · 按年')).toEqual(['pv-income', 'car-charging', 'ebike-charging', 'elec-cost', 'utilities'])
    expect(layer('data').sections[5].items.map(i => i.value)).toEqual(['import'])
    expect(layer('data').caption).toBe('本月出账 · 记账 · 导入 · 档案')
    // 银行流水条目删除(D4):后端从没有这块数据,占位常驻是死 UI
    expect(fpBuildRoutes()['bank-flow']).toBeUndefined()
  })
  it('分析层:异常提醒中心是第一组第 2 项;经营 / 能源两个专题组(§2.3)', () => {
    const ana = layer('analysis')
    expect(ana.sections[0].title).toBeUndefined()
    expect(ana.sections[0].items.map(i => i.value)).toEqual(['cockpit', 'anomaly'])
    expect(ana.sections.map(s => s.title))
      .toEqual([undefined, '园区维度', '租户维度', '管理公司维度', '经营专题', '能源专题'])
    expect(itemsOf('analysis', '经营专题')).toEqual(['churn', 'expiry', 'breakeven', 'budget', 'pnl-analysis'])
    expect(itemsOf('analysis', '能源专题')).toEqual(['pv-roi', 'pv-meter-analysis', 'elec-analysis', 'charging-analysis'])
    // 分栋分析与投资回收同组,图标要分得开:sun 留给 pv-roi
    expect(fpBuildRoutes()['pv-meter-analysis'].icon).toBe('table-2')
  })
  it('报表层与系统层不变(§2.2 / §2.4)', () => {
    expect(layer('reports').sections.map(s => s.title)).toEqual([undefined, '三大报表', '损益附表', undefined])
    expect(layer('system').sections).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑 spec 确认红**

```bash
cd frontend && npx vitest run src/nav/__tests__/fpNav.spec.ts
```
Expected: `has 4 layers and 50 items`、`builds a route…`（51 ≠ 50）、`数据层按动词四组`、`分析层` 四条红；`fpFindLayer`、`报表层与系统层不变` 绿。

- [ ] **Step 3: 改 fpNav.ts**

下面三段的行号都是**改动前**的原始行号；按内容整块字符串替换，不按行号定位（第一段替换后行号会漂移）。

把 `frontend/src/nav/fpNav.ts` 第 1-3 行注释替换为：

```ts
// src/nav/fpNav.ts — 导航单一事实源(50屏×4层)。源: app/shell.jsx FP_NAV(+预算对比/能源分析/园区抄表/公摊分摊/系统管理)。
// 数据层按动词四组(SIDEBAR-UX-REDESIGN §2.1):档案(静态) / 出账(每月工序:计费参数→园区抄表→公共电核算→楼栋损耗→催缴单)
//   / 记账(月｜年,按后端 DataHomeService.scheduleSources 的 monthly()/yearly() 分) / 导入。
// 带标题的组可折叠:SidebarPanel 按 section.title 派生展开态,接口不加字段(§3.2)。
// S21:「价目管理」/price-cfg 退役,由「计费参数」/params 取代(router 里 /price-cfg 重定向)。
// 2026-09-03(D4):「银行流水」/bank-flow 条目删除 —— 后端从没有这块数据,占位常驻是死 UI;router 里 /bank-flow 重定向到首页。
```

把数据层（第 9-32 行）整块替换为：

```ts
  { id: 'data', label: '数据中心', short: '数据', icon: 'database', caption: '本月出账 · 记账 · 导入 · 档案', home: 'data-home', sections: [
    { items: [{ value: 'data-home', label: '本月出账', icon: 'calendar-check', kind: 'data-home' }] },
    { title: '档案', items: [
      { value: 'buildings', label: '楼栋管理', icon: 'building-2', kind: 'buildings' },
      { value: 'tenants', label: '租户管理', icon: 'users', kind: 'tenants' },
      // 合同管理从出账链移入档案(D7):它是静态档案,不是每月工序
      { value: 'contracts', label: '合同管理', icon: 'file-text', kind: 'contracts' } ] },
    { title: '出账 · 每月工序', items: [
      { value: 'params', label: '计费参数', icon: 'sliders-horizontal', kind: 'params' },
      { value: 'meters', label: '园区抄表', icon: 'gauge', kind: 'meters' },
      { value: 'alloc', label: '公共电核算', icon: 'share-2', kind: 'alloc' },
      { value: 'alloc-loss', label: '楼栋损耗', icon: 'trending-down', kind: 'allocLoss' },
      { value: 'bill-notices', label: '催缴单', icon: 'file-check-2', kind: 'billNotices' } ] },
    { title: '记账 · 按月', items: [
      { value: 'ledger', label: '月度台账', icon: 'book-open', kind: 'ledger' },
      { value: 'sales-income', label: '附表10 销售收入', icon: 'coins', kind: 'sales' },
      { value: 'salary', label: '附表12 工资明细', icon: 'wallet', kind: 'schedule12' } ] },
    { title: '记账 · 按年', items: [
      { value: 'pv-income', label: '附表6 光伏发电', icon: 'sun', kind: 'schedule6' },
      { value: 'car-charging', label: '附表7 汽车充电桩', icon: 'car', kind: 'schedule7' },
      { value: 'ebike-charging', label: '附表8 电动车充电桩', icon: 'bike', kind: 'schedule8' },
      { value: 'elec-cost', label: '附表11 电费成本', icon: 'zap', kind: 'schedule11' },
      // 办公·三期水电走 SchedYearGate(年门),归年组
      { value: 'utilities', label: '办公·三期水电', icon: 'plug', kind: 'utilities' } ] },
    { items: [{ value: 'import', label: '导入中心', icon: 'upload', kind: 'import' }] },
  ] },
```

把分析层（第 47-72 行）整块替换为：

```ts
  { id: 'analysis', label: '经营分析', short: '分析', icon: 'pie-chart', caption: '决策视图 · 园区 / 租户 / 管理公司 三维', home: 'cockpit', sections: [
    { items: [
      { value: 'cockpit', label: '经营驾驶舱', icon: 'gauge', kind: 'ana' },
      // 异常提醒中心升到第 2 行(SIDEBAR-UX-REDESIGN §2.3):高管第二眼就该看到哪里不对,不该压在第 19 行
      { value: 'anomaly', label: '异常提醒中心', icon: 'bell-ring', kind: 'ana' } ] },
    { title: '园区维度', items: [
      { value: 'park', label: '出租与楼栋', icon: 'building-2', kind: 'ana' },
      { value: 'park-energy', label: '园区能耗', icon: 'zap', kind: 'ana' } ] },
    { title: '租户维度', items: [
      { value: 'tenant-energy', label: '用能与缴费', icon: 'activity', kind: 'ana' },
      { value: 'tenant-portfolio', label: '结构与续约', icon: 'users', kind: 'ana' } ] },
    { title: '管理公司维度', items: [
      { value: 'fin-pnl', label: '利润表分析', icon: 'bar-chart-3', kind: 'ana' },
      { value: 'fin-balance', label: '资产负债分析', icon: 'scale', kind: 'ana' },
      { value: 'fin-cashflow', label: '现金流量分析', icon: 'wallet', kind: 'ana' },
      { value: 'fin-expense', label: '费用与报销', icon: 'receipt', kind: 'ana' } ] },
    { title: '经营专题', items: [
      { value: 'churn', label: '租户流失预警', icon: 'siren', kind: 'ana' },
      { value: 'expiry', label: '到期墙与续约', icon: 'calendar-clock', kind: 'ana' },
      { value: 'breakeven', label: '盈亏平衡与敏感性', icon: 'scale-3d', kind: 'ana' },
      { value: 'budget', label: '预算对比', icon: 'target', kind: 'ana' },
      { value: 'pnl-analysis', label: '损益附表分析', icon: 'layers', kind: 'pnlAnalysis' } ] },
    { title: '能源专题', items: [
      { value: 'pv-roi', label: '光伏投资回收', icon: 'sun', kind: 'pvRoi' },
      // 分栋抄表分析独立成屏(PV-ANALYSIS-SPEC §01):与 pv-roi 两套数据源、两套时间维、两套期间语义;图标用表格与 sun 分开
      { value: 'pv-meter-analysis', label: '光伏分栋分析', icon: 'table-2', kind: 'ana' },
      { value: 'elec-analysis', label: '电费成本分析', icon: 'zap', kind: 'ana' },
      { value: 'charging-analysis', label: '充电桩分析', icon: 'plug', kind: 'ana' } ] },
  ] },
```

报表层、系统层、接口、`fpAllPages / fpFindLayer / fpBuildRoutes` 一字不动。

- [ ] **Step 4: anaData 改走 fpAllPages；billingChain 注释**

`frontend/src/analysis/anaData.ts` 第 44 行 `import { FP_NAV } from '@/nav/fpNav'` 改为 `import { fpAllPages } from '@/nav/fpNav'`；第 56-58 行改为：

```ts
// 分析层全部路由 value(fpNav 单一事实源派生,勿手抄清单)。
// 不读 sections:分组是侧栏的事,这里只要「属于分析层」,组怎么切都不该牵动缓存失效的范围。
const ANA_VALUES: string[] = fpAllPages().filter(p => p.layer === 'analysis').map(p => p.value)
```

`frontend/src/nav/billingChain.ts` 第 2 行改为：

```ts
// 顺序即业务时序（fpNav「出账 · 每月工序」那一组，BILL-FORWARD 第 0 刀；2026-09-03 起合同管理归「档案」组，不在链里）。
```

- [ ] **Step 5: 跑 spec 确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/nav src/analysis && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: `fpNav.spec` 6 条全绿；`src/analysis` 下既有 spec 绿；vue-tsc 零错。

- [ ] **Step 6: 破坏验证**

把 `anomaly` 那一行剪回分析层末尾（临时加 `{ title: '监控', items: [anomaly] }` 组）→ 跑 `fpNav.spec` → 只有「分析层」那条红（`sections[0].items` 与标题列表都不对）；还原。把 `contracts` 挪回出账组 → 只有「数据层按动词四组」那条红；还原。

- [ ] **Step 7: PV-ANALYSIS-SPEC 随迁**

`docs/design/PV-ANALYSIS-SPEC.md` 第 80 行「落 fpNav 分析层「专题分析」组（`pv-roi` 同组，排它后面）」改为「落 fpNav 分析层「能源专题」组（`pv-roi` 同组，排它后面；2026-09-03 SIDEBAR-UX-REDESIGN §2.3 把「专题分析」拆为经营 / 能源两组）」。第 1042 行整条改为：

```
2. **fpNav 的分析层分组已重切（2026-09-03 SIDEBAR-UX-REDESIGN §2.3）。** 原「专题分析」拆为「经营专题」与「能源专题」，`pv-roi` / `pv-meter-analysis` / `elec-analysis` / `charging-analysis` 在「能源专题」（`fpNav.ts`）。本稿初版写的「没有能源专题组」已不成立；`pv-meter-analysis` 图标同时由 `sun` 改 `table-2`。
```

`docs/design/ENERGY-ANALYSIS-SPEC.md` 第 5 / 26 / 44 行各有一处「专题分析组」（用 `grep -n "专题分析" docs/design/ENERGY-ANALYSIS-SPEC.md` 定位），都改为「能源专题组（2026-09-03 SIDEBAR-UX-REDESIGN §2.3 由「专题分析」拆出）」。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/nav/fpNav.ts frontend/src/nav/__tests__/fpNav.spec.ts frontend/src/analysis/anaData.ts frontend/src/nav/billingChain.ts docs/design/PV-ANALYSIS-SPEC.md docs/design/ENERGY-ANALYSIS-SPEC.md
git commit -m "feat(nav): 数据层按动词四组、分析层异常中心升第 2 行并拆经营/能源专题;删银行流水条目(P4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 银行流水路由重定向 + 路由表护栏改写

**Files:**
- Modify: `frontend/src/router/index.ts:37-38, 91-92`
- Modify: `frontend/src/router/routeMap.spec.ts`
- Modify: `frontend/src/stores/__tests__/tabs.spec.ts:92`
- Modify: `docs/design/RESPONSIVE-LAYOUT-SPEC.md:317`

**Interfaces:**
- Consumes: Task 1 已删 `bank-flow` 导航项（否则 DEV 护栏会报「导航有但没配组件」）。
- Produces: `/bank-flow` → `/data-home`。

- [ ] **Step 1: 改 routeMap.spec（先红）**

整个替换 `frontend/src/router/routeMap.spec.ts`：

```ts
// src/router/routeMap.spec.ts — 路由表护栏:导航里的屏必须都配到组件,别静默降级成占位页
import { describe, it, expect } from 'vitest'
import { fpBuildRoutes } from '@/nav/fpNav'
import router from '@/router'

const values = Object.keys(fpBuildRoutes())
const compOf = (v: string) => router.getRoutes().find((r) => r.path === `/${v}`)?.components?.default
// 占位页 loader 是 router 的私有常量,认它只能看函数源码文本。下面先拿一个真占位 loader 做阳性对照 ——
// 构建工具哪天改写了 import 文本,阳性对照先红,这条护栏不会静默失效。
const isPlaceholder = (c: unknown) => String(c).includes('PlaceholderView')

describe('router 路由表', () => {
  it('导航每一屏都有路由且挂到了组件', () => {
    for (const v of values) expect(compOf(v), v).toBeTypeOf('function')
  })
  it('没有任何屏落到 PlaceholderView(2026-09-03 银行流水删除后,占位页只剩漏配兜底)', () => {
    expect(isPlaceholder(() => import('@/views/PlaceholderView.vue'))).toBe(true)   // 阳性对照
    expect(values.filter((v) => isPlaceholder(compOf(v)))).toEqual([])
  })
  it('/bank-flow 旧地址重定向到首页(SIDEBAR-UX-REDESIGN D4)', () => {
    expect(values).not.toContain('bank-flow')
    expect(router.getRoutes().find((r) => r.path === '/bank-flow')?.redirect).toBe('/data-home')
  })
})
```

- [ ] **Step 2: 跑 spec 确认红**

```bash
cd frontend && npx vitest run src/router/routeMap.spec.ts
```
Expected: 第 3 条红（`redirect` 为 undefined）；第 2 条此时也应绿（Task 1 已删导航项 → `values` 里没有 bank-flow）。若第 1 条红，说明 Task 1 没删干净。

- [ ] **Step 3: 改 router**

`frontend/src/router/index.ts` 删第 37-38 行（`// 已知死链…` 注释与 `'bank-flow': PlaceholderView,`）。在第 92 行 `{ path: '/price-cfg', redirect: '/params' },` 之后加：

```ts
    // 2026-09-03(SIDEBAR-UX-REDESIGN D4):银行流水条目删除,旧地址(书签 / 最近访问)落首页。
    // 后端从没有这块数据,占位页常驻两个月是死 UI;PlaceholderView 只留作漏配兜底(:99)。
    { path: '/bank-flow', redirect: '/data-home' },
```

`PlaceholderView` 常量与第 99 行的 `?? PlaceholderView` 兜底**保留**。

- [ ] **Step 4: tabs.spec 换掉 bank-flow**

`frontend/src/stores/__tests__/tabs.spec.ts` 第 91-92 行的 `values` 数组里 `'bank-flow'` 改为 `'alloc'`，并在数组上一行加注释：

```ts
    // 9 个真实 value 打开 9 次 → 封顶 8。bank-flow 已删屏(open 对未知 value 直接 return),换成 alloc 保住「第 9 次才触发封顶」
```

- [ ] **Step 5: 跑 spec 确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/router src/stores/__tests__/tabs.spec.ts src/components/shell/__tests__/palette.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: 全绿（`palette.spec` 的 recent 列表里仍含 `'bank-flow'`，`filterPages` 对未知 value 会过滤，照旧 ≤5 且 >0）。

- [ ] **Step 6: 破坏验证**

删掉 `{ path: '/bank-flow', redirect: '/data-home' }` → 只有「/bank-flow 旧地址重定向」红；还原。把 `isPlaceholder` 临时改成 `String(c).includes('NoSuchThing')` → 阳性对照那条红（证明检测本身在工作）；还原。

- [ ] **Step 7: RESPONSIVE-LAYOUT-SPEC 一词**

`docs/design/RESPONSIVE-LAYOUT-SPEC.md` 第 317 行「导入中心、银行流水、角色权限的」改为「导入中心、角色权限的（银行流水 2026-09-03 已删屏，SIDEBAR-UX-REDESIGN D4）」。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/router/index.ts frontend/src/router/routeMap.spec.ts frontend/src/stores/__tests__/tabs.spec.ts docs/design/RESPONSIVE-LAYOUT-SPEC.md
git commit -m "feat(router): /bank-flow 重定向到首页,占位页只剩漏配兜底;路由表护栏改为「无屏落占位页」(P4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 折叠规则 `navFold.ts` + 高度预算 `navHeight.spec`

**Files:**
- Create: `frontend/src/nav/navFold.ts`
- Create: `frontend/src/nav/__tests__/navHeight.spec.ts`

**Interfaces:**
- Consumes: Task 1 的组标题字面量。
- Produces: `autoOpenTitles(layer: NavLayer, activeValue: string): string[]` —— Task 4 的 `SidebarPanel` 消费。

- [ ] **Step 1: 写 navHeight.spec（先红：模块不存在）**

新建 `frontend/src/nav/__tests__/navHeight.spec.ts`：

```ts
// src/nav/__tests__/navHeight.spec.ts — 侧栏面板高度预算(SIDEBAR-UX-REDESIGN §3.1)。
//
// 1366×768 办公机:浏览器内视口 ≈ 620px(顶部铬边 + 任务栏吃掉 ~148)
//   → 减 stage padding 24、卡边框 2、面板 padding 32、面板头 24、两处间隙 28、分割线 1 → 导航区 ≈ 509px。
// 预算取 500,**只写在这里一处**(spec §3.1)。算式常量是 SidebarNav.vue 的实测值:
//   行 34 / 组内 gap 2(含标题到首行) / 组标题 30(--type-label 18 行高 + padding 6×2) / 组间 16。
// 想往某组塞屏而算不下时,红的是这里 —— 先想折叠或分组,不要来改数字。
import { describe, it, expect } from 'vitest'
import { FP_NAV, type NavLayer } from '../fpNav'
import { autoOpenTitles } from '../navFold'

const PANEL_BUDGET = 500
const ROW = 34, GAP = 2, TITLE = 30, SECTION_GAP = 16

/** 面板导航区高度:带标题组折叠时只剩 30px 标题行;无标题组恒展开。 */
function navHeight(layer: NavLayer, open: string[]): number {
  const parts = layer.sections.map(s => {
    const rows = s.items.length * ROW + (s.items.length - 1) * GAP
    if (!s.title) return rows
    return open.includes(s.title) ? TITLE + GAP + rows : TITLE
  })
  return parts.reduce((a, b) => a + b, 0) + (layer.sections.length - 1) * SECTION_GAP
}

const layer = (id: string) => FP_NAV.find(L => L.id === id)!
const BUSINESS = FP_NAV.filter(L => L.id !== 'system').map(L => [L.id, L] as const)

describe('侧栏面板高度预算(§3.1)', () => {
  it('算式与 spec 表一致:默认态(站在层首页)数据 448 / 报表 284 / 分析 300', () => {
    expect(navHeight(layer('data'), autoOpenTitles(layer('data'), 'data-home'))).toBe(448)
    expect(navHeight(layer('reports'), autoOpenTitles(layer('reports'), 'reports-home'))).toBe(284)
    expect(navHeight(layer('analysis'), autoOpenTitles(layer('analysis'), 'cockpit'))).toBe(300)
  })
  it.each(BUSINESS)('%s 层默认态 ≤ 500', (_id, L) => {
    expect(navHeight(L, autoOpenTitles(L, L.home))).toBeLessThanOrEqual(PANEL_BUDGET)
  })
  it.each(BUSINESS)('%s 层任一单组展开 ≤ 500', (_id, L) => {
    for (const s of L.sections) {
      if (!s.title) continue
      expect(navHeight(L, [s.title]), s.title).toBeLessThanOrEqual(PANEL_BUDGET)
    }
  })
})

describe('autoOpenTitles(§2.1 / §3.2)', () => {
  it('层首页:数据层开「出账」,报表层开「三大报表」,分析层不开组', () => {
    expect(autoOpenTitles(layer('data'), 'data-home')).toEqual(['出账 · 每月工序'])
    expect(autoOpenTitles(layer('reports'), 'reports-home')).toEqual(['三大报表'])
    expect(autoOpenTitles(layer('analysis'), 'cockpit')).toEqual([])
  })
  it('组内屏:只开含当前屏的那一组;无标题组的屏不开任何组', () => {
    expect(autoOpenTitles(layer('data'), 'salary')).toEqual(['记账 · 按月'])
    expect(autoOpenTitles(layer('analysis'), 'pv-roi')).toEqual(['能源专题'])
    expect(autoOpenTitles(layer('data'), 'import')).toEqual([])
    expect(autoOpenTitles(layer('data'), 'nope')).toEqual([])
  })
})
```

- [ ] **Step 2: 跑确认红**

```bash
cd frontend && npx vitest run src/nav/__tests__/navHeight.spec.ts
```
Expected: 整文件红（`../navFold` 找不到）。

- [ ] **Step 3: 写 navFold.ts**

新建 `frontend/src/nav/navFold.ts`：

```ts
// src/nav/navFold.ts — 侧栏分组折叠的纯规则(SIDEBAR-UX-REDESIGN §2.1 / §3.2)。
// 折叠按 section.title 派生,NavSection 不加字段。展开集合本身是 SidebarPanel 的内存态,
// 这里只回答「路由落在这一屏时,哪些组必须是开的」;SidebarPanel 只追加、不收回。
// navHeight.spec 用同一函数算默认态高度 —— 规则改了,预算断言跟着红。
import type { NavLayer } from './fpNav'

/** 站在层首页时默认展开的组:
 *  数据层「出账」(§2.1:当前屏为 data-home 或组内屏时展开 —— 首页就是来做本月出账的);
 *  报表层「三大报表」(§3.1 默认态 284 的算法前提)。分析层首页不开组(§3.1 默认态 300)。 */
const HOME_OPEN: Record<string, string> = { data: '出账 · 每月工序', reports: '三大报表' }

/** 路由落在 activeValue 时必须展开的组标题:层首页的默认组 + 含当前屏的带标题组。 */
export function autoOpenTitles(layer: NavLayer, activeValue: string): string[] {
  const out: string[] = []
  if (activeValue === layer.home && HOME_OPEN[layer.id]) out.push(HOME_OPEN[layer.id])
  for (const s of layer.sections) {
    if (s.title && s.items.some(it => it.value === activeValue)) out.push(s.title)
  }
  return out
}
```

- [ ] **Step 4: 跑确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/nav/__tests__/navHeight.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: 9 条绿（1 + `it.each` 3 + `it.each` 3 + 2）。

- [ ] **Step 5: 破坏验证**

往 `fpNav.ts` 的「出账 · 每月工序」组临时塞 3 个假项（`{ value: 'x1', label: 'x', icon: 'zap', kind: 'x' }` ×3）→ 跑 `navHeight.spec` → 「数据 层默认态 ≤ 500」红（556）、「任一单组展开」红、「算式与 spec 表一致」红（同一守卫家族，一起红是预期）；还原。把 `HOME_OPEN.data` 临时改成 `'档案'` → 「层首页」用例红且「算式与 spec 表一致」红（448 → 376）；还原。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/nav/navFold.ts frontend/src/nav/__tests__/navHeight.spec.ts
git commit -m "test(nav): 侧栏面板高度预算 500 钉住三层默认态与单组展开;折叠规则 autoOpenTitles(P4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: SidebarNav 可折叠标题 + 删死分支；SidebarPanel 展开态 + scrollIntoView

**Files:**
- Modify: `frontend/src/components/ds/SidebarNav.vue`
- Modify: `frontend/src/components/shell/SidebarPanel.vue`
- Create: `frontend/src/components/shell/__tests__/sidebarPanel.spec.ts`
- Modify: `frontend/src/components/ds/__tests__/sidebarLockNote.spec.ts`（+1）
- Modify: `docs/design/DESIGN-FIDELITY.md` §2.3

**Interfaces:**
- Consumes: `autoOpenTitles`（Task 3）；`presence.editorsUnder`（既有）；`SidebarNav` 既有 `editingHere`。
- Produces: `SidebarNav` 新 prop `openTitles?: string[]`（**不传 = 老行为全展开**，`sidebarLockNote.spec` 既有两条不动）与新事件 `toggle(title: string)`；标题行 `button.fp-sbnav-title[aria-expanded]`。P3 的 `sidebarPanel.spec` 会在本文件继续加「当前项 no-op / open / Shift」三条。

- [ ] **Step 1: 写 sidebarPanel.spec（先红）**

新建 `frontend/src/components/shell/__tests__/sidebarPanel.spec.ts`：

```ts
// 侧栏分组折叠(SIDEBAR-UX-REDESIGN §3.2):展开集合是内存态,换层清空;路由变化只追加含当前屏的组,不收回用户手动展开的组。
// P3 会在本文件续加侧栏点击语义(当前项 no-op / open / Shift)三条。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const route = reactive({ meta: { value: 'data-home' } as Record<string, string>, path: '/data-home' })
const push = vi.fn()
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push }) }))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import SidebarPanel from '../SidebarPanel.vue'

async function go(value: string) {
  route.meta = { value }
  route.path = '/' + value
  await nextTick()
  await nextTick()
}
const titleBtn = (w: VueWrapper, title: string) =>
  w.findAll('button.fp-sbnav-title').find(b => b.text().startsWith(title))!
const rows = (w: VueWrapper) => w.findAll('.fp-sbnav-row').map(b => b.text())

beforeEach(() => {
  setActivePinia(createPinia())
  route.meta = { value: 'data-home' }
  route.path = '/data-home'
  push.mockClear()
})

describe('SidebarPanel · 分组折叠(§3.2)', () => {
  it('站在首页:出账组展开,其余带标题组折叠,无标题项常显', () => {
    const w = mount(SidebarPanel)
    expect(rows(w)).toContain('本月出账')
    expect(rows(w)).toContain('导入中心')
    expect(rows(w)).toContain('计费参数')
    expect(rows(w)).not.toContain('租户管理')
    expect(rows(w)).not.toContain('月度台账')
    expect(titleBtn(w, '档案').attributes('aria-expanded')).toBe('false')
    expect(titleBtn(w, '出账 · 每月工序').attributes('aria-expanded')).toBe('true')
  })

  it('路由进组内屏只追加那一组,不收回用户手动展开的组', async () => {
    const w = mount(SidebarPanel)
    await titleBtn(w, '档案').trigger('click')
    expect(rows(w)).toContain('租户管理')
    await go('salary')
    expect(rows(w)).toContain('附表12 工资明细')   // 追加「记账 · 按月」
    expect(rows(w)).toContain('租户管理')          // 手动开的档案没被收回
    expect(rows(w)).toContain('计费参数')          // 首页默认开的出账也没被收回
  })

  it('点标题再点一次收起;换层清空展开集合', async () => {
    const w = mount(SidebarPanel)
    await titleBtn(w, '出账 · 每月工序').trigger('click')
    expect(rows(w)).not.toContain('计费参数')
    await titleBtn(w, '档案').trigger('click')
    await go('reports-home')                              // 换层:报表层首页默认开三大报表
    expect(rows(w)).toContain('利润表')
    expect(rows(w)).not.toContain('附表1 租金损益')
    await go('data-home')                                 // 回来:内存态已清,只剩首页默认的出账
    expect(rows(w)).toContain('计费参数')
    expect(rows(w)).not.toContain('租户管理')
  })

  it('换屏后把当前项 scrollIntoView(nearest)', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy   // jsdom 没有这个方法
    const w = mount(SidebarPanel)
    expect(spy).not.toHaveBeenCalled()       // 首次挂载不滚
    await go('import')
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' })
    expect(w.find('.fp-sbnav-row[data-on]').text()).toBe('导入中心')
  })
})

afterEach(() => {
  // @ts-expect-error jsdom 原本没有 scrollIntoView,恢复成没有
  delete Element.prototype.scrollIntoView
})
```

- [ ] **Step 2: sidebarLockNote.spec +1（先红）**

在 `frontend/src/components/ds/__tests__/sidebarLockNote.spec.ts` 的 `describe` 末尾加 —— 第 54 行 `  })` 收的是 `it('没人编辑时不画点')`，新用例放在它**之后**、第 55 行 `})`（收 `describe`）**之前**，别嵌进上一个 `it` 里：

```ts
  it('折叠的组把子项的编辑点聚到标题行;展开后点回到子项(SIDEBAR-UX-REDESIGN §3.2)', async () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ title: '出账', items: ITEMS }], openTitles: [] } })
    expect(w.find('.fp-sbnav-row').exists()).toBe(false)                            // 收着
    const title = w.find('button.fp-sbnav-title')
    expect(title.find('span[title*="张三 正在编辑"]').exists()).toBe(true)           // 聚合点在标题行
    await title.trigger('click')
    expect(w.emitted('toggle')).toEqual([['出账']])                                  // 开合由外层决定
    await w.setProps({ openTitles: ['出账'] })
    expect(w.find('button.fp-sbnav-title span[title*="正在编辑"]').exists()).toBe(false)
    expect(w.find('.fp-sbnav-row span[title*="张三 正在编辑"]').exists()).toBe(true)  // 点回到子项行
  })
```

- [ ] **Step 3: 跑两份 spec 确认红**

```bash
cd frontend && npx vitest run src/components/shell/__tests__/sidebarPanel.spec.ts src/components/ds/__tests__/sidebarLockNote.spec.ts
```
Expected: `sidebarPanel.spec` 4 条红（没有 `button.fp-sbnav-title`）；`sidebarLockNote` 新 1 条红、旧 2 条绿。

- [ ] **Step 4: 改 SidebarNav.vue**

(a) 接口与 props：`SidebarNavProps` 里 `collapsed?: boolean;` 改为 `/** 传了就按标题折叠:不在集合里的带标题组只画标题行;不传 = 全部展开(老行为) */ openTitles?: string[];`；`SidebarItem.shortcut` 保留字段但删掉它唯一的消费点（在被删的 tip 里）。`props` 里 `collapsed: { type: Boolean, default: false },` 改为 `openTitles: { type: Array as () => string[], default: undefined },`；`emits: ["select", "update:modelValue", "toggle"]`。

(b) 删第 132-134 行（`// folded-rail hover / flyout state` 与 `hoverVal` / `flyout` 两个 ref），`select()` 里删 `flyout.value = null;`。

(c) 在 `renderTree` 之后、`// ---- render` 之前加：

```ts
    // ---- 组标题 ----------------------------------------------------------
    // 像素同 DESIGN-FIDELITY §2.3(--type-label / 6px 12px → 30px 行)。可折叠时是 button:
    // chevron 与折叠态的「有人在编辑」聚合点都 absolute —— 出现与消失不改行的尺寸(LAYOUT-STABILITY)。
    const TITLE_STYLE: Record<string, string> = { font: "var(--type-label)", color: "var(--text-muted)", padding: "6px 12px" };
    function renderTitle(sec: SidebarSection, foldable: boolean, open: boolean) {
      if (!foldable) return h("div", { style: TITLE_STYLE }, [sec.title]);
      // 收起的组把子项的在场提示聚到标题上:组收着也得知道里面有人在改
      const notes = open ? [] : sec.items.map((it) => editingHere(it.value)).filter((n): n is string => !!n);
      return h("button", {
        class: "fp-sbnav-title",
        type: "button",
        "aria-expanded": open ? "true" : "false",
        style: {
          ...TITLE_STYLE, color: "var(--fp-sbnav-title-c)",
          position: "relative", display: "block", width: "100%", textAlign: "left",
          border: "none", background: "transparent", cursor: "pointer", boxSizing: "border-box",
        },
        onClick: () => emit("toggle", sec.title),
      }, [
        sec.title,
        h("span", { style: { position: "absolute", right: "12px", top: "50%", marginTop: "-7px", display: "inline-flex" } }, [Chevron(open)]),
        notes.length
          ? h("span", {
              title: notes.join("\n"),
              style: {
                position: "absolute", right: "32px", top: "50%", marginTop: "-3px",
                width: "6px", height: "6px", borderRadius: "50%", background: "var(--hue-orange)",
              },
            })
          : null,
      ]);
    }
```

(d) `return () => { ... }` 整个替换为（删掉第 223-320 行的折叠轨道分支）：

```ts
    return () =>
      h("nav", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
        props.sections.map((sec, si) => {
          // 带标题组可折叠(SIDEBAR-UX-REDESIGN §3.2):openTitles 未传 = 老行为,全部展开
          const foldable = !!sec.title && props.openTitles !== undefined;
          const open = !foldable || props.openTitles!.includes(sec.title!);
          return h("div", { key: si, style: { display: "flex", flexDirection: "column", gap: "2px" } }, [
            sec.title ? renderTitle(sec, foldable, open) : null,
            ...(open ? renderTree(sec.items, 0) : []),
          ]);
        })
      );
```

(e) `<style>` 里删 `.fp-sbnav-tip` 与 `.fp-sbnav-flyout` 两段（含它们的注释），加：

```css
/* 组标题按钮:颜色走变量,inline 的 color 才能被 :hover 盖到(与行的 --fp-sbnav-bg 同一招)。 */
.fp-sbnav-title { --fp-sbnav-title-c: var(--text-muted); }
.fp-sbnav-title:hover { --fp-sbnav-title-c: var(--text-secondary); }
```

(f) 文件头 docblock 加一行：`* 2026-09-03(SIDEBAR-UX-REDESIGN §3.2):加 openTitles / toggle 做组折叠;删掉全仓零调用点的 collapsed 折叠轨道与 flyout 分支。`

- [ ] **Step 5: 改 SidebarPanel.vue**

script 部分：

```ts
import { computed, h, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { fpFindLayer } from '@/nav/fpNav'
import { autoOpenTitles } from '@/nav/navFold'
import { visibleLayers } from '@/nav/navAccess'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import SidebarNav from '@/components/ds/SidebarNav.vue'
```

在 `sections` computed 之后、`onSelect` 之前加：

```ts
// 折叠(SIDEBAR-UX-REDESIGN §3.2):展开集合是内存态,换层清空,不落盘;
// 路由变化只**追加**含当前屏的组(与层首页默认组),不收回用户手动展开的组 —— 收回等于替人做主。
const openTitles = ref<string[]>([])
watch([activeLayer, activeValue], ([L, v], prev) => {
  const base = prev && L === prev[0] ? openTitles.value : []
  openTitles.value = [...new Set([...base, ...autoOpenTitles(L, v)])]
}, { immediate: true })
function onToggle(title: string) {
  openTitles.value = openTitles.value.includes(title)
    ? openTitles.value.filter(t => t !== title)
    : [...openTitles.value, title]
}

// 用户手动多开超出面板高度时 .fp-panel 自己滚(overflow-y:auto 早就有);换屏后把当前项滚进视野 ——
// 此前附表 6 起 9 行在折叠线下也不滚(§1)。jsdom 无 scrollIntoView,可选调用兜底。
const panelEl = ref<HTMLElement | null>(null)
watch(activeValue, () => {
  void nextTick(() => panelEl.value?.querySelector('.fp-sbnav-row[data-on]')?.scrollIntoView?.({ block: 'nearest' }))
})
```

template：`<div class="fp-panel">` 改为 `<div ref="panelEl" class="fp-panel">`；`<SidebarNav ... />` 改为：

```vue
    <SidebarNav
      :sections="sections"
      :active="activeValue"
      :open-titles="openTitles"
      @select="onSelect"
      @toggle="onToggle"
    />
```

- [ ] **Step 6: 跑 spec 确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/components/shell src/components/ds/__tests__/sidebarLockNote.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: `sidebarPanel.spec` 4 绿、`sidebarLockNote` 3 绿、`palette.spec` 绿；vue-tsc 零错。

- [ ] **Step 7: 破坏验证**

把 `SidebarPanel` watch 里 `const base = prev && L === prev[0] ? openTitles.value : []` 改成 `const base: string[] = []` → 只有「只追加那一组,不收回」红；还原。把 `? openTitles.value : []` 改成 `? openTitles.value : openTitles.value` → 只有「换层清空」红；还原。删掉 `scrollIntoView` 那个 watch → 只有「scrollIntoView」红；还原。把 `renderTitle` 里 `const notes = open ? [] : ...` 改成 `const notes: string[] = []` → 只有 `sidebarLockNote` 新那条红；还原。

- [ ] **Step 8: DESIGN-FIDELITY §2.3 修订记录**

`docs/design/DESIGN-FIDELITY.md` §2.3 表格之后、`### 2.4` 之前（第 69 行空行处，第 68 行是表格最后一行 `| padding | \`6px 12px\` |`）加：

```
> **2026-09-03 修订（SIDEBAR-UX-REDESIGN §3.2）**：带标题的组可点折叠。标题行由 `div` 改为 `button.fp-sbnav-title`，**像素不变**（同 font / color / padding，高 30px = 18 行高 + 6×2）；右侧加 14px chevron（`position:absolute; right:12px`，收起朝右、展开朝下）；组收起时子项的在场点聚合到标题行（6px 橙点，`absolute; right:32px`，`title` 拼子项文案）。两者都是绝对定位，出现与消失不改变行尺寸（LAYOUT-STABILITY）。无标题组不折叠、无 chevron。悬停时标题色 `--text-muted` → `--text-secondary`。
```

- [ ] **Step 9: 提交**

```bash
git add frontend/src/components/ds/SidebarNav.vue frontend/src/components/shell/SidebarPanel.vue frontend/src/components/shell/__tests__/sidebarPanel.spec.ts frontend/src/components/ds/__tests__/sidebarLockNote.spec.ts docs/design/DESIGN-FIDELITY.md
git commit -m "feat(sidebar): 带标题组可折叠(只追加不收回、换层清空、聚合在场点)+ 当前项滚进视野;删 SidebarNav 零调用的折叠轨道分支(P4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 顶栏死钮清理 + 命令面板按分组名匹配

**Files:**
- Modify: `frontend/src/components/shell/Toolbar.vue:3-17, 43-45, 59-67`
- Create: `frontend/src/components/shell/__tests__/toolbar.spec.ts`
- Modify: `frontend/src/nav/fpNav.ts`（`export function fpAllPages()` 那三行，Task 1 后约 :92-94，按内容定位；输出加 `group`）
- Modify: `frontend/src/components/shell/paletteFilter.ts:6-13, 27-29, 52-60`
- Modify: `frontend/src/components/shell/CommandPalette.vue:74`
- Modify: `frontend/src/components/shell/__tests__/palette.spec.ts`（+1）

**Interfaces:**
- Consumes: `tabs.pin(value)`（既有）；Task 1 的组标题。
- Produces: `PageEntry.group?: string`；`fpAllPages()` 每项多 `group?: string`。

- [ ] **Step 1: 写 toolbar.spec 与 palette.spec 新用例（先红）**

新建 `frontend/src/components/shell/__tests__/toolbar.spec.ts`：

```ts
// 顶栏死钮清理(SIDEBAR-UX-REDESIGN §6):★ 接 tabs.pin,☀ 删,搜索钮只承诺它做得到的。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'tenants', page: '租户管理', layerLabel: '数据中心' }, path: '/tenants' }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import Toolbar from '../Toolbar.vue'

const mountBar = () => mount(Toolbar, { global: { stubs: { FPPresenceBar: true } } })

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('Toolbar · 死钮清理(§6)', () => {
  it('★ = 把当前屏固定为常驻页签;已固定时按钮呈激活态', async () => {
    const w = mountBar()
    const tabs = useTabsStore()
    const star = w.find('button[aria-label="固定为常驻页签"]')
    expect(tabs.tabs.map(t => t.value)).not.toContain('tenants')
    expect(star.attributes('data-active')).toBeUndefined()
    await star.trigger('click')
    expect(tabs.tabs.map(t => t.value)).toContain('tenants')
    expect(w.find('button[aria-label="固定为常驻页签"]').attributes('data-active')).toBe('')
  })
  it('主题钮删除;搜索钮只承诺「页面 / 分组」', () => {
    const w = mountBar()
    expect(w.find('button[aria-label="浅色/深色模式"]').exists()).toBe(false)
    expect(w.find('.fp-search-btn').attributes('title')).toBe('搜索页面 / 分组（Ctrl K）')
    expect(w.find('.fp-search-btn').text()).toContain('搜索页面 / 分组')
    expect(w.find('.fp-search-btn').text()).not.toContain('租户')
  })
})
```

`frontend/src/components/shell/__tests__/palette.spec.ts` 末尾 `})` 之前加：

```ts
  it('按分组名匹配:「档案」命中楼栋 / 租户 / 合同(§6:搜索承诺改成「页面 / 分组」,面板就得真按分组找)', () => {
    const groups = filterPages('档案', allPages, [])
    expect(groups[0].items.map(p => p.value)).toEqual(['buildings', 'tenants', 'contracts'])
    expect(allPages.find(p => p.value === 'salary')!.group).toBe('记账 · 按月')
    expect(allPages.find(p => p.value === 'data-home')!.group).toBeUndefined()   // 无标题组
  })
```

- [ ] **Step 2: 跑确认红**

```bash
cd frontend && npx vitest run src/components/shell/__tests__/toolbar.spec.ts src/components/shell/__tests__/palette.spec.ts
```
Expected: toolbar 2 条红（找不到 `固定为常驻页签` 按钮 / 主题钮仍在）；palette 新 1 条红（`group` 不存在 → vue-tsc 也会报，先看 vitest）。

- [ ] **Step 3: 改 Toolbar.vue**

script：第 17 行 `import { PanelLeft, Star, Search, Sun, History, Bell } from 'lucide-vue-next'` 去掉 `Sun`；加 `import { useTabsStore } from '@/stores/tabs'`；在 `const crumbPage` 之后加：

```ts
// ★ 从此有事做了(SIDEBAR-UX-REDESIGN §6):把当前屏从预览槽固定成常驻页签。已固定时呈激活态,再点是空操作。
const tabs = useTabsStore()
const activeValue = computed(() => meta.value.value ?? '')
const pinned = computed(() => tabs.tabs.some(t => t.value === activeValue.value))
```

template：第 43-45 行改为

```vue
    <IconButton aria-label="固定为常驻页签" :active="pinned" @click="tabs.pin(activeValue)">
      <Star :size="16" />
    </IconButton>
```

第 59-67 行改为（删主题钮）：

```vue
      <button class="fp-search-btn" title="搜索页面 / 分组（Ctrl K）"
              @click="emit('open-command', 'jump')">
        <Search :size="15" />
        <span>搜索页面 / 分组…</span>
        <kbd class="fp-kbd">Ctrl K</kbd>
      </button>
```

第 25 行注释「它此前是顶栏四个死按钮之一(收藏 / 主题 / 操作记录 / 通知)」后补「;2026-09-03 收藏接 tabs.pin、主题钮删除,死按钮清零」。

- [ ] **Step 4: fpAllPages 加 group；paletteFilter 匹配 group；面板占位文案**

`frontend/src/nav/fpNav.ts` 里 `export function fpAllPages()` 的三行（签名 / `return` / `}`；Task 1 后约 :92-94，按内容定位）改为：

```ts
/** 全部屏 + 所属层;`group` 是所在带标题组的标题(无标题组为 undefined),派生字段,只给命令面板搜索用,fpBuildRoutes 不吃。 */
export function fpAllPages(): (NavItem & { layer: string; layerLabel: string; layerIcon: string; group?: string })[] {
  return FP_NAV.flatMap(L => L.sections.flatMap(s => s.items.map(it => ({ ...it, layer: L.id, layerLabel: L.label, layerIcon: L.icon, group: s.title }))))
}
```

`frontend/src/components/shell/paletteFilter.ts`：`PageEntry` 加 `group?: string`（注释 `/** 所在带标题组;搜索按它也能命中 */`）；`filterPages` 的 `hits` 改为：

```ts
    const hits = allPages.filter(p =>
      p.label.toLowerCase().includes(lo) || p.layerLabel.toLowerCase().includes(lo) || (p.group ?? '').toLowerCase().includes(lo)
    )
```

第 22 行 docblock「substring on label or layerLabel」改「substring on label / layerLabel / group」；`buildAllPages` 的映射里加 `group: p.group,`。

`frontend/src/components/shell/CommandPalette.vue` 第 74 行 `placeholder="跳转到页面 — 输入页面名或所属模块…"` 改为 `placeholder="跳转到页面 — 输入页面名或分组名…"`。

- [ ] **Step 5: 跑确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/components/shell src/nav && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: 全绿；vue-tsc 零错。

- [ ] **Step 6: 破坏验证**

把 `@click="tabs.pin(activeValue)"` 临时删掉 → 只有 toolbar 第 1 条红；还原。把 `|| (p.group ?? '')...` 那段删掉 → 只有 palette 新那条红；还原。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/shell/Toolbar.vue frontend/src/components/shell/__tests__/toolbar.spec.ts frontend/src/nav/fpNav.ts frontend/src/components/shell/paletteFilter.ts frontend/src/components/shell/CommandPalette.vue frontend/src/components/shell/__tests__/palette.spec.ts
git commit -m "feat(shell): 收藏钮固定当前页签、主题钮删除;搜索按分组名也能命中,文案不再承诺租户/凭证(P4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 门禁 + 对抗复查 + 复查记录

**Files:** 无代码改动（修复由复查结论另开修复轮）；`docs/superpowers/plans/2026-09-03-p4-nav-regroup-fold.md` 末尾追加「复查记录」。

- [ ] **Step 1: 全量门禁**

```bash
cd frontend && npx vitest run && npm run build
```
Expected: vitest 全绿（基线 179 files / 2132 tests → 182 files / 2153 tests；本期 +3 文件、+21 条：fpNav +3、routeMap +1、navHeight +9、sidebarPanel +4、sidebarLockNote +1、toolbar +2、palette +1）；`npm run build` 绿，size-check 打印 index ≤ 191KB。**若 index 超线**：本期不上调预算 —— 先确认瘦身真做到了：`grep -n "fp-sbnav-tip\|fp-sbnav-flyout\|hoverVal\|props.collapsed" src/components/ds/SidebarNav.vue` 应为空，`Toolbar.vue` 无 `Sun` import；仍超则把 `navFold.ts` 并进 `fpNav.ts`（少一个模块壳），并在复查记录里写明实测数字与超线原因。注释长短不影响产物体积（构建剥注释），别拿它当瘦身。

- [ ] **Step 2: 后端不动，不跑 mvn**

本期零后端改动；`DataHomeApiIT` 与 `DataHomeServiceTest` 不受影响。

- [ ] **Step 3: 对抗复查（三镜头 → 逐条反驳）**

控制者按 subagent-driven-development 的最终复审流程对 `7cb21b9..HEAD` 中本期提交跑一次对抗复查，三个镜头：
1. **正确性**：折叠追加 / 收回 / 换层规则；`autoOpenTitles` 与 spec §3.1 三个数字；`/bank-flow` 重定向对既有页签 / 最近访问 / 书签的影响；`fpAllPages` 加字段对 `fpBuildRoutes`、`tabs`、`router` 的零影响。
2. **护栏**：`navHeight.spec` 能否被绕过（往无标题组塞屏、改 `HOME_OPEN`）；`routeMap.spec` 阳性对照是否真能发现构建工具改写；破坏验证是否逐条做了。
3. **像素 / 用户价值**：标题行 30px 是否真的没变（button 的 UA 样式：`font` 继承、`padding`、`line-height`）；chevron / 聚合点是否绝对定位零位移；DESIGN-FIDELITY 修订与实现一致；S 档抽屉不受影响。
每条发现一名反驳者；坐实的进一次修复波 + 定向复审。

- [ ] **Step 4: 复查记录**

在本文件末尾追加「## 复查记录（日期）」：任务级评审结果表、对抗复查发现表（含被驳条目）、修复提交、门禁数字（vitest files / tests、size-check index 与合计）、遗留。

- [ ] **Step 5: 提交复查记录**

```bash
git add docs/superpowers/plans/2026-09-03-p4-nav-regroup-fold.md
git commit -m "docs(plan): P4 复查记录

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 自查（对 spec §2 / §3 / §6 / §9 P4 / §10）

- §2.1 四组 + caption + `contracts` 入档案 + 月 / 年分组 + `bank-flow` 删 + 注释：Task 1 / 2。
- §2.2 报表层不变：Task 1 断言。
- §2.3 分析层六组 + `anomaly` 第 2 项 + `pv-meter-analysis` 图标 + `anaData` 改 `fpAllPages` + PV-ANALYSIS-SPEC 随迁：Task 1。
- §3.1 `PANEL_BUDGET = 500` 一处 + 三层默认态 / 单组展开 ≤ 500 + 破坏验证「塞 3 假项」：Task 3。
- §3.2 标题 `button` 30px + chevron absolute + `openTitles` 内存态换层清空 + 只追加不收回 + 面板滚动 + `scrollIntoView` + 折叠组聚合在场点 + 删折叠轨道 / flyout + DESIGN-FIDELITY §2.3 修订：Task 4。
- §3.3 在场点 `scopePeriod` / `editingNote` / Popover：**P2**，本期不做（spec §9 P2 行明写）。
- §6 收藏 ★ / 主题 ☀ / 搜索文案 + `group` 字段 + `filterPages` + 面板占位：Task 5。§6 其余（页签定宽 / chip / 角色行 / 落地页 / `AnaEmpty` / IconRail aria-label）属 P3 / P5。
- §9 P4 破坏验证三条：塞 3 假项 `navHeight` 红（Task 3 Step 5）；`anomaly` 放回末尾 `fpNav.spec` 红（Task 1 Step 6）；DESIGN-FIDELITY 像素比对（Task 6 镜头 3）。
- §10 改数：`fpNav.spec` 51 → 50 + 四条新断言 ✓；`routeMap.spec` ✓；`tabs.spec:80-85` 基底页签属 P5，本期不动（`:92` 的 `bank-flow` 换值是必要连带）。新增 `navHeight.spec` ✓、`sidebarPanel.spec`（本期两条：折叠追加不收回 / scrollIntoView，外加换层清空与首页默认态；当前项 no-op / open / Shift 三条留 P3）✓、`sidebarLockNote.spec` +1（折叠组聚合点；期 / aria 两条留 P2）✓、`palette.spec` +1 ✓、`toolbar.spec`（spec 未列，死钮清理的最小护栏）✓。
- 类型一致性：`autoOpenTitles(layer: NavLayer, activeValue: string): string[]`（Task 3 定义，Task 4 消费）；`SidebarNav` `openTitles?: string[]` / `toggle(title: string)`（Task 4 内自洽）；`PageEntry.group?: string` 与 `fpAllPages()` 的 `group?: string`（Task 5 内自洽）。

## 复查记录（2026-09-03）

**计划级对抗复查（实施前，3 镜头 → 每条 3 名反驳者）**：19 条发现，8 坐实、11 被驳。坐实归三类，提交前修入计划（63360ae）：`sidebarLockNote.spec` 插入点差一行（会把新用例嵌进上一个 `it`）；用例计数（`navHeight` 9 条、门禁 +21）；size 超线兜底写法（注释不影响体积、grep 路径）。顺手修：DESIGN-FIDELITY 插入行、fpNav 行号改按内容定位、ENERGY-ANALYSIS-SPEC 三处组名随迁。

**任务级评审（每任务一次，独立评审员）**

| 任务 | 提交 | 结果 |
|---|---|---|
| T1 fpNav 重分组 | 8249b58 | 通过，零发现（字面量含 U+00B7 中点逐字核对） |
| T2 路由重定向 + 护栏 | a004a76（+67e1ebc） | 通过；Minor：注释里 `:99` 行号已漂移 → 控制者改成不带行号 |
| T3 navFold + navHeight.spec | 68804b3 | 通过；Minor：`autoOpenTitles` 不去重（home 若日后落进带标题组会双推；SidebarPanel 侧 `Set` 兜住） |
| T4 折叠 + 删死分支 | 3818df0 | 通过；Minor ×4：`toggle` 一名两义 / chevron 悬停仍 muted / 未测「进折叠组内屏 → 展开 + 滚动」组合路径 / 标题无 ellipsis |
| T5 死钮 + 分组搜索 | 20a551c | 通过，零发现 |

**代码级对抗复查（3 镜头：正确性 / 护栏 / 像素与用户价值 → 每条 3 名反驳者）**：11 条发现，0 坐实，11 被驳（全部 3/3）。值得留痕的三条：

| # | 发现 | 处置 |
|---|---|---|
| C1 / G1 / L1 | 「只追加不收回」下纯导航两步即超预算：数据层 首页 → 附表12 = 556px；出账 + 按年同开 = 628；四组全开 844；分析层三组 624 | 被驳：spec §3.2 明写只追加 + 超预算面板滚动 + `scrollIntoView`；护栏范围 = spec §3.1 两列。**裁定**：spec §3.2 补一句「同层内连续导航累积同样会超预算」，可达数字记在这里不进断言 |
| L2 | 命令面板按分组名命中，但结果行不显示分组 | 被驳：§6 逐项列的改法里没有；记入 P6（命令面板「本月」组）一并看 |
| L6 | ★ 已固定态只有 `data-active`，读屏拿不到 | 被驳：spec 只钉 `aria-label`；记入 P3（页签 / chip 改 Toolbar 时补 `aria-pressed`） |

其余被驳：C2 展开集合随面板卸载而丢（spec 「SidebarPanel 内」的形状）、C3 ★ 悬停与激活同底色（页签条同时变化）、G2 像素常量手抄（计划级 P4-SC-01 同裁定）、L3 PV-ANALYSIS-SPEC §09 / §10.3 旧句（改前已旧）、L4 RESPONSIVE 一句读感、L5 palette.spec 夹具留 `bank-flow`（计划明写）。复查纪律一处：正确性镜头留了 `zzprobe.spec.ts` 未删，被反驳者抓到；收尾时控制者核 `git status` 干净。

**门禁**：全量 vitest 182 files / 2153 tests（基线 179 / 2132，+3 / +21 与计划一致）；`npm run build` 绿，size-check index 189.1KB / 191（基线 190.5，死分支删除净省 1.4KB），合计 3868.9 / 3900。后端零改动。

**遗留（后续期）**：P3 改 Toolbar 时补 ★ `aria-pressed`、chevron 悬停跟标题变色、标题 ellipsis；P6 命令面板行内显示分组；浏览器级人工走查（三层首页一屏、点组标题折叠、进组内屏自动展开并滚到当前项、★ 固定）由用户做。
