# P0a 期间深链协议（deepLink.ts + useDeepPeriod + 出账链 5 屏 + 报表中心 co=all）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全站期间深链只有一个出口（`nav/deepLink.ts`）、一个入口（`composables/useDeepPeriod`）：带 `p=YYYY-MM` 进出账链五屏直落该月（门被跳过时链路条照样有数据），同一地址二次激活不重复取数，有未保存改动时不切期只提示；报表中心点卡带 `co=all` 直落「全部汇总」。

**Architecture:** `periodLink(value, { p, co?, extra? })` 发链、`parsePeriod(query)` 收链（认 `p` | 旧 `ym` | 旧 `y&m`，`co` 认 id | `'all'` | 旧 `company` 名），`reportPeriod.parsePeriodQuery` 与 `utils/deepLink` 两个旧解析器改为委托（旧用例全绿）。`useDeepPeriod({ current, apply, dirty? })` 在 **setup 期同步**跑一次（比 spec 写的 onMounted 更早，理由见 Global Constraints）+ `onReactivated` 再跑，按 `route.fullPath` 去重，三不动（parse 为 null / 与当前相同 / dirty > 0）。出账链五屏用薄包装 `useChainDeepPeriod(dirty?)`（apply = `billingPeriod.pick` + `loadChain`），一屏一行。发链侧：报表中心 `go()` 与首页 `go()` 改走 `periodLink`。

**Tech Stack:** Vue 3 `<script setup>` + Pinia + vue-router 4 + Vitest（jsdom）+ @vue/test-utils；vue-tsc strict。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §4.1（首页行）· §4.2（协议全文）· §5.1（DataHomeView.go）· §9 P0a 行 · §10 · §12。

## Global Constraints

- **唯一出口 / 入口**：新链接一律 `periodLink`；目标屏一律 `useDeepPeriod`。旧格式（`ym` / `y&m` / `company`）只在**解析侧**兼容，本期不改既有三处 `?ym=` 发链（LossLedgerView / PoolLedgerView / BillNoticesView 的 `gotoParams`，P0c 随分析层 9 处一起迁）。
- **触发时机裁定**：`useDeepPeriod` 首次在 **setup 期同步**跑（spec §4.2 写 `onMounted`）。理由：五屏的 `watch(ym)` 与 `onMounted` 取数都在 setup 里注册，期若晚于它们落定，参数屏从「零次多余拉取」退化成「一次多余拉取」；且 `?edit=1` / `?generate=1` 的 `toggleEdit` 必须在期落定之后（否则占到 `billing-chain:0-00` 的假锁，ParamCenterView / PoolLedgerView 注释与 paramCenterView.spec:231 / poolWriteGuards.spec:191 钉死）。首次运行**不查 dirty**（全新实例没有草稿）；`onReactivated` 那次才查。
- **不改 `billingPeriod.adoptYm`**（函数与 `billingPeriod.spec:82-88` 原样）；五屏改用 `pick`（深链 = 显式选月，覆盖会话已选的期，D2）。ParamCenterView / PoolLedgerView 里对 `adoptYm` 的两处调用删除（useChainDeepPeriod 接管）。
- **loadChain 必补**：链屏 apply 里 `pick` 之后紧跟 `void period.loadChain().catch(() => {})`（`ChainMonthGate` 是它的唯一调用方，门被深链跳过就没人加载；P1 复查 F1 同坑）。
- **五屏源码形状门禁**（`chainPeriodGate.spec`）：不许出现 `const year = ref` / `const month = ref` / `yearOpts` / `monthOpts`；`<ChainMonthGate v-if="!period.picked"` 逐字不动；`current="<route>"` 不动。
- **屏内提示只走 `FPToast`**（`tone="warning" placement="page" :duration="0"`，v-model 绑 `deepNote`）；不写流内 `<div v-if>`（`noInteractionLayoutShift.spec` 会红，且 `KNOWN_DEBT` 表必须保持空）。提示文案「地址栏要求 X 期，本期有 N 处未保存」，不含 `p1` / `meter:` 等禁词（`paramCenterView.spec:183`）。
- **dirty 源**：只有 MeterView（`dirtyIds.value.length`）与 BillNoticesView（`noteEditKey.value != null ? 1 : 0`）有；其余三屏不传 dirty。`PoolLedgerView.cfgDirty` 是「需重算」不是草稿，**不许**当 dirty。
- **注册顺序**：`useChainDeepPeriod()` 的调用放在各屏「账期」块（`const period = useBillingPeriodStore()` …`chainSteps`）**之后、任何 `onReactivated` / `onMounted` / `watch(ym)` 之前**，五屏同位置。
- **去重键**：`route.fullPath ?? JSON.stringify(route.query)`（16 处既有 vue-router 桩都没有 fullPath；新 spec 自己给 fullPath）。
- **spec §10 不变清单**：`fpNav.spec` / `palette.spec` / `tabs.spec` / `ledgerLeaveAndReturn.spec` / `lockScopes.spec` / 8 份 flow-gate spec 的**断言**不变（`chainPeriodFlow.spec` 与 `meterWriteGuards.spec` 的 vue-router **桩**必须补 `useRoute`，断言不动）。`coefHandoff.spec` 第 3 条按 D2 改口径（不在 8 份之内，裁定见 Task 4）。
- **pin 规则（§4.3）本期不做**：它是页签模型的事，随 P3 与 `tabs.open` 一起落；`deepLink.spec` 本期不含「pin 规则」用例（裁定）。
- **DataHomeView.go**：链屏行与收入核对行改走 `periodLink(v, { p })`；附表行仍裸 push（P0b 再接）；预 `pick` + 确认框 + `loadChain` 三句不动。`DataHomeView.spec` 里 `push('/meters')` 与 `{ y, m }` 两类断言随改（§4.1 明写「显式选月 + periodLink」）。
- `npm run build` size-check：index ≤ 191KB（当前 189.1）。`nav/reportPeriod` / `onReactivated` 今天各自是独立共享块，不在 index；新的两个模块只被懒加载屏 import，预期同样不进 index。**触线即停，先瘦身不签字**。
- 每条新断言按 memory 节奏破坏验证（改坏 → 只该红的红 → **字符串替换还原，绝不 `git checkout`**）。
- 提交信息末尾：`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 所有命令在 worktree `C:\financial_dashboard\demo3\.claude\worktrees\model-12d043`；前端命令在 `frontend/`。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `frontend/src/nav/deepLink.ts`（新） | `periodLink` / `periodOf` / `parsePeriod` / `DeepPeriod` |
| `frontend/src/nav/__tests__/deepLink.spec.ts`（新） | 三代格式、优先级、越界、co、数组值、两处委托 |
| `frontend/src/nav/reportPeriod.ts:53-67` | `parsePeriodQuery` 改为委托 |
| `frontend/src/utils/deepLink.ts:13-25` | 两个解析器各加两行委托 |
| `frontend/src/composables/useDeepPeriod.ts`（新） | `useDeepPeriod` + `useChainDeepPeriod` |
| `frontend/src/composables/__tests__/useDeepPeriod.spec.ts`（新） | 同 fullPath 一次 / 变更再 apply / 无 p 不 apply / 相同不动 / dirty 不切 + 文案 / 首跑不查 dirty / chain 包装 pick + loadChain |
| `frontend/src/views/params/ParamCenterView.vue` · `alloc/PoolLedgerView.vue` · `alloc/LossLedgerView.vue` | 接 `useChainDeepPeriod()`；删 `adoptYm` 两处 |
| `frontend/src/views/meters/MeterView.vue` · `bills/BillNoticesView.vue` | 接 `useChainDeepPeriod(dirty)` + `FPToast` 提示位 |
| `frontend/src/views/__tests__/chainDeepLink.spec.ts`（新） | LossLedgerView 带 p 直落 / 旧 ym / p 覆盖已选期 / 无 p 落矩阵 / 越界不信 / loadChain 被调 |
| `frontend/src/views/__tests__/chainPeriodFlow.spec.ts:37` · `meterWriteGuards.spec.ts:60` | 桩补 `useRoute` |
| `frontend/src/views/__tests__/coefHandoff.spec.ts:98-103` | 第 3 条改 D2 口径 |
| `frontend/src/views/reports/home/ReportsHomeView.vue:8,46-49` | `go()` 走 `periodLink(v, { p, co: 'all' })` |
| `frontend/src/views/reports/home/__tests__/reportsHomeGo.spec.ts`（新） | go 的 push 形状 + openFresh |
| `frontend/src/views/data-home/DataHomeView.vue:24,58-87` · `DataHomeView.spec.ts` | 链屏行 / 对账行走 `periodLink` |
| `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §4.2 | 触发时机口径随裁定 |

---

### Task 0: 准备与基线

- [ ] **Step 1: BASE 与基线**

```bash
git rev-parse --short HEAD
cd frontend && npx vitest run src/nav src/utils/deepLink.spec.ts src/views/__tests__/chainPeriodFlow.spec.ts src/views/__tests__/chainPeriodGate.spec.ts src/views/__tests__/coefHandoff.spec.ts src/views/__tests__/poolWriteGuards.spec.ts src/views/__tests__/meterWriteGuards.spec.ts src/views/__tests__/billNoticeWriteGuards.spec.ts src/views/params src/views/data-home src/composables
```
Expected: 全绿；记下 files / tests。全量基线：182 files / 2153 tests；size-check index 189.1 / 191。

---

### Task 1: `nav/deepLink.ts` + 两处委托

**Files:**
- Create: `frontend/src/nav/deepLink.ts`
- Create: `frontend/src/nav/__tests__/deepLink.spec.ts`
- Modify: `frontend/src/nav/reportPeriod.ts:53-67`
- Modify: `frontend/src/utils/deepLink.ts:1-2, 13-25`

**Interfaces:**
- Produces: `periodLink(value: string, o: { p: string; co?: number | 'all'; extra?: Record<string, string | number | boolean | null | undefined> }): { path: string; query: Record<string, string> }`；`periodOf(year: number, month: number | null): string`；`parsePeriod(q: Record<string, unknown>): DeepPeriod | null`；`interface DeepPeriod { year: number; month: number | null; co: number | 'all' | string | null }`。Task 2 / 5 消费。

- [ ] **Step 1: 写 deepLink.spec（先红：模块不存在）**

新建 `frontend/src/nav/__tests__/deepLink.spec.ts`：

```ts
// src/nav/__tests__/deepLink.spec.ts — 期间深链协议(SIDEBAR-UX-REDESIGN §4.2):一个出口 periodLink、一个收口 parsePeriod。
// 收口认三代格式(p 新 | ym 出账链旧链 | y&m 报表层 / 台账 / 附10 旧链),旧解析器委托过来后旧用例照旧绿。
import { describe, it, expect } from 'vitest'
import { periodLink, periodOf, parsePeriod } from '../deepLink'
import { parsePeriodQuery } from '../reportPeriod'
import { parseLedgerDeepLink, parseS10DeepLink } from '@/utils/deepLink'

describe('periodLink 发链', () => {
  it('p 必带;co 与 extra 有才写,值一律 string', () => {
    expect(periodLink('income-statement', { p: '2025-06', co: 'all' }))
      .toEqual({ path: '/income-statement', query: { p: '2025-06', co: 'all' } })
    expect(periodLink('meters', { p: '2024-02' })).toEqual({ path: '/meters', query: { p: '2024-02' } })
    expect(periodLink('params', { p: '2024-02', co: 3, extra: { zone: 'p1', rule: 23, edit: undefined, x: null } }))
      .toEqual({ path: '/params', query: { p: '2024-02', co: '3', zone: 'p1', rule: '23' } })
  })
  it('periodOf:月补零;没有月只写年(损益附表 / 年表屏)', () => {
    expect(periodOf(2025, 6)).toBe('2025-06')
    expect(periodOf(2025, 12)).toBe('2025-12')
    expect(periodOf(2025, null)).toBe('2025')
  })
})

describe('parsePeriod 收链', () => {
  it('p=YYYY-MM(新格式)', () => {
    expect(parsePeriod({ p: '2025-06' })).toEqual({ year: 2025, month: 6, co: null })
    expect(parsePeriod({ p: '2025' })).toEqual({ year: 2025, month: null, co: null })
  })
  it('ym=YYYY-MM(出账链旧链)照认;月必须两位补零', () => {
    expect(parsePeriod({ ym: '2024-02' })).toEqual({ year: 2024, month: 2, co: null })
    expect(parsePeriod({ ym: '2024-2' })).toBe(null)
  })
  it('y&m(报表层 / 台账 / 附10 旧链);只有年也认', () => {
    expect(parsePeriod({ y: '2025', m: '9' })).toEqual({ year: 2025, month: 9, co: null })
    expect(parsePeriod({ y: '2025' })).toEqual({ year: 2025, month: null, co: null })
  })
  it('优先级 p > ym > y&m —— 混着来时只信最新的那一代', () => {
    expect(parsePeriod({ p: '2025-01', ym: '2024-02', y: '2023', m: '3' })?.year).toBe(2025)
    expect(parsePeriod({ ym: '2024-02', y: '2023', m: '3' })?.year).toBe(2024)
  })
  it('越界不信任地址栏:年 2000..2100 之外整个 null;y&m 的月越界只丢月;p 的月不合法整个 null', () => {
    expect(parsePeriod({ p: '1999-01' })).toBe(null)
    expect(parsePeriod({ y: '2101', m: '1' })).toBe(null)
    expect(parsePeriod({ y: 'abc' })).toBe(null)
    expect(parsePeriod({})).toBe(null)
    expect(parsePeriod({ y: '2025', m: '13' })?.month).toBe(null)
    expect(parsePeriod({ p: '2025-13' })).toBe(null)
  })
  it('co:id | all | 旧 company 名;都没有 → null;co 非法且无 company → null', () => {
    expect(parsePeriod({ p: '2025-06', co: '3' })?.co).toBe(3)
    expect(parsePeriod({ p: '2025-06', co: 'all' })?.co).toBe('all')
    expect(parsePeriod({ y: '2025', m: '1', company: '创显' })?.co).toBe('创显')
    expect(parsePeriod({ p: '2025-06', co: 'x' })?.co).toBe(null)
    expect(parsePeriod({ p: '2025-06', co: '3', company: '创显' })?.co, 'co 有值时不看 company').toBe(3)
  })
  it('数组型 query 值取第一个(?p=a&p=b 是用户能敲出来的地址)', () => {
    expect(parsePeriod({ p: ['2025-06', '2024-01'] })?.year).toBe(2025)
    expect(parsePeriod({ y: ['2025'], m: ['3'] })).toEqual({ year: 2025, month: 3, co: null })
  })
})

describe('旧解析器委托后:认 p,旧口径原样', () => {
  it('reportPeriod.parsePeriodQuery 认 p;company 名不落进 companyId(报表层没有公司名维度)', () => {
    expect(parsePeriodQuery({ p: '2025-09', co: 'all' })).toEqual({ year: 2025, month: 9, companyId: 'all' })
    expect(parsePeriodQuery({ y: '2025', m: '9', company: '创显' })?.companyId).toBe(null)
  })
  it('utils/deepLink 两个解析器认 p;旧 y&m 无年份上下界的口径原样', () => {
    expect(parseLedgerDeepLink({ p: '2025-01', company: '创显' })).toEqual({ y: 2025, m: 1, company: '创显', tenant: '' })
    expect(parseS10DeepLink({ p: '2025-01', phase: '2' })).toEqual({ y: 2025, m: 1, phase: 2, tenant: '' })
    expect(parseLedgerDeepLink({ y: '1999', m: '1' })?.y, '旧链没有 2000..2100 的界,委托后也不能凭空加').toBe(1999)
    expect(parseLedgerDeepLink({ y: '2025', m: '13' })).toBeNull()
  })
})
```

- [ ] **Step 2: 跑确认红**

```bash
cd frontend && npx vitest run src/nav/__tests__/deepLink.spec.ts
```
Expected: 整文件红（`../deepLink` 找不到）。

- [ ] **Step 3: 写 nav/deepLink.ts**

```ts
// src/nav/deepLink.ts — 期间深链协议的唯一出口(SIDEBAR-UX-REDESIGN §4.2)。
// 发链 periodLink(value, { p, co?, extra? }) → { path, query };收链 parsePeriod(query)。
// 收链认三代格式,优先级 p(新)> ym(出账链旧链)> y&m(报表层 / 台账 / 附10 旧链);
// co 认 id | 'all' | 旧 company 名(台账 / 附10 的深链用公司名)。
// 越界不信任地址栏:年 2000..2100 之外整个 null;y&m 的月 1..12 之外只丢月(reportPeriod 既有口径);
// p / ym 的月必须两位补零且合法,否则整个 null(billingPeriod 的 YM 口径)。数组型 query 值取第一个(utils/deepLink 既有口径)。

export interface DeepPeriod {
  year: number
  month: number | null
  /** 公司:id | 'all' | 旧链的公司名 | 无 */
  co: number | 'all' | string | null
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : ''
const pad2 = (n: number) => String(n).padStart(2, '0')
const P = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/

/** 发链。缺的项不写进 query(空串会被目标屏误读成「给了个空」);extra 的值一律转 string,null / undefined 丢掉。 */
export function periodLink(
  value: string,
  o: { p: string; co?: number | 'all'; extra?: Record<string, string | number | boolean | null | undefined> },
): { path: string; query: Record<string, string> } {
  const query: Record<string, string> = { p: o.p }
  if (o.co != null) query.co = String(o.co)
  for (const [k, v] of Object.entries(o.extra ?? {})) if (v != null) query[k] = String(v)
  return { path: '/' + value, query }
}

/** p 的形状:'YYYY-MM';没有月只写年(损益附表 / 年表屏)。 */
export function periodOf(year: number, month: number | null): string {
  return month == null ? String(year) : `${year}-${pad2(month)}`
}

/** 收链。认不出 → null,半个期不塞给屏。 */
export function parsePeriod(q: Record<string, unknown>): DeepPeriod | null {
  let year: number
  let month: number | null
  const p = str(q.p) || str(q.ym)
  if (p) {
    const m = P.exec(p)
    if (!m) return null
    year = +m[1]
    month = m[2] ? +m[2] : null
  } else {
    year = Number(str(q.y))
    const mm = Number(str(q.m))
    month = Number.isInteger(mm) && mm >= 1 && mm <= 12 ? mm : null
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
  const co = str(q.co)
  const company = str(q.company)
  return { year, month, co: co === 'all' ? 'all' : /^\d+$/.test(co) ? Number(co) : company || null }
}
```

- [ ] **Step 4: 两处委托**

`frontend/src/nav/reportPeriod.ts` 第 53-67 行（`parsePeriodQuery` 的 docblock + 函数体）替换为：

```ts
/**
 * 回读。**没有年 = 不是深链**，一律返回 null ——
 * 半个期塞给屏，比不塞更坏（屏会停在一个说不清从哪来的状态）。
 * 年月越界一律丢：地址栏是用户可改的，不信任它。
 * 2026-09-03 起委托 nav/deepLink.parsePeriod(SIDEBAR-UX-REDESIGN §4.2 唯一收口):从此也认 p= 新格式,
 * 旧 y&m&co 口径原样;深链里的公司名(company)不落进 companyId —— 报表层没有公司名维度。
 */
export function parsePeriodQuery(q: Record<string, unknown>): ReportPeriod | null {
  const dp = parsePeriod(q)
  if (!dp) return null
  return { year: dp.year, month: dp.month, companyId: typeof dp.co === 'string' && dp.co !== 'all' ? null : dp.co }
}
```

并在文件顶部 import 区加 `import { parsePeriod } from '@/nav/deepLink'`。

`frontend/src/utils/deepLink.ts`：第 1-2 行头注释后加一行 `// 2026-09-03 起两个解析器先委托 nav/deepLink.parsePeriod 认 p= 新格式(SIDEBAR-UX-REDESIGN §4.2);认不出时照旧走 y&m(这里的旧口径没有年份上下界,委托不许凭空加)。`，`import type { LocationQuery } from 'vue-router'` 之后加 `import { parsePeriod } from '@/nav/deepLink'`；两个函数体改为：

```ts
export function parseLedgerDeepLink(query: LocationQuery): LedgerDeepLink | null {
  const dp = parsePeriod(query)
  const y = dp ? dp.year : int(query.y), m = dp?.month ?? int(query.m)
  if (!Number.isInteger(y) || !(m >= 1 && m <= 12)) return null
  return { y, m, company: str(query.company), tenant: str(query.tenant) }
}

/** 附表10 深链:需合法 y + 月份 1..12;phase 非法回落 1(期区 1..4)。 */
export function parseS10DeepLink(query: LocationQuery): S10DeepLink | null {
  const dp = parsePeriod(query)
  const y = dp ? dp.year : int(query.y), m = dp?.month ?? int(query.m)
  if (!Number.isInteger(y) || !(m >= 1 && m <= 12)) return null
  const p = int(query.phase)
  return { y, m, phase: p >= 1 && p <= 4 ? p : 1, tenant: str(query.tenant) }
}
```
（`parseLedgerDeepLink` 上方原 docblock 保留。）

- [ ] **Step 5: 跑确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/nav src/utils/deepLink.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: `deepLink.spec` 11 条绿；`reportPeriod.spec` 14 条、`utils/deepLink.spec` 7 条原样绿；vue-tsc 零错。

- [ ] **Step 6: 破坏验证**

把 `parsePeriod` 里 `const p = str(q.p) || str(q.ym)` 改成 `const p = str(q.p)` → 只有「ym=YYYY-MM 照认」与「优先级」两条红；还原。把 `year < 2000` 改成 `year < 1000` → 「越界」那条红（`p: '1999-01'`）且 `reportPeriod.spec` 的「年月越界一律丢掉」红；还原。把 `utils/deepLink.ts` 的 `dp ? dp.year : int(query.y)` 改成 `dp?.year ?? NaN` → 「旧 y&m 无年份上下界」那条红；还原。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/nav/deepLink.ts frontend/src/nav/__tests__/deepLink.spec.ts frontend/src/nav/reportPeriod.ts frontend/src/utils/deepLink.ts
git commit -m "feat(nav): 期间深链唯一出口 deepLink.ts —— periodLink / parsePeriod 认 p|ym|y&m 与 co id|all|公司名;两处旧解析器委托(P0a)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `composables/useDeepPeriod.ts`

**Files:**
- Create: `frontend/src/composables/useDeepPeriod.ts`
- Create: `frontend/src/composables/__tests__/useDeepPeriod.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `parsePeriod / periodOf / DeepPeriod`；既有 `onReactivated`、`useBillingPeriodStore`。
- Produces: `useDeepPeriod(o: { current: () => { p: string | null; co?: number | 'all' | string | null }; apply: (t: DeepPeriod) => void; dirty?: () => number }): { note: Ref<string> }`；`useChainDeepPeriod(dirty?: () => number): { note: Ref<string> }`。Task 3 / 4 消费。

- [ ] **Step 1: 写 useDeepPeriod.spec（先红）**

新建 `frontend/src/composables/__tests__/useDeepPeriod.spec.ts`：

```ts
// src/composables/__tests__/useDeepPeriod.spec.ts — 目标屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2)。
// 首次在 setup 期跑(不查 dirty:全新实例没有草稿);KeepAlive 切回再跑;按 fullPath 去重;三不动。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const route = reactive({ fullPath: '/x', query: {} as Record<string, string | string[]> })
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn().mockResolvedValue(['2025-03']) } }))
vi.mock('@/api/alloc', () => ({ allocApi: { poolMonths: vi.fn().mockResolvedValue([]), lossMonths: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn().mockResolvedValue({ stale: false, otherMonthsAffected: [] }) } }))

import { useDeepPeriod, useChainDeepPeriod, type DeepPeriodOpts } from '@/composables/useDeepPeriod'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { metersApi } from '@/api/meters'

function setRoute(query: Record<string, string>) {
  route.query = query
  route.fullPath = '/x' + (Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '')
}

/** 把 composable 包进 KeepAlive 里的壳,alive 开关模拟切走 / 切回。 */
function host(o: Omit<DeepPeriodOpts, 'apply'> & { apply?: DeepPeriodOpts['apply'] }) {
  const apply = vi.fn(o.apply ?? (() => {}))
  let api!: ReturnType<typeof useDeepPeriod>
  const Inner = defineComponent({ setup() { api = useDeepPeriod({ ...o, apply }); return () => null } })
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(Inner) : null) }),
  }))
  const away = async () => { alive.value = false; await nextTick() }
  const back = async () => { alive.value = true; await nextTick(); await nextTick() }
  return { w, apply, away, back, note: () => api.note.value }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  setRoute({})
})

describe('useDeepPeriod', () => {
  it('带 p 挂载 → setup 期就 apply 一次;切走切回同一地址不再 apply', async () => {
    setRoute({ p: '2025-03', co: 'all' })
    const h1 = host({ current: () => ({ p: null }) })
    expect(h1.apply).toHaveBeenCalledTimes(1)
    expect(h1.apply).toHaveBeenCalledWith({ year: 2025, month: 3, co: 'all' })
    await h1.away(); await h1.back()
    expect(h1.apply, '同 fullPath 二次激活不重复').toHaveBeenCalledTimes(1)
  })

  it('切走期间地址变了 → 切回再 apply 一次', async () => {
    setRoute({ p: '2025-03' })
    const h1 = host({ current: () => ({ p: null }) })
    await h1.away()
    setRoute({ p: '2025-04' })
    await h1.back()
    expect(h1.apply).toHaveBeenCalledTimes(2)
    expect(h1.apply).toHaveBeenLastCalledWith({ year: 2025, month: 4, co: null })
  })

  it('无 p(也无旧格式)不 apply;地址栏垃圾也不 apply', async () => {
    const h1 = host({ current: () => ({ p: null }) })
    expect(h1.apply).not.toHaveBeenCalled()
    setRoute({ p: '1999-13' })
    const h2 = host({ current: () => ({ p: null }) })
    expect(h2.apply).not.toHaveBeenCalled()
  })

  it('与当前 (period, co) 相同 → 不动', () => {
    setRoute({ p: '2025-03', co: '2' })
    const same = host({ current: () => ({ p: '2025-03', co: 2 }) })
    expect(same.apply).not.toHaveBeenCalled()
    const diffCo = host({ current: () => ({ p: '2025-03', co: 3 }) })
    expect(diffCo.apply, '期同公司不同也算不同').toHaveBeenCalledTimes(1)
  })

  it('切回时目标屏有未保存改动 → 不切期,note 说清要哪一期、有几处', async () => {
    setRoute({ p: '2025-03' })
    const dirty = ref(0)
    const h1 = host({ current: () => ({ p: '2025-03' }), dirty: () => dirty.value })
    expect(h1.apply, '与当前相同,首跑不动').not.toHaveBeenCalled()
    dirty.value = 2
    await h1.away()
    setRoute({ p: '2025-05' })
    await h1.back()
    expect(h1.apply).not.toHaveBeenCalled()
    expect(h1.note()).toBe('地址栏要求 2025-05 期，本期有 2 处未保存')
  })

  it('首跑不查 dirty —— 全新实例没有草稿,dirty 源在屏里可能还没声明', () => {
    setRoute({ p: '2025-03' })
    const h1 = host({ current: () => ({ p: null }), dirty: () => 5 })
    expect(h1.apply).toHaveBeenCalledTimes(1)
    expect(h1.note()).toBe('')
  })
})

describe('useChainDeepPeriod(出账链五屏的接法)', () => {
  it('apply = billingPeriod.pick + loadChain(门被深链跳过时它是唯一加载点)', async () => {
    setRoute({ p: '2025-03' })
    mount(defineComponent({ setup() { useChainDeepPeriod(); return () => null } }))
    const period = useBillingPeriodStore()
    expect(period.ym).toBe('2025-03')
    await flushPromises()
    expect(metersApi.months, 'loadChain 被调 → 矩阵数据在路上').toHaveBeenCalledTimes(1)
  })
  it('显式深链覆盖会话里已选的期(D2);只有年的链接不动链屏', () => {
    const period = useBillingPeriodStore()
    period.pick(2024, 1)
    setRoute({ p: '2025-03' })
    mount(defineComponent({ setup() { useChainDeepPeriod(); return () => null } }))
    expect(period.ym).toBe('2025-03')
    setRoute({ p: '2026' })
    mount(defineComponent({ setup() { useChainDeepPeriod(); return () => null } }))
    expect(period.ym, '年份链接对链屏没意义,不动').toBe('2025-03')
  })
})
```

- [ ] **Step 2: 跑确认红**

```bash
cd frontend && npx vitest run src/composables/__tests__/useDeepPeriod.spec.ts
```
Expected: 整文件红（模块不存在）。

- [ ] **Step 3: 写 composables/useDeepPeriod.ts**

```ts
// src/composables/useDeepPeriod.ts — 目标屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2)。
//
// 首次:**setup 期同步**跑一次。spec 写的是 onMounted;提前到 setup 是因为五屏的 watch(ym) 与 onMounted 取数
//   都在 setup 里注册 —— 期若晚于它们落定,参数屏会多拉一次;且 ?edit=1 / ?generate=1 的 toggleEdit 必须在期
//   落定之后(否则占到 billing-chain:0-00 的假锁,见 ParamCenterView.applyHandoff 的注释)。首跑不查 dirty:全新实例没有草稿。
// 再次:KeepAlive 切回(onReactivated,7 屏在用,天然跳过首次 activated)。
// 去重键 = route.fullPath(单测的 route 桩多半没有 fullPath,退回 query 序列化)。
// 三不动:parsePeriod 为 null / 与当前 (period, co) 相同 / 目标屏有未保存改动(dirty > 0 → 不切期,只在 note 里说)。
import { ref, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { parsePeriod, periodOf, type DeepPeriod } from '@/nav/deepLink'
import { useBillingPeriodStore } from '@/stores/billingPeriod'

export interface DeepPeriodOpts {
  /** 屏此刻的期与公司,用来判「与当前相同 → 不动」;p 用 periodOf 的形状,co 缺省视同 null */
  current: () => { p: string | null; co?: number | 'all' | string | null }
  apply: (t: DeepPeriod) => void
  /** 未保存改动数;不传 = 没有草稿态的屏 */
  dirty?: () => number
}

export function useDeepPeriod(o: DeepPeriodOpts): { note: Ref<string> } {
  const route = useRoute()
  const note = ref('')
  let applied = ''
  function run(initial: boolean) {
    const key = route.fullPath ?? JSON.stringify(route.query)
    if (key === applied) return
    applied = key
    const t = parsePeriod(route.query as Record<string, unknown>)
    if (!t) return
    const want = periodOf(t.year, t.month)
    const cur = o.current()
    if (cur.p === want && (cur.co ?? null) === t.co) return
    const n = initial ? 0 : (o.dirty?.() ?? 0)
    if (n > 0) { note.value = `地址栏要求 ${want} 期，本期有 ${n} 处未保存`; return }
    o.apply(t)
  }
  run(true)
  onReactivated(() => run(false))
  return { note }
}

/** 出账链五屏的接法:apply = billingPeriod.pick + 补 loadChain(ChainMonthGate 是它的唯一调用方,门被深链跳过就没人加载,P1 复查 F1);
 *  链屏没有公司维度,co 不看;只有年的链接不动(链屏只认整月)。 */
export function useChainDeepPeriod(dirty?: () => number): { note: Ref<string> } {
  const period = useBillingPeriodStore()
  return useDeepPeriod({
    current: () => ({ p: period.ym }),
    apply: (t) => {
      if (t.month == null) return
      period.pick(t.year, t.month)
      void period.loadChain().catch(() => {})
    },
    dirty,
  })
}
```

- [ ] **Step 4: 跑确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/composables/__tests__/useDeepPeriod.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: 8 条绿；vue-tsc 零错。若 `route.fullPath ?? …` 被 vue-tsc 判「左侧永不为空」报错，改写为 `(route as { fullPath?: string }).fullPath ?? JSON.stringify(route.query)` 并在报告里写明。

- [ ] **Step 5: 破坏验证**

删掉 `if (key === applied) return` → 「同 fullPath 二次激活不重复」红（apply 2 次）；还原。把 `const n = initial ? 0 : …` 改成 `const n = o.dirty?.() ?? 0` → 「首跑不查 dirty」红；还原。删掉 `void period.loadChain()…` → 「apply = pick + loadChain」红；还原。把 `if (cur.p === want && …) return` 删掉 → 「与当前相同不动」两处红；还原。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/composables/useDeepPeriod.ts frontend/src/composables/__tests__/useDeepPeriod.spec.ts
git commit -m "feat(composables): useDeepPeriod —— setup 期与 KeepAlive 切回各跑一次、fullPath 去重、三不动;useChainDeepPeriod 接 billingPeriod.pick + loadChain(P0a)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 三屏接线（计费参数 / 公共电核算 / 楼栋损耗）+ 链屏深链行为测

**Files:**
- Modify: `frontend/src/views/params/ParamCenterView.vue:13-15, 92, 150-177`
- Modify: `frontend/src/views/alloc/PoolLedgerView.vue:23-26, 111, 204-220`
- Modify: `frontend/src/views/alloc/LossLedgerView.vue:10-29, 42`
- Modify: `frontend/src/views/__tests__/chainPeriodFlow.spec.ts:37`
- Create: `frontend/src/views/__tests__/chainDeepLink.spec.ts`

**Interfaces:**
- Consumes: `useChainDeepPeriod()`（Task 2）。
- Produces: 三屏带 `?p=` 或旧 `?ym=` 进屏直落该月。

- [ ] **Step 1: 补桩 + 写 chainDeepLink.spec（先红）**

`frontend/src/views/__tests__/chainPeriodFlow.spec.ts` 第 37 行改为：
```ts
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, fullPath: '/alloc-loss' }) }))
```
（断言不动；LossLedgerView 接 useDeepPeriod 后会调 useRoute。）

新建 `frontend/src/views/__tests__/chainDeepLink.spec.ts`：**把 `chainPeriodFlow.spec.ts` 第 1-56 行整段复制过来**（含全部 `import`、`STATUS` 常量、四个 api 模块的 `vi.mock`、`beforeEach` 里的 `mockResolvedValue` 布线 —— 那段代码引用 `allocApi / paramsApi / metersApi / billNoticesApi / STATUS`，缺一个就是 ReferenceError），然后做三处改动：① 文件头注释换成下面的两行；② 第 37 行的 vue-router 桩换成下面「可变 query」版（`const query` 声明放在它上面）；③ `beforeEach` 里加一行 `for (const k of Object.keys(query)) delete query[k]`。`describe('出账链动线 · 楼栋损耗' …)` 整个 describe 删掉，换成下面的 `open()` + `describe('出账链 · 带期深链')`。

```ts
// src/views/__tests__/chainDeepLink.spec.ts — 出账链屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2 / §9 P0a 破坏验证「带 p 进屏直落」)。
// 挑楼栋损耗做样本(与 chainPeriodFlow.spec 同理:链上最薄的一屏,五屏接法逐字相同);mock 与布线与它逐字相同。

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, fullPath: '/alloc-loss?' + new URLSearchParams(query).toString() }),
}))

async function open() {
  const w = mount(LossLedgerView)
  await flushPromises()
  return w
}

describe('出账链 · 带期深链', () => {
  it('❗带 p 进屏直落那个月:门不出现,拉的就是那个月', async () => {
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.cmg').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.ll-wrap').exists()).toBe(true)
    expect(allocApi.loss).toHaveBeenCalledWith('2025-03')
    expect(allocApi.loss, '首载只拉一次(期在 watch 注册前落定)').toHaveBeenCalledTimes(1)
  })
  it('门被跳过时链路条也有数据 —— loadChain 补上了(P1 复查 F1 同坑)', async () => {
    // ⚠ 接线之前这条恒绿:门还在,ChainMonthGate.vue:36 的 onMounted 自己就调 loadChain。
    //   它的鉴别力只在门被跳过之后成立 —— 破坏验证要删的是 useChainDeepPeriod 的 apply 里那句 loadChain,不是接线本身。
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.cmg').exists(), '前提:门已被跳过').toBe(false)
    expect(metersApi.months).toHaveBeenCalled()
  })
  it('旧 ?ym= 照认(出账链四处旧链本期不改发链侧)', async () => {
    query.ym = '2025-03'
    const w = await open()
    expect(w.find('.cmg').exists()).toBe(false)
    expect(allocApi.loss).toHaveBeenCalledWith('2025-03')
  })
  it('显式深链覆盖会话里已选的期(D2)', async () => {
    useBillingPeriodStore().pick(2024, 1)
    query.p = '2025-03'
    await open()
    expect(useBillingPeriodStore().ym).toBe('2025-03')
  })
  it('无 p 不 apply → 照旧撞矩阵;地址栏垃圾也不信', async () => {
    const w1 = await open()
    expect(w1.find('.cmg').exists()).toBe(true)
    query.p = '1999-03'
    const w2 = await open()
    expect(w2.find('.cmg').exists()).toBe(true)
    expect(allocApi.loss).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑确认红**

```bash
cd frontend && npx vitest run src/views/__tests__/chainDeepLink.spec.ts src/views/__tests__/chainPeriodFlow.spec.ts
```
Expected: `chainDeepLink` 第 1 / 2 / 3 / 4 条红（LossLedgerView 还不认 p；第 2 条红在「前提:门已被跳过」那句上 —— 没有它这条会因为门自己调 loadChain 而假绿）、第 5 条绿；`chainPeriodFlow` 7 条绿（桩补了 useRoute 但屏还没用它）。

- [ ] **Step 3: LossLedgerView 接线**

`frontend/src/views/alloc/LossLedgerView.vue` import 区（:17 `onReactivated` 那行之后）加 `import { useChainDeepPeriod } from '@/composables/useDeepPeriod'`；第 42 行 `const chainSteps = …` 之后加：

```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM(或旧 ?ym=)直落该月,pick + loadChain;本屏只读、无草稿,不传 dirty。
// 必须在下面的 onMounted / watch / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于状态刷新改期。
useChainDeepPeriod()
```

- [ ] **Step 4: PoolLedgerView 接线**

import 区（:26 `onReactivated` 之后）加 `import { useChainDeepPeriod } from '@/composables/useDeepPeriod'`；第 111 行 `const chainSteps = …` 之后加同样两行注释 + `useChainDeepPeriod()`（注释末句改「本屏逐行即时写库、无草稿（cfgDirty 是「需重算」不是草稿），不传 dirty」）。

第 204-220 行（两行旧注释 + `const route` + `applyHandoff` 整个函数）替换为：

```ts
// 深链落到同一个月后 generate=1 直接进编辑模式 —— 否则用户到了这儿还要自己找到「编辑模式」才看得见生成按钮(2026-08-14 用户报障)。
// 期本身由 useChainDeepPeriod 在 setup 期落定(认 p= 与旧 ym=,SIDEBAR-UX-REDESIGN §4.2);这里只剩 generate。
const route = useRoute()
function applyHandoff() {
  // ⚠ 顺序仍是先有期再进编辑:toggleEdit 占的锁按 period.year/month 算,期未落定时占的是 billing-chain:0-00,
  //   enter() 的占锁后复核发现期变了,还锁不进,深链彻底进不去编辑态(2026-08-29 修复)。period.picked 也要判:
  //   没有期时主区是选期矩阵,进了编辑态也没有任何写入口。走 toggle 不裸写 editMode:缺权限时弹授权窗。
  if (route.query.generate === '1' && period.picked && canEnter.value) toggleEdit()
}
```

（`onMounted` 里 `applyHandoff()` 的调用与其后 `if (period.picked) loadMonth()` 不动。）

- [ ] **Step 5: ParamCenterView 接线**

import 区（:13-15）加 `import { useChainDeepPeriod } from '@/composables/useDeepPeriod'`；第 92 行 `const chainSteps = …` 之后加同样两行注释 + `useChainDeepPeriod()`（注释末句改「本屏逐行即时写库、无草稿，不传 dirty；?zone / ?section / ?rule / ?edit 仍由下面的 applyHandoff 消费」）。

`applyHandoff` 里删掉这三行：
```ts
  // 只在还没有期时认领:已经选好期的人不该被一条链接顶到别的月去。
  // 链内跳转过来的 ym 与组级期本就相同,这里是给外部深链兜底。
  period.adoptYm(typeof q.ym === 'string' ? q.ym : null)
```
并把紧随其后 `⚠ 必须**先认领期再进编辑态**` 那段注释的第二、三行改为：
```ts
  //   (year/month 此刻还是 `period.year ?? 0`)。期现在由 useChainDeepPeriod 在 setup 更早处落定(§4.2),
  //   本函数只负责 edit=1;顺序约束不变:锁与所编的期错位的表现是「锁没生效」,不报错、没人会发现。
```
函数第一行注释「其它屏跳来的深链:?ym=…」改为「其它屏跳来的深链:?p=2024-02(或旧 ?ym=)&zone=p1&section=rule&rule=23 —— 期归 useChainDeepPeriod,这里消费其余四个键」。`applyHandoff(): boolean` 与 `return period.picked` 保留（无调用方消费返回值，不动）。

- [ ] **Step 6: 跑确认绿 + vue-tsc + 门禁**

```bash
cd frontend && npx vitest run src/views/__tests__/chainDeepLink.spec.ts src/views/__tests__/chainPeriodFlow.spec.ts src/views/__tests__/chainPeriodGate.spec.ts src/views/__tests__/poolWriteGuards.spec.ts src/views/__tests__/coefHandoff.spec.ts src/views/params src/views/__tests__/noInteractionLayoutShift.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: 全绿（`poolWriteGuards` ⑤/⑤b、`paramCenterView.spec` 的 `?ym=2024-02` 与 `edit=1` 用例照旧绿 —— 期由 useChainDeepPeriod 在 setup 落定，toggleEdit 仍在其后）。

- [ ] **Step 7: 破坏验证**

删掉 LossLedgerView 的 `useChainDeepPeriod()` 一行 → `chainDeepLink` 第 1 / 2 / 3 / 4 条红（第 2 条红在「门已被跳过」前提上）、`chainPeriodFlow` 仍绿；还原。保留接线、把 `composables/useDeepPeriod.ts` 里 `useChainDeepPeriod` 的 `void period.loadChain().catch(() => {})` 临时删掉 → 只有第 2 条红（这才是它守的那件事）；还原。把 ParamCenterView 的 `useChainDeepPeriod()` 挪到 `applyHandoff()` 调用之后 → `paramCenterView.spec` 「深链 edit=1」红（占到 0-00）；还原。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/views/params/ParamCenterView.vue frontend/src/views/alloc/PoolLedgerView.vue frontend/src/views/alloc/LossLedgerView.vue frontend/src/views/__tests__/chainPeriodFlow.spec.ts frontend/src/views/__tests__/chainDeepLink.spec.ts
git commit -m "feat(chain): 计费参数 / 公共电核算 / 楼栋损耗接 useChainDeepPeriod —— 带 p 直落该月、门被跳过时链路条照样有数据;adoptYm 两处调用退场(P0a)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 两屏接线（园区抄表 / 催缴单：有草稿的屏）

**Files:**
- Modify: `frontend/src/views/meters/MeterView.vue:9-12, 156-157, 858`
- Modify: `frontend/src/views/bills/BillNoticesView.vue:36-46, 104-105, 239-242, 662`
- Modify: `frontend/src/views/__tests__/meterWriteGuards.spec.ts:60`
- Modify: `frontend/src/views/__tests__/coefHandoff.spec.ts:23, 98-103`

**Interfaces:**
- Consumes: `useChainDeepPeriod(dirty)` 返回 `{ note }`。
- Produces: 两屏带 p 直落；切回时有草稿不切期，`FPToast` 提示。

- [ ] **Step 1: 补桩 + 改 coefHandoff 第 3 条（先红）**

`frontend/src/views/__tests__/meterWriteGuards.spec.ts` 第 60 行改为：
```ts
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, fullPath: '/meters' }) }))
```

`frontend/src/views/__tests__/coefHandoff.spec.ts` 第 23 行「账期不用从 query 取：出账链五屏共读一份组级期，本来就是同一个月。」改为「账期由 useChainDeepPeriod 认（?p= 与旧 ?ym=，SIDEBAR-UX-REDESIGN §4.2）：深链是显式选月，落进五屏共读的组级期；系数簿窗口从 store 读。」；第 98-103 行的用例替换为：

```ts
  it('系数簿拿到的是组级期 —— 深链的 ym 先落进 store(§4.2 / D2:显式链接覆盖会话已选的期),窗口再从 store 读', async () => {
    query.coef = '1'
    query.ym = '2024-12'          // 老协议照认;open() 预置的 2025-03 被它覆盖
    const w = await open()
    expect(useBillingPeriodStore().ym, '深链的期落进 store').toBe('2024-12')
    expect(w.findComponent({ name: 'CoefBookWindow' }).props('ym')).toBe('2024-12')
  })
```

- [ ] **Step 2: 跑确认红**

```bash
cd frontend && npx vitest run src/views/__tests__/coefHandoff.spec.ts src/views/__tests__/meterWriteGuards.spec.ts
```
Expected: `coefHandoff` 第 3 条红（store 仍 2025-03）；其余绿。

- [ ] **Step 3: MeterView 接线**

import 区（:12 `onReactivated` 之后）加 `import { useChainDeepPeriod } from '@/composables/useDeepPeriod'`。第 156 行 `const dirtyIds = …` **之后**加：

```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月,pick + loadChain。本屏是链上唯一有草稿的屏:
// 切回时地址栏要求别的月而草稿未保存 → 不切期,只在 deepNote 里说(换期会 draft.clear(),见下面 watch(ym))。
// 首跑不查 dirty(全新实例没有草稿);必须在 onMounted / watch(ym) 之前调用。
const { note: deepNote } = useChainDeepPeriod(() => dirtyIds.value.length)
```
（它在 :232 的 `onReactivated` 与 :234 的 `onMounted` 之前 ✓。）

模板第 858 行 `<FPToast v-model="okMsg" …/>` 之后加：
```vue
    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
```

- [ ] **Step 4: BillNoticesView 接线**

import 区（:37 `useEditMode` 之后）加 `import { useChainDeepPeriod } from '@/composables/useDeepPeriod'`。第 104 行 `const chainSteps = …` 之后加：

```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM(或旧 ?ym=)直落该月,pick + loadChain。
// 本屏唯一的草稿是行内备注编辑(noteEditKey 非空 = 有一处没提交);切回时有草稿 → 不切期,只在 deepNote 里说。
// dirty 是惰性求值:首跑不查(全新实例没有草稿),所以引用下面才声明的 noteEditKey 没有 TDZ 问题。
// 必须在下面的 onReactivated / onMounted / watch(ym) 之前调用:切回时先改期,状态刷新才读到新月。
const { note: deepNote } = useChainDeepPeriod(() => (noteEditKey.value != null ? 1 : 0))
```

第 239-242 行注释「账期不用从 query 取:出账链五屏共读一份组级期,本来就是同一个月。」改为「账期由 useChainDeepPeriod 认(?p= 与旧 ?ym=,§4.2),落进五屏共读的组级期;本行只读 coef。」。

模板第 662 行 `<FPToast v-model="okMsg" placement="page" :duration="5000" />` 之后加：
```vue
    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
```

- [ ] **Step 5: 跑确认绿 + vue-tsc + 门禁**

```bash
cd frontend && npx vitest run src/views/__tests__/coefHandoff.spec.ts src/views/__tests__/meterWriteGuards.spec.ts src/views/__tests__/billNoticeWriteGuards.spec.ts src/views/__tests__/chainPeriodGate.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts src/views/__tests__/lockDialogsCoverage.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: 全绿；vue-tsc 零错（若 `noteEditKey` 在声明前被引用报 TS2448，把 `useChainDeepPeriod` 那段挪到 `noteEditKey` 声明之后**但仍在 onReactivated 之前**是做不到的 —— 改为把 `const noteEditKey = ref<string | null>(null)` 与 `const noteDraft = ref('')` 两行上提到「账期」块之后，并在报告里写明）。

- [ ] **Step 6: 破坏验证**

把 BillNoticesView 的 `useChainDeepPeriod(...)` 一行删掉 → `coefHandoff` 第 3 条红；还原。把 MeterView 传的 dirty 改成 `() => 0` → 本任务无直接红（dirty 分支由 Task 2 的 composable spec 钉住；记录为「该守卫在屏层无独立断言」，最终复审判）；还原。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/views/meters/MeterView.vue frontend/src/views/bills/BillNoticesView.vue frontend/src/views/__tests__/meterWriteGuards.spec.ts frontend/src/views/__tests__/coefHandoff.spec.ts
git commit -m "feat(chain): 园区抄表 / 催缴单接 useChainDeepPeriod —— 有草稿不切期只提示;系数簿用例改按 D2 口径(P0a)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 发链侧 —— 报表中心 co=all、首页行走 periodLink

**Files:**
- Modify: `frontend/src/views/reports/home/ReportsHomeView.vue:8, 41-49`
- Create: `frontend/src/views/reports/home/__tests__/reportsHomeGo.spec.ts`
- Modify: `frontend/src/views/data-home/DataHomeView.vue:24, 58-87`
- Modify: `frontend/src/views/data-home/DataHomeView.spec.ts`（`push('/meters')` 类断言与 `{ y, m }` 断言）

**Interfaces:**
- Consumes: `periodLink / periodOf`（Task 1）。

- [ ] **Step 1: 写 reportsHomeGo.spec + 改 DataHomeView.spec（先红）**

新建 `frontend/src/views/reports/home/__tests__/reportsHomeGo.spec.ts`：

```ts
// 报表中心点卡带期(SIDEBAR-UX-REDESIGN §4.2):走 periodLink,co=all → 三大报表直落「全部汇总」。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {}, meta: {} }) }))
vi.mock('@/reports/reportsHome', async (o) => ({
  ...(await o<object>()),
  defaultPeriod: vi.fn().mockResolvedValue({ year: 2025, month: 6 }),
  loadHomeData: vi.fn().mockResolvedValue({ cards: [], tieout: [], year: 2025, month: 6 }),
}))

import ReportsHomeView from '../ReportsHomeView.vue'

beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); push.mockClear() })

describe('报表中心 · 点卡带期', () => {
  it('go 走 periodLink:p=本屏选好的期,co=all;显式导航仍是全新状态(openFresh)', async () => {
    const w = mount(ReportsHomeView)
    await flushPromises()
    ;(w.vm as unknown as { go: (v: string) => void }).go('income-statement')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2025-06', co: 'all' } })
    expect(useTabsStore().epochOf('income-statement')).toBe(1)
  })
})
```

`frontend/src/views/data-home/DataHomeView.spec.ts`：
- 「点出账链步骤:先把首页当前月写进 billingPeriod 再跳转」里 `expect(push).toHaveBeenCalledWith('/meters')` 改为 `expect(push).toHaveBeenCalledWith({ path: '/meters', query: { p: '2024-02' } })`。
- 「全 done 的「去对账核对」带 ?y&m」改名「全 done 的「去对账核对」带 ?p」，断言改为 `expect(push).toHaveBeenCalledWith({ path: '/reconciliation', query: { p: '2024-02' } })`。
- `grep -n "toHaveBeenCalledWith('/" DataHomeView.spec.ts`：凡目标是出账链五屏（params / meters / alloc / alloc-loss / bill-notices）的裸字符串断言都改成 `{ path, query: { p: '2024-02' } }`；附表屏（如 `'/ledger'`）保持裸字符串。

- [ ] **Step 2: 跑确认红**

```bash
cd frontend && npx vitest run src/views/reports/home src/views/data-home
```
Expected: `reportsHomeGo` 1 条红（query 仍是 y/m 无 co）；`DataHomeView.spec` 改过的断言红，其余绿。

- [ ] **Step 3: ReportsHomeView.go**

第 8 行 `import { periodQuery } from '@/nav/reportPeriod'` 改为 `import { periodLink, periodOf } from '@/nav/deepLink'`；`go` 改为：

```ts
function go(v: string) {
  tabsStore.openFresh(v)
  // 走 periodLink 带 co:'all'(SIDEBAR-UX-REDESIGN §4.2):三大报表直落「全部汇总」;损益附表 / 收入核对认得几个用几个
  router.push(periodLink(v, { p: periodOf(year.value, month.value), co: 'all' }))
}
```

- [ ] **Step 4: DataHomeView.go**

第 24 行 `import { periodQuery } from '@/nav/reportPeriod'` 改为 `import { periodLink, periodOf } from '@/nav/deepLink'`。`go()` 末尾：

```ts
  tabsStore.openFresh(v)
  // 链屏与收入核对带 ?p(SIDEBAR-UX-REDESIGN §4.1「显式选月 + periodLink」):目标屏 useDeepPeriod 认得,
  // 链屏还会与上面预 pick 的期比对(相同 → 不动);附表屏本期仍裸 push(P0b 再接,别提前发死参数)。
  if (p && (CHAIN_VALUES.has(v) || v === 'reconciliation')) {
    router.push(periodLink(v, { p: periodOf(p.year, p.month) }))
    return
  }
  router.push('/' + v)
```
函数上方注释里「收入核对认 ?y&m(ReconView.vue:23 parsePeriodQuery),其余屏本期不带参(P0b 再接)。」改为「链屏与收入核对带 ?p(目标屏的 parsePeriod / parsePeriodQuery 都认),附表屏本期不带参(P0b 再接)。」。

- [ ] **Step 5: 跑确认绿 + vue-tsc**

```bash
cd frontend && npx vitest run src/views/reports/home src/views/data-home src/views/__tests__/reportWorkbenchFlow.spec.ts && npx vue-tsc --noEmit -p tsconfig.app.json
```
Expected: 全绿（`reportWorkbenchFlow` 的四条「带期深链」仍用 y/m/co，parsePeriodQuery 委托后照认）。

- [ ] **Step 6: 破坏验证**

把 ReportsHomeView 的 `co: 'all'` 删掉 → `reportsHomeGo` 红；还原。把 DataHomeView 的 `|| v === 'reconciliation'` 删掉 → 「去对账核对带 ?p」红；还原。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/views/reports/home/ReportsHomeView.vue frontend/src/views/reports/home/__tests__/reportsHomeGo.spec.ts frontend/src/views/data-home/DataHomeView.vue frontend/src/views/data-home/DataHomeView.spec.ts
git commit -m "feat(nav): 报表中心点卡带 co=all 直落全部汇总;首页链屏行与对账行走 periodLink 带 p(P0a)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 门禁 + 对抗复查 + 复查记录

- [ ] **Step 1: 全量门禁**

```bash
cd frontend && npx vitest run && npm run build
```
Expected: vitest 全绿（基线 182 files / 2153 tests → 186 files；+4 文件：deepLink.spec 11、useDeepPeriod.spec 8、chainDeepLink.spec 5、reportsHomeGo.spec 1 = +25，coefHandoff 改写 0 → 2178 tests）；`npm run build` 绿，size-check index ≤ 191KB（预期不变：新模块只被懒加载屏 import）。**若 index 超线**：先确认 `nav/deepLink` / `composables/useDeepPeriod` 是否被 index 级模块（router / stores / shell）间接 import 了 —— 应当没有；仍超则停下写清原因，不签字上调。

- [ ] **Step 2: spec 口径随裁定**

`docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §4.2 第三条「`onMounted` 跑一次」改为「setup 期同步跑一次（2026-09-03 P0a 裁定：赶在各屏 watch(ym) 注册与 onMounted 取数之前落期，首跑不查 dirty）」；同条末尾补「链屏 apply 后补 `loadChain`」。§5.1 里「`reconciliation` 带 `periodQuery(y, m, null)`」改为「链屏行与 `reconciliation` 行走 `periodLink(v, { p })`（P0a）」。§9 P0a 行不动。随复查记录一起 `git add docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` 提交。

- [ ] **Step 3: 对抗复查（三镜头 → 逐条反驳）**

镜头：① 正确性 —— 五屏首载取数次数、`?edit=1` / `generate=1` 锁的期、切回改期与既有 `onReactivated` 状态刷新的顺序、`p` 与预 pick 相同时零副作用、`co='all'` 落到 `pickCompany`、旧 `ym` 链（含 PvMeterAnaView:242）；② 护栏 —— 去重键在真实 router 与桩下的行为、破坏验证是否逐条做了、`chainPeriodGate` / `noInteractionLayoutShift` 是否被绕过、dirty 守卫在屏层无独立断言的风险；③ 用户价值 —— 「地址栏要求 X 期」文案能否被看见（page toast 是否被 FPLockDialogs 盖住）、报表中心 co=all 对损益附表 / 收入核对无副作用、书签 `/meters?p=` 刷新后行为。每条发现三名反驳者；坐实的进一次修复波 + 定向复审。

- [ ] **Step 4-5: 复查记录 + 提交**

本文件末尾追加「## 复查记录」并提交 `docs(plan): P0a 复查记录`。

---

## 自查（对 spec §4.1 / §4.2 / §5.1 / §9 P0a / §10）

- §4.2 `periodLink` 形状 / `parsePeriod` 三代格式 + co 三态 / 两处委托旧用例保留：Task 1 ✓。
- §4.2 `useDeepPeriod`：首跑一次（setup，裁定）+ `onReactivated` + fullPath 去重 + 三不动 + 屏内提示文案：Task 2 ✓；链屏 apply = pick（adoptYm 不改）：Task 2 `useChainDeepPeriod` ✓ + loadChain（P1 F1）✓。
- §4.2 出账链五屏：Task 3（params / alloc / alloc-loss）+ Task 4（meters / bill-notices）✓；运营账三屏 / 台账 / 附10 / 年表 / 导入中心 = P0b，不做 ✓；报表层三屏接 useDeepPeriod = P0c，不做 ✓；`ReportsHomeView.go` 带 co='all'：Task 5 ✓。
- §4.1 首页行「显式选月 + periodLink」：Task 5 ✓（附表行 P0b）。
- §9 P0a 破坏验证：「带 p 进屏直落」= Task 3 chainDeepLink.spec ✓；「同 fullPath 二次 activated 不重复取数」= Task 2 useDeepPeriod.spec ✓。
- §10 新增 `deepLink.spec`（p / ym / y&m / company 名兼容、越界丢弃；pin 规则 → P3 裁定）✓、`useDeepPeriod.spec` 四条 ✓；「不变」清单：断言不变，两处桩补 useRoute ✓；`billingPeriod.spec:84-88` 不动 ✓。
- 类型一致：`DeepPeriod`（Task 1）→ `apply: (t: DeepPeriod)`（Task 2）；`periodOf` 形状与 `current().p`（`period.ym` 是 `YYYY-MM`）一致 ✓；`periodLink` 的 `query` 是 `Record<string, string>`，与 `FPStepStrip.query` 类型兼容 ✓。

## 复查记录（2026-09-03）

**计划级对抗复查（实施前，3 镜头 → 每条 3 名反驳者）**：17 条发现，6 坐实、11 被驳。坐实归两件，提交前修入计划（0883a60）：`chainDeepLink.spec` 第 2 条在红阶段因门自己调 `loadChain` 而假绿 → 补「门已被跳过」前提、破坏验证改删 apply 里的 `loadChain`；骨架漏 `paramsApi / billNoticesApi / STATUS` → 改成整段复制 `chainPeriodFlow.spec:1-56` 再改三处。顺手：PoolLedgerView 替换区间 204-220、Task 6 补 spec §5.1 与 git add。

**任务级评审（每任务一次，独立评审员）**

| 任务 | 提交 | 结果 |
|---|---|---|
| T1 `deepLink.ts` + 两处委托 | 03a5e05 | 通过，零发现（14 + 7 条旧用例逐条手算） |
| T2 `useDeepPeriod` | ffc401b（+552e9eb） | 通过；Minor：note 不清空 → 控制者顺手修（下一次 apply 清空 + 断言 + 破坏验证）；去重键先记写入注释；年份链 + dirty 假提示（链屏无年份链来源）；composable 静态 import billingPeriod store（P0c 报表屏 spec 需多 mock 四个 api） |
| T3 计费参数 / 公共电核算 / 楼栋损耗 | e88bbcf | 通过；三屏调用顺序全文核对 ✓；Minor：三处过时注释（→ 修复波） |
| T4 园区抄表 / 催缴单 | dcbdb0c | 通过；两屏顺序核对 ✓；破坏验证用常量 ref 替换比整行删更精准；Minor：dirty 闸屏级无断言（→ 修复波）、两只 page toast 同位 |
| T5 报表中心 co=all + 首页 periodLink | a734140 | 通过，零发现 |

**代码级对抗复查（3 镜头：正确性 / 护栏 / 用户价值 → 每条 3 名反驳者）**：13 条发现，1 坐实，12 被驳（全部 3/3）。

| # | 发现 | 处置 |
|---|---|---|
| P0A-2 | 分析层「去改常数」的 `?ym=YYYY-12` 不是选月，改造后被当显式深链覆盖已选期（改前 `adoptYm` 只在无期时认领），四个 KeepAlive 链屏跟着变空月 | **坐实** → 修复波：键改 `adopt=`，ParamCenterView 保留一处 `adoptYm`（只认领不覆盖），+2 用例；收尾再钉 PvMeterAnaView 的 push 形状（e4726da） |
| P0A-1（两镜头） | 组级期变化会清掉**别屏**（抄表）的未保存草稿，dirty 只护落地屏 | 被驳：spec §4.2 明写「目标屏」+ D2；P3 翻 openFresh 语义时重看 |
| P0A-3（用户价值） | URL 的 `?p` 一次性、屏内换月不同步、F5 回到达月 | 被驳：既有一次性深链约定（报表层同款），D3 期只记会话 |
| G1 | dirty 闸屏级无断言 | 被驳为「已排修复波」→ 修复波已补屏级用例 |
| 其余 | G2 兜底分支无断言 / G3 co=all 无落屏用例（P0c）/ G4 年份链假提示 / G5 spec 未改（Task 6 Step 2）/ P0A-4 adoptYm 文档 / P0A-5 提示 P0a 走不到（Back 可达）/ co=all 请求顺序 / loadBinding 双拉 | 被驳 |

修复波 c5e241f（`adopt=` + 三处注释 + MeterView 屏级 dirty 用例），定向复审 3/3 ADDRESSED、无新破坏；收尾 e4726da 钉「去改」push 形状（破坏验证：键改回 `ym` 即红）。复查纪律：反驳者各留过探针文件 / 在飞改动，结束时均已清；一名评审员留的 `block1/2.txt` 由控制者清掉。

**门禁**：全量 vitest 186 files / 2181 tests（基线 182 / 2153，+4 文件 / +28 条 = 计划 +25 + 修复波 +3）；`npm run build` 绿，size-check index 189.2KB / 191（基线 189.1；`nav/deepLink` 成独立块），合计 3871.4 / 3900。后端零改动。

**遗留（后续期）**：P3 翻 openFresh 语义时重看「组级期变化 vs 别屏草稿」（P0A-1）；P0c 报表屏接 `useDeepPeriod` 时 spec 需 mock 四个 api（composable 静态 import billingPeriod）；co=all 落屏用例随 P0c；两只 page toast 同位（`deepNote` 加 `v-if="!okMsg"`）；浏览器人工走查（首页行 → 链屏 URL 带 p 且直落、报表中心 → 利润表落「全部汇总」、分析层「去改」不改月）由用户做。
