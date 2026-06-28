# demo3 P0-C 应用外壳 + 登录 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把设计稿的应用外壳（两浮卡 + 图标导轨 + 二级栏 + 浏览器风页签 + Toolbar + Ctrl-K 命令面板）1:1 港到 Vue 3，挂上 39 屏路由（非 P0 屏占位），并加登录页 + JWT 接线（连 P0-A 后端）。

**Architecture:** 事实源是 React 原型 `_handoff_extracted/untitled/project/app/shell.jsx` + `app.jsx`（像素谱见下，逐任务照源港）。外壳复用 P0-B 的 DS 组件（SidebarNav/Avatar/IconButton/SearchField/Button）。导航单一事实源 `fpNav.ts` 驱动外壳渲染 + 路由 + 命令面板。登录是工程增项（设计无登录页），包在外壳外。

**Tech Stack:** Vue 3 `<script setup lang=ts>` · Vite · Pinia（tab/sidebar/auth 状态 + localStorage 持久化）· Vue Router 4 · axios（P0-B 已配 Bearer+解包）· Vitest · lucide-vue-next（图标）。

## Global Constraints

- 包/目录：前端在 `C:\financial_dashboard\demo3\frontend`，组件 `src/components/shell/`，视图 `src/views/`，导航 `src/nav/`，store `src/stores/`。
- **完全照设计**：颜色/字号/间距/圆角/交互态只用 `src/styles/tokens.css` 的 `var(--token)`，**禁紫禁绿**，禁臆造令牌。像素谱（下）逐值复现。
- 事实源：`C:\financial_dashboard\_handoff_extracted\untitled\project\app\shell.jsx` 与 `app.jsx`（实现者必读对应段落照港）。logo 资源 `C:\financial_dashboard\Factory Park Design System\assets\factory-park-mark.svg`（复制到 `frontend/src/assets/`）。
- 设计**无登录页**：登录为工程增项，路由守卫拦截未登录→`/login`，登录连 P0-A `POST /api/auth/login`（dev: admin/admin123）。
- 状态持久化 localStorage 键沿用原型：`fp-app-nav`/`fp-app-tabs`/`fp-app-preview`/`fp-app-recent`(max8)/`fp-app-sb`。
- 门禁：`npm run build`（vue-tsc + vite）green + `npm run test`（vitest）green。逻辑重的部分（fpNav 路由、tab store、命令面板过滤、auth guard）写 vitest；视觉用 build + 运行期肉眼（preview）。
- 提交信息结尾：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`；分支 `feature/p0c-shell`。

## 像素谱（出自 shell.jsx / app.jsx，逐值复现）

- **根 stage**：flex row，`height:100%; overflow:hidden; padding:12; gap:12; box-sizing:border-box`。内含两张浮卡。
- **导航卡**（`.fp-nav`）：`flex:0 0 auto; height:100%; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-2xl)(24); overflow:hidden`。flex row：IconRail + 竖分隔(仅 panelOpen) + SidebarPanel。
- **主卡**：`flex:1; min-width:0; display:flex; flex-direction:column; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:24; overflow:hidden`。竖排：TabStrip → Toolbar → content。
- **IconRail**（`.fp-rail`）：`width:66; flex:0 0 auto; flex-column; align-items:center; padding:14px 9px; gap:5; background:var(--surface-sunken)`。① 品牌标 40×40 `radius:13` 白底发丝边 grid 居中，内嵌 svg 22×22；② 分隔 30×1px `margin:9px 0 7px` `--border-subtle`；③ 每层一枚 rail-btn `width:48; border-radius:15; padding:9px 0 7px` 列向(icon size20 + short 标签 10.5px) `color:var(--text-muted)`，hover `background:rgba(28,28,28,.05)`，激活 `.on`→`background:var(--ink-900); color:#fff; box-shadow:0 6px 16px rgba(28,28,28,.20)`；点非激活层→跳该层 `home`；④ 底部 `margin-top:auto`：命令面板按钮 40×40 `radius:13` 发丝边(command 图标) + `<Avatar name="周明" :size="32"/>`。
- **竖分隔**（`.fp-vdiv`）：1px `--border-subtle`，仅 `panelOpen`。
- **SidebarPanel**（`.fp-panel`）：`width:234; flex:0 0 auto; flex-column; gap:14; padding:18px 14px 14px; overflow-y:auto`，仅 `sbOpen`。头部：层 icon size18 + 层 label 16px/semibold；分隔 full-bleed `margin:0 -14`；`<SidebarNav :active :sections @select>` 渲染当前层 sections。
- **TabStrip**（`.fp-tabstrip`，在 Toolbar **之上**）：`height:44; flex:0 0 auto; flex row; padding:0 8; gap:6; border-bottom:1px solid var(--divider); background:var(--surface-card)`。tabs 容器 `flex:1` 横向滚动(滚动条隐藏) `padding:6px 0; gap:3`。tab `flex:1 1 0; min-width:42; max-width:196; height:32; padding:0 6px 0 11; border-radius:8`，icon14+label12.5+trailing；激活 `.on`→白底 `box-shadow:0 1px 3px rgba(28,28,28,.10); min-width:124; 字重 semibold`；预览态 label 斜体。浏览器模型：单击=预览(单槽,下次导航替换)；双击/钉按钮=钉住；>1 视图时显关闭。actions(左发丝边)：溢出"全部页签"下拉(显计数,ResizeObserver 溢出才出) + 新建"+"(28×28,开命令面板 new 模式)。
- **Toolbar**（`.fp-toolbar`，TabStrip **之下**）：`height:48; flex row; gap:8; padding:0 16; border-bottom:1px solid var(--divider); background:var(--surface-overlay); backdrop-filter:blur(8px)`。左：panel-left IconButton(切侧栏) + star IconButton；面包屑 `层label(muted) / 页名(medium primary)`；右 `margin-left:auto`：搜索按钮(胶囊 min-width200，search 图标 + "搜索页面 / 租户 / 凭证…" + `Ctrl K` kbd，开命令面板) + sun/history/bell IconButton。
- **content**（app.jsx）：`kind==='ana'` → `<AnalysisShell>`(P3,本期对 ana 屏走 PlaceholderView)；否则 `<main flex:1; overflow-y:auto; scrollbar-gutter:stable both-edges; padding:24>`。
- **命令面板**：Ctrl/Cmd+K 切换(`preventDefault`)。backdrop `position:fixed; inset:0; z-index:200; background:rgba(28,28,28,.32); backdrop-filter:blur(2px); padding-top:11vh`，顶部居中。panel `width:min(620px,92vw); max-height:70vh; border-radius:16; box-shadow:0 24px 64px rgba(28,28,28,.28)`。输入 autofocus(30ms)；空查询→"最近访问"(max5)+每层一组；输入→按 label/层label 子串过滤；键盘 ↑↓ 移动 / Enter 打开 / Esc 关；选中 `go(value,{pin: mode==='new'})`。

---

## File Structure

```
frontend/src/
├─ nav/fpNav.ts            FP_NAV(39屏3层) + fpFindLayer/fpBuildRoutes/fpAllPages
├─ router/index.ts         由 fpNav 生成路由 + /login + 守卫
├─ stores/
│  ├─ auth.ts              token + login()/logout() + 当前用户
│  ├─ tabs.ts              页签模型(预览/钉住/最近)+持久化
│  └─ ui.ts                sidebar 开合 + 当前 layer/nav + 持久化
├─ components/shell/
│  ├─ AppShell.vue         两浮卡组合
│  ├─ IconRail.vue         图标导轨
│  ├─ SidebarPanel.vue     二级栏(用 DS SidebarNav)
│  ├─ TabStrip.vue         浏览器风页签
│  ├─ Toolbar.vue          顶部工具条
│  └─ CommandPalette.vue   Ctrl-K 命令面板
├─ views/
│  ├─ PlaceholderView.vue  非 P0 屏占位
│  └─ LoginView.vue        登录页
├─ assets/factory-park-mark.svg
└─ App.vue                 /login 独立布局 vs 外壳布局
```

---

### Task 1: 导航单一事实源 fpNav + 路由 + 占位屏

**Files:**
- Create: `src/nav/fpNav.ts`, `src/router/index.ts`, `src/views/PlaceholderView.vue`
- Modify: `src/main.ts`（已 use(router)；确认）
- Test: `src/nav/__tests__/fpNav.spec.ts`

**Interfaces:**
- Produces: `FP_NAV: Layer[]`；`type Layer={id,label,short,icon,caption,home,sections:Section[]}`；`type Section={title?:string, items:Item[]}`；`type Item={value,label,icon,kind}`；`fpBuildRoutes(): Record<string,RouteMeta>`（含 layer/layerLabel/layerIcon/page/icon/kind）；`fpFindLayer(value)`；`fpAllPages(): Item[] flat`。
- Consumes: 无。

- [ ] **Step 1: 写 fpNav.ts**（39 屏，照 shell.jsx 的 `FP_NAV`，结构如下，**逐项照源补全 value/label/icon/kind**）

```ts
// src/nav/fpNav.ts — 导航单一事实源(39屏×3层)。源: app/shell.jsx FP_NAV。
export interface NavItem { value: string; label: string; icon: string; kind: string }
export interface NavSection { title?: string; items: NavItem[] }
export interface NavLayer { id: string; label: string; short: string; icon: string; caption: string; home: string; sections: NavSection[] }

export const FP_NAV: NavLayer[] = [
  { id: 'data', label: '数据中心', short: '数据', icon: 'database', caption: '录入与维护 · 数据进来的地方', home: 'data-home', sections: [
    { items: [{ value: 'data-home', label: '数据中心首页', icon: 'layout-dashboard', kind: 'data-home' }] },
    { title: '主数据', items: [
      { value: 'buildings', label: '楼栋管理', icon: 'building-2', kind: 'buildings' },
      { value: 'tenants', label: '租户管理', icon: 'users', kind: 'tenants' },
      { value: 'contracts', label: '合同管理', icon: 'file-text', kind: 'contracts' } ] },
    { title: '业务流水', items: [
      { value: 'ledger', label: '月度台账', icon: 'book-open', kind: 'ledger' },
      { value: 'bills', label: '账单管理', icon: 'receipt', kind: 'placeholder' },
      { value: 'bank-flow', label: '银行流水', icon: 'landmark', kind: 'placeholder' } ] },
    { title: '成本与收入录入', items: [
      { value: 'pv-income', label: '附表6 光伏发电', icon: 'sun', kind: 'schedule6' },
      { value: 'car-charging', label: '附表7 汽车充电桩', icon: 'car', kind: 'schedule7' },
      { value: 'ebike-charging', label: '附表8 电动车充电桩', icon: 'bike', kind: 'schedule8' },
      { value: 'sales-income', label: '附表10 销售收入', icon: 'coins', kind: 'sales' },
      { value: 'elec-cost', label: '附表11 电费成本', icon: 'zap', kind: 'schedule11' },
      { value: 'salary', label: '附表12 工资明细', icon: 'wallet', kind: 'schedule12' },
      { value: 'utilities', label: '办公·三期水电', icon: 'plug', kind: 'utilities' } ] },
    { items: [{ value: 'import', label: '导入中心', icon: 'upload', kind: 'import' }] },
  ] },
  { id: 'reports', label: '账簿与报表', short: '报表', icon: 'book-marked', caption: '核算输出 · 单一事实来源', home: 'reports-home', sections: [
    { items: [{ value: 'reports-home', label: '报表中心', icon: 'layout-dashboard', kind: 'reports-home' }] },
    { title: '三大报表', items: [
      { value: 'income-statement', label: '利润表', icon: 'trending-up', kind: 'incomeStatement' },
      { value: 'balance-sheet', label: '资产负债表', icon: 'scale', kind: 'balanceSheet' },
      { value: 'trial-balance', label: '科目余额表', icon: 'table-2', kind: 'trialBalance' } ] },
    { title: '损益附表', items: [
      { value: 'rent-pnl', label: '附表1 租金损益', icon: 'home', kind: 'schedule5' },
      { value: 'elec-pnl', label: '附表2 用电损益', icon: 'zap', kind: 'schedule2' },
      { value: 'water-pnl', label: '附表3 用水损益', icon: 'droplets', kind: 'water' },
      { value: 'ops-pnl', label: '附表4 运管损益', icon: 'wrench', kind: 'opsPnl' },
      { value: 'expense-pnl', label: '附表5 费用支出', icon: 'banknote', kind: 'expense' } ] },
    { items: [{ value: 'reconciliation', label: '收入核对', icon: 'git-compare', kind: 'recon' }] },
  ] },
  { id: 'analysis', label: '经营分析', short: '分析', icon: 'pie-chart', caption: '决策视图 · 园区 / 租户 / 管理公司 三维', home: 'cockpit', sections: [
    { items: [{ value: 'cockpit', label: '经营驾驶舱', icon: 'gauge', kind: 'ana' }] },
    { title: '园区维度', items: [
      { value: 'park', label: '出租与楼栋', icon: 'building-2', kind: 'ana' },
      { value: 'park-energy', label: '园区能耗', icon: 'zap', kind: 'ana' } ] },
    { title: '租户维度', items: [
      { value: 'tenant-energy', label: '用能与缴费', icon: 'activity', kind: 'ana' },
      { value: 'tenant-portfolio', label: '结构与续约', icon: 'users', kind: 'ana' } ] },
    { title: '管理公司维度', items: [
      { value: 'fin-pnl', label: '利润表分析', icon: 'bar-chart-3', kind: 'ana' },
      { value: 'fin-balance', label: '资产负债分析', icon: 'scale', kind: 'ana' },
      { value: 'fin-cashflow', label: '现金流量分析', icon: 'wallet', kind: 'ana' } ] },
    { title: '专题分析', items: [
      { value: 'churn', label: '租户流失预警', icon: 'siren', kind: 'ana' },
      { value: 'expiry', label: '到期墙与续约', icon: 'calendar-clock', kind: 'ana' },
      { value: 'breakeven', label: '盈亏平衡与敏感性', icon: 'scale-3d', kind: 'ana' },
      { value: 'pnl-analysis', label: '损益附表分析', icon: 'layers', kind: 'pnlAnalysis' },
      { value: 'pv-roi', label: '光伏投资回收', icon: 'sun', kind: 'pvRoi' } ] },
    { title: '监控', items: [{ value: 'anomaly', label: '异常提醒中心', icon: 'bell-ring', kind: 'ana' }] },
  ] },
]

export interface RouteMeta { value: string; layer: string; layerLabel: string; layerIcon: string; page: string; icon: string; kind: string }
export function fpAllPages(): (NavItem & { layer: string; layerLabel: string; layerIcon: string })[] {
  return FP_NAV.flatMap(L => L.sections.flatMap(s => s.items.map(it => ({ ...it, layer: L.id, layerLabel: L.label, layerIcon: L.icon }))))
}
export function fpFindLayer(value: string): NavLayer { return FP_NAV.find(L => L.sections.some(s => s.items.some(it => it.value === value))) ?? FP_NAV[0] }
export function fpBuildRoutes(): Record<string, RouteMeta> {
  const map: Record<string, RouteMeta> = {}
  for (const p of fpAllPages()) map[p.value] = { value: p.value, layer: p.layer, layerLabel: p.layerLabel, layerIcon: p.layerIcon, page: p.label, icon: p.icon, kind: p.kind }
  return map
}
```

- [ ] **Step 2: 写失败测试**

```ts
// src/nav/__tests__/fpNav.spec.ts
import { describe, it, expect } from 'vitest'
import { FP_NAV, fpAllPages, fpBuildRoutes, fpFindLayer } from '../fpNav'
describe('fpNav', () => {
  it('has 3 layers and 39 items', () => {
    expect(FP_NAV).toHaveLength(3)
    expect(fpAllPages()).toHaveLength(39)
  })
  it('builds a route per item with layer back-refs', () => {
    const r = fpBuildRoutes()
    expect(Object.keys(r)).toHaveLength(39)
    expect(r['buildings'].layer).toBe('data')
    expect(r['fin-pnl'].layerLabel).toBe('经营分析')
  })
  it('fpFindLayer resolves owning layer', () => {
    expect(fpFindLayer('balance-sheet').id).toBe('reports')
    expect(fpFindLayer('nope').id).toBe('data') // fallback first
  })
})
```

- [ ] **Step 3: 跑测试确认失败** Run: `npm run test -- fpNav` → FAIL (module not found) → after Step1 → PASS.

- [ ] **Step 4: 写 router + PlaceholderView**

`src/views/PlaceholderView.vue`: 居中卡片，显当前路由的 `page` 名 + 层 + "（本屏将在后续阶段实现）"，用 `var(--text-muted)`、Card 风格容器。读 `route.meta`。

`src/router/index.ts`: 由 `fpBuildRoutes()` 生成路由 —— 每个 value → path `/${value}`（ana 层 value 同样 `/${value}`），component 一律 `PlaceholderView`（P0-D/E 再把 buildings/tenants 换成真视图），`meta` 挂 RouteMeta。另加 `/login`→LoginView（Task 7 建，先占位 import 可后补）、`/`→redirect 到 `data-home`。守卫在 Task 7 加。

- [ ] **Step 5: 跑测试 + build** Run: `npm run test -- fpNav` PASS；`npm run build` green（PlaceholderView 渲染，所有 39 路由可解析）。

- [ ] **Step 6: 提交** `feat(frontend): fpNav single-source nav (39 screens) + routes + placeholder view`（结尾署名）。

---

### Task 2: 两浮卡外壳骨架（App.vue + AppShell）

**Files:** Create `src/components/shell/AppShell.vue`；Modify `src/App.vue`；复制 `factory-park-mark.svg` 到 `src/assets/`。
**Interfaces:** Produces `AppShell.vue`（含具名插槽或子组件位 rail/sidebar/tabstrip/toolbar/content）；App.vue 按 `route.path==='/login'` 切换独立布局 vs 外壳。

- [ ] **Step 1**: App.vue：`<router-view>` 外，若当前是 `/login` 直接渲染（LoginView 自带全屏布局）；否则渲染 `<AppShell>`，其 content 区放 `<router-view>`。判断用 `useRoute().meta` 或 path。
- [ ] **Step 2**: AppShell.vue：按像素谱建**根 stage(flex,pad12,gap12)** + **导航卡**(IconRail 位 + 竖分隔 + SidebarPanel 位) + **主卡**(TabStrip 位 → Toolbar 位 → content `<slot>`/router-view)。本任务 rail/sidebar/tabstrip/toolbar 先放**最小占位**(正确尺寸的空 div)，后续任务填充。content 区 `<main>` 用像素谱样式。
- [ ] **Step 3**: 验证 `npm run build` green；运行期 `npm run dev` 开 `/data-home`：两张 24 圆角浮卡撑满视口、导航卡左、主卡右、content 显 PlaceholderView。（用 preview_eval 读 getComputedStyle 核对 stage padding12/gap12、卡 radius24——见 P0 spec 验证法。）
- [ ] **Step 4**: 提交 `feat(frontend): two-card app shell skeleton (App.vue + AppShell)`。

---

### Task 3: IconRail 图标导轨

**Files:** Create `src/components/shell/IconRail.vue`；Modify AppShell 接入。Consumes: DS `Avatar`、`ui` store（当前 layer）、`fpNav`（FP_NAV 层 + home）、router。
**Interfaces:** Produces `IconRail`（props: 无；读 ui store 的 activeLayer；点层按钮 → router.push 该层 home + 设 activeLayer；命令按钮 emit/调用 palette 开；显 Avatar 周明）。

- [ ] **Step 1**: 照像素谱港 IconRail（源 shell.jsx `.fp-rail`）：品牌标(svg 22×22)、分隔、3 枚层按钮(icon size20 lucide + short 标签 10.5，激活态 ink-900 白字 shadow)、底部命令按钮 + `<Avatar name="周明" :size="32"/>`。当前层来自 `ui` store（Task 5 建 ui store；本任务可先用本地 ref + 后接），点击层→`router.push('/'+layer.home)`。lucide 图标用 `lucide-vue-next` 的 `database/book-marked/pie-chart/command` 等（按 FP_NAV layer.icon 动态取）。
- [ ] **Step 2**: 接入 AppShell 导航卡左侧。`npm run build` green；preview 核对 rail 宽 66、标 40/r13、按钮 48/r15、激活态色。
- [ ] **Step 3**: 提交 `feat(frontend): IconRail (layer switcher + brand + command + avatar)`。

> 注：lucide 动态图标按 name 取——用一个 `iconFor(name: string)` 帮助（映射 lucide-vue-next 导出），缺失图标回退一个占位 icon 并 console.warn（便于发现 name 不匹配）。该 helper 放 `src/components/ds/icon.ts`，TabStrip/Toolbar/SidebarPanel/CommandPalette 共用。

---

### Task 4: SidebarPanel 二级栏

**Files:** Create `src/components/shell/SidebarPanel.vue`；Modify AppShell。Consumes: DS `SidebarNav`、`ui` store(activeLayer + sbOpen)、router、`fpNav`。
**Interfaces:** Produces `SidebarPanel`（渲染当前层 header + `<SidebarNav :sections="layer.sections映射" :active="currentValue" @select="v=>router.push('/'+v)">`）。

- [ ] **Step 1**: 把 FP_NAV 当前层的 `sections` 映射成 DS `SidebarNav` 的 `sections` 形状（`{title?, items:[{value,label,icon}]}`），active=当前路由 value。点选→`router.push`。header：层 icon size18 + label 16/semibold + 全bleed 分隔。仅 `sbOpen` 时渲染（导航卡里 + 竖分隔同条件）。
- [ ] **Step 2**: 接入 AppShell；`npm run build` green；preview 核对宽 234、当前层导航项、选中 accent bar、点选切屏。
- [ ] **Step 3**: 提交 `feat(frontend): SidebarPanel (active-layer nav via DS SidebarNav)`。

---

### Task 5: 状态 store（ui + tabs）+ TabStrip + Toolbar

**Files:** Create `src/stores/ui.ts`, `src/stores/tabs.ts`, `src/components/shell/TabStrip.vue`, `src/components/shell/Toolbar.vue`；Modify AppShell、IconRail/SidebarPanel 改读 ui store。
**Test:** `src/stores/__tests__/tabs.spec.ts`
**Interfaces:**
- `ui` store: `activeLayer`(派生自当前路由所属层)、`sbOpen`(持久化 fp-app-sb)、`toggleSidebar()`。
- `tabs` store: `tabs: Tab[]`(钉住，持久化 fp-app-tabs)、`preview: Tab|null`(fp-app-preview)、`recent: string[]`(max8, fp-app-recent)、`open(value,{pin})`、`pin(value)`、`close(value)`、`current`(当前路由 value)。`type Tab={value}`。浏览器模型：`open` 非 pin → 设 preview(替换旧 preview)；pin 或双击 → 移入 tabs；导航即 push 路由。

- [ ] **Step 1: 写 tabs store + 失败测试**（store 逻辑是纯函数，可测）

```ts
// src/stores/__tests__/tabs.spec.ts （要点）
// - open('buildings') 设 preview=buildings，tabs 不变
// - open('tenants') 后 preview 变 tenants（单预览槽，buildings 被替换）
// - pin('tenants') 把 tenants 移入 tabs、preview 清空
// - 始终保留一个 base home tab（≥1）
// - close(value) 从 tabs 移除（>1 时）；recent 去重 max8
```
照 app.jsx 的页签迁移逻辑（base home tab、单预览槽、recent max8）实现 `tabs.ts` 使测试通过。持久化用 `watch` → localStorage（键如上）；`load(key,fallback)` 容错。

- [ ] **Step 2**: 跑测试 → 实现 → PASS。
- [ ] **Step 3**: 写 TabStrip.vue（源 shell.jsx `.fp-tabstrip`）：渲染 tabs+preview 为页签(图标14+label12.5)，激活态白底 shadow，预览态斜体；钉/关按钮 hover 显；溢出下拉(ResizeObserver) + 新建"+"(开命令面板 new 模式，Task 6 接)。点页签→`tabs.open`+`router.push`；双击/钉→`tabs.pin`；关→`tabs.close`+导航到相邻。
- [ ] **Step 4**: 写 Toolbar.vue（源 `.fp-toolbar`）：panel-left IconButton(`ui.toggleSidebar`) + star + 面包屑(层label / 页名,读 route.meta) + 右侧搜索按钮(开命令面板) + sun/history/bell IconButton(DS IconButton)。
- [ ] **Step 5**: 接入 AppShell（TabStrip 在 Toolbar 之上）；IconRail/SidebarPanel 改读 `ui.activeLayer`。`npm run build` + `npm run test` green；preview 核对 tabstrip44/toolbar48/顺序、页签交互、面包屑。
- [ ] **Step 6**: 提交 `feat(frontend): ui+tabs stores + TabStrip(browser tabs) + Toolbar`。

---

### Task 6: 命令面板 Ctrl-K

**Files:** Create `src/components/shell/CommandPalette.vue`；Modify AppShell(挂载 + 全局键盘) + Toolbar/IconRail/TabStrip(开面板入口)。
**Test:** `src/components/shell/__tests__/palette.spec.ts`（过滤逻辑）
**Interfaces:** Produces `CommandPalette`（`open` 状态 + `mode:'jump'|'new'`；`fpAllPages()` 为数据源；选中 → `tabs.open(value,{pin: mode==='new'})` + `router.push`）。全局 `Ctrl/Cmd+K` 切换。

- [ ] **Step 1**: 写过滤纯函数 + 失败测试：空查询→最近(max5)+每层分组；输入→按 `label`/`layerLabel` 子串(大小写不敏感)过滤 `fpAllPages()`。测 1-2 条断言。
- [ ] **Step 2**: 实现 → PASS。写 CommandPalette.vue（源 shell.jsx `CommandPalette`）：backdrop(z200,blur2,padding-top11vh) + panel(min(620,92vw),radius16,shadow)；输入 autofocus(30ms)；行显 icon+名+层chip；键盘 ↑↓/Enter/Esc。
- [ ] **Step 3**: AppShell 挂 `window` keydown(`Ctrl/Cmd+K` preventDefault toggle)；Toolbar 搜索按钮/IconRail 命令按钮(mode jump)/TabStrip "+"(mode new) 调 open。
- [ ] **Step 4**: `npm run build` + `npm run test` green；preview：Ctrl-K 开、输入过滤、Enter 跳屏、Esc 关。
- [ ] **Step 5**: 提交 `feat(frontend): Ctrl-K command palette`。

---

### Task 7: 登录页 + JWT 接线 + 路由守卫

**Files:** Create `src/views/LoginView.vue`；Modify `src/stores/auth.ts`(P0-B 有 stub，扩 login/logout)、`src/router/index.ts`(守卫 + /login)、`src/api/index.ts`(401→登出跳登录,P0-B 已有 stub)。
**Test:** `src/stores/__tests__/auth.spec.ts`（login 存 token；logout 清）+ 守卫行为（可在 router 测或 store 测）。
**Interfaces:** `auth` store: `token`(持久化 localStorage `demo3-token`)、`displayName`、`login({username,password})`(POST `/api/auth/login`,存 token+displayName)、`logout()`、`isAuthed`。守卫：未 authed 且目标非 `/login` → redirect `/login`；已 authed 访问 `/login` → redirect home。

- [ ] **Step 1**: 扩 auth store（login 调 `api.post('/auth/login',...)`，P0-B 的 axios 解包后返回 `{token,displayName}`；存 token 到 localStorage + axios 已自动附 Bearer）。写 auth.spec（mock api，login 后 isAuthed true + token 持久化；logout 清）。
- [ ] **Step 2**: 实现 → PASS。
- [ ] **Step 3**: LoginView.vue：居中卡片(DS 风格)，用户名/密码(DS Input——注：Input 未在 P0-B 移植，**本任务顺带港 Input** 或用原生 input 走 token 样式；推荐顺带港 DS `forms/Input`)，登录按钮(DS Button filled)，错误提示(--hue-red)；提交→auth.login→成功跳 home，失败显消息。全屏布局(灰底居中)。
- [ ] **Step 4**: router 加 `/login` + `beforeEach` 守卫；axios 401 拦截 → auth.logout + 跳 /login（P0-B stub 接上 store）。
- [ ] **Step 5**: `npm run build` + `npm run test` green。**整栈联调**：起 P0-A 后端(见 P0-A 验证配方,MySQL+`./mvnw spring-boot:run`)，前端 `npm run dev`，未登录访问 `/buildings` → 跳 /login；登录 admin/admin123 → 进外壳；刷新保持登录；登出回 /login。
- [ ] **Step 6**: 提交 `feat(frontend): login page + JWT auth store + route guard`。

---

### Task 8: 集成收口 + 全外壳验证

**Files:** 视需要微调；Modify AppShell 把 6 块全接齐。
**Interfaces:** 无新增。

- [ ] **Step 1**: 确认 AppShell 已组合 IconRail+SidebarPanel+TabStrip+Toolbar+CommandPalette+content，三层切换(导轨)→二级栏换层→点屏开页签→面包屑更新 全链路通。
- [ ] **Step 2**: `npm run build` + `npm run test` 全绿。
- [ ] **Step 3**: **运行期像素 + 交互验证**（preview_resize 1440×900 后 preview_eval 读 getComputedStyle）：stage pad12/gap12、两卡 radius24、rail66、sidebar234、tabstrip44、toolbar48、顺序(TabStrip 在 Toolbar 上)、Ctrl-K、登录守卫。截图存证。
- [ ] **Step 4**: 提交 `feat(frontend): wire full app shell + integration verify`。

---

## Self-Review（计划对照 P0 spec §5/§7）

- 外壳两浮卡 + IconRail66/Sidebar234/TabStrip44/Toolbar48 + Ctrl-K → Task 2-6（像素谱逐值）。✅
- 39 屏导航单一事实源 + 非 P0 屏占位 → Task 1。✅
- 登录(工程增项) + JWT 接线 + 守卫 → Task 7（连 P0-A `/api/auth/login`）。✅
- 复用 P0-B DS 组件（SidebarNav/Avatar/IconButton/Button/SearchField）→ Task 3-7；顺带港 DS `Input`(登录用，P0-B 未做) → Task 7。
- 禁紫禁绿 + 只用 tokens → Global Constraints + 每任务 preview 核对。
- **占位扫描**：像素谱给了所有数值；`fpNav` 给了全 39 项；tab/palette/auth 逻辑给了要点 + 源引用——实现者照 shell.jsx/app.jsx 港。无逻辑 TODO。
- **遗留**：ana 层 14 屏本期走 PlaceholderView（AnalysisShell 工具条在 P3）；TabStrip 的 ResizeObserver 溢出下拉若过繁可降级为简单滚动(标 ponytail)。DS 专用业务复合组件(FPDrawer 等)在 P0-D/E。
