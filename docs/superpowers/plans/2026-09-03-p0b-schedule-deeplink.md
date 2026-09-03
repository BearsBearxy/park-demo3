# P0b 附表族 / 台账 / 附10 / 运营账三屏 / 导入中心接期间深链 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页「附表录入」9 行各省一次门：带 `p`（年表屏只带年）进 11 张附表 / 台账 / 运营账屏直落目标期；KeepAlive 切回时 9 屏重读（导入中心导完切回来不再是旧表）；导入中心按 `p`/`co` 预填台账类表单，台账 / 附10 / 附12 导完给「去查看」直落刚导的那个期。

**Architecture:** 目标屏一律 `useDeepPeriod({ current, apply, dirty? })`（P0a 已落，setup 期同步首跑 + `onReactivated`，三不动）。三类 apply 形状：① 期在 composable / store 里的屏（运营账三屏 `useMonthGate.pick`、年表四屏 `pickYear`、附12 `pickCell`）—— 同步 pick，取数交给屏内既有的 onMounted / watch / pickYear；② 期与册都在屏内 ref、册要等 books 回来的屏（台账 / 附10）—— apply 是异步的，先 `ensureLoaded()`（onMounted 与 apply 共用一个 Promise，只拉一次）再落册落期；③ 导入中心没有「当前期」，`parsePeriod(route.query)` 读一次预填表单，不接 useDeepPeriod。`extra.mode` / `extra.tab` 只在 setup 读一次（首页附表行走 `openFresh`，实例总是新的）。9 屏补 `onReactivated` 重读，紧跟 useDeepPeriod 之后注册（先改期，后重读）。发链侧 `DataHomeView.go` 附表行改走 `periodLink`；导入中心「去查看」也走 `periodLink`。

**Tech Stack:** Vue 3 `<script setup>` + Pinia + vue-router 4 + Vitest（jsdom）+ @vue/test-utils；vue-tsc strict。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §4.2（协议：运营账三屏 `screenPeriod.pick`；台账 `co` 落 `activeBookId` + `year/month`；附10 `co` = 期区 1..4、避开 `selectBook → goGate`；年表屏 `p` 只取年；导入中心 `p` 预填）· §5.1（`extra.tab` / `extra.mode` 随本期一起加）· §9 P0b 行（价值：附表行各省一次门、导后「去查看」；破坏验证：附10 chip 深链不撞 `goGate`）· §10 · §12（8 张附表屏补重读）。

## Global Constraints

- **唯一入口 / 出口**：目标屏一律 `useDeepPeriod`（`frontend/src/composables/useDeepPeriod.ts`，**本期不改它**）；新链接一律 `periodLink`。旧格式（台账 `?y&m&company&tenant`、附10 `?y&m&phase&tenant`）只在**解析侧**兼容：`parsePeriod` 已认 `y&m&company`，`?phase=` / `?tenant=` 由屏在 apply 里从 `route.query` 兜底读。收入核对 / 分析层 5 处旧发链本期不改（P0c 随分析层 9 处一起迁）。`utils/deepLink.ts` 两个旧解析器**保留**（spec §10 钉它的旧用例），只是 LedgerView / S10View 不再 import 它 —— 裁定：P0c 迁完发链侧再删。
- **触发时机**：首跑在 setup 期同步（P0a 裁定）。台账 / 附10 的 apply 是 **async**（setup 期 books 还没到）：apply 内先 `await ensureLoaded()` 再落册落期；`onMounted` 只 `void ensureLoaded()`。既有 `monthTemplate.spec` / `archivedCols.spec` 的常量 query（`y=2026&m=9&…`，无 fullPath）走的就是这条路，**断言不动**。
- **注册顺序**：`useDeepPeriod` 放在各屏期源声明完之后、任何 `onMounted` / `watch(期)` / `onReactivated` 之前；补重读的 `onReactivated` **紧跟其后**（先改期，后重读）。运营账三屏尤其：放在 `useMonthGate` 解构之后、`onMounted` 之前，否则首载多拉一次。
- **重读 9 屏**（spec §12 的 8 张：附10 / 附6 / 附7·8 / 附11 / 附13·14 / 附12 / 分栋抄表 / 电费成本，+ 台账月表 —— 它的既有 `onReactivated` 只恢复抽屉不重读，裁定一起补）：重读体 = 总览 + 当前期；**有草稿不重读当前期**（附10 `dirty.size > 0`、台账 `edit`；`loadMonth` 会 `dirty.clear()` / 换快照会把 draft 判脏）。CpMeterView 已有三支，不动。
- **apply 形状**：
  - 运营账三屏：`apply: (t) => { if (t.month != null) pickCell(t.year, t.month) }` —— **只 pick**，取数交给既有 `onMounted` 的 `if (picked) load…()` 与 `watch(gateYm)`。`current: () => ({ p: gateYm.value })`（`useMonthGate.ym` 已是 `YYYY-MM` | null）。不许出现 `const year = ref` / `const month = ref`（`meterPeriodGate.spec`）。
  - 年表四屏（附6 / 7·8 / 11 / 13·14）：`current: () => ({ p: year.value == null ? null : periodOf(year.value, null) })`（**p 只取年**，否则首页发 `2025-03` 时永不相等、每次切回白拉一趟）；`apply: (t) => { void pickYear(t.year).catch(() => {}) }`；三张两本账屏加 `if (mode.value === 'summary')` 门（运营账那本开着时年表在 `v-else` 底下看不见，不白拉）。
  - 附12：`apply: (t) => { if (t.month != null) void pickCell(t.year, t.month) }`（pickCell 置月 + pickYear 取数，顺序已对）。
  - 附10：期区直写 `activeBookId`，**不经 `selectBook`**（它在表格态末行 `goGate`）；三个 ref 同一拍连写（册 → `pickCell` 置月置年），`watch([activeBookId, year, month])` 只跑一次 `templateAt`。`co` 缺席时用旧 `?phase=` 兜底。
  - 台账：`co` 数字 → 按 `companyId` 找册；字符串（旧 `company` 名）→ 先公司名再册名；**没给 co → 当前册，还没选册就是首册**（裁定：首页台账行本期不带公司，公司 chips 是 P2 的事；「本月台账」落首册与附10 落一期同口径）；认不出 → 不动。换期前若在编辑态先 `cancelEdit()`（LedgerWideTable 的 `watch(edit)` 据此还锁）。
  - 只有年的链接（`t.month == null`）：认整月的屏（台账 / 附10 / 附12 / 运营账三屏）一律 return。
- **extra 只读一次**：`?mode=summary|meter|cost` 在三张两本账屏的 `mode` 初值里认（`const mode = ref<Mode>(deepMode ?? loadViewMode(…))` —— 保留 `mode = ref<Mode>` 字面形状，`twoBooksRail.spec:150` 钉着）；**不写回 localStorage**（`watch(mode)` 非 immediate，只记用户自己的切换）。`?tab=office|phase3` 在 `UtilitiesView.tab` 初值里认，必须早于 `year` 落定（`loadYear` 读 `no`）。切回时不认 extra（首页行走 openFresh）。
- **dirty 源**（惰性求值，可引用下方才声明的 ref）：附10 `() => dirty.size`；台账 `dirtyCount()`（编辑态下 draft 与快照逐行比 + `deletedKeys`，子组件 `isDirty` 同口径的计数版）；年表四屏 `() => (drawer.value || importing.value ? 1 : 0)`（开着的新增抽屉 / 导入窗；`pickYear` 会经 `edit=false` 把它们关掉；四屏都没有 onDeactivated，切走时浮层还开着）；分栋抄表 / 分桩明细**不传**（行草稿只能在抽屉里产生，onDeactivated 清 `openSt` → `watch(openSt, cancelForm)` 顺手清 `adding` / `editId`，切回时没有草稿可护 —— Task 1 评审坐实，计划复查的反驳者漏看了这一跳）；附12**不传**（`SalaryView.vue:124` 的 onDeactivated 切走即关浮层，切回时没有草稿可护 —— 计划复查 P0B-2）；电费成本总览**不传**（全部即时乐观提交，没有草稿）；导入中心不接。**没有 dirty 的屏不接 `note`、不加 FPToast**（与 P0a 的 LossLedgerView / PoolLedgerView / ParamCenterView 同口径）。
- **屏内提示只走 `FPToast`**（`<FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />`，与 MeterView.vue:864 逐字相同；变量名 `deepNote`）；不写流内 `<div v-if>`（`noInteractionLayoutShift.spec`，`KNOWN_DEBT` 保持空）。文案「地址栏要求 X 期，本期有 N 处未保存」（全角逗号）。
- **既有 spec 只补桩不改断言**（spec §10）：`meterPeriodFlow` / `cpMeterFlow` / `elecCostFlow` / `salaryMonthGate` / `salaryGuards` / `twoBooksRail` 六份没有 vue-router 桩，屏接 useDeepPeriod 后 `useRoute()` 返回 undefined 当场炸 —— 各补「可变 query + fullPath getter」桩（照 `meterWriteGuards.spec:60-66`；fullPath 必须是 getter，否则 KeepAlive 切回读到旧地址）。`monthTemplate` / `archivedCols` / `ledgerLeaveAndReturn` 桩已有、断言不动。
- **源码形状门禁**（改屏时会撞的）：`meterPeriodGate.spec`（三屏无 `const (year|month) = ref`、`<FPMonthGate v-if="!picked"` 逐字、CpMeter 两行字面量）；`twoBooksRail.spec:144-172`（`mode = ref<Mode>`、MODE_SCREEN 键字面量、`if (!edit.value) return` ≥ 2）；`bookRail.spec:173-182`（`<BookRailShell`）；`schedHeader.spec:140-146, 203-212`（S10View 的 `finishEdit(forced = false)` / `if (forced)` / `:copy-text="draftAsTsv"`）；`lockDialogsCoverage.spec`（三屏 FPLockDialogs 四绑定）。
- **导入中心**：`parsePeriod(route.query)` 读一次；`lf` 默认值改成 `defaultLf()`（深链 co 必须在公司名单里，否则退回首家）；`openImport` 第 98 行的重置也走 `defaultLf()`。「去查看」只给**期在导入时就已知**的三类：台账（`ctx.year/month/companyId`）、附10 / 附12（第一段 pick 的 `year/month(/phase)`）；其余类型结果弹层照旧。`ImportResultToast` 加可选 `go?: string` prop + `go` emit（17 个消费方不传 = 零变化）。跳转走裸 `router.push`（`router.afterEach` 会 `tabs.open`；目标页签活着就走 onReactivated 那条 apply，不活就新实例 setup 那条）。
- **DataHomeView.go**：附表行改走 `periodLink`：台账 / 附10 / 附12 带 `p=YYYY-MM`；附6 / 7 / 8 / 11 带 `p=YYYY` + `extra.mode='summary'`；附13 / 14 带 `p=YYYY` + `extra.tab`（按行 `tag` 分：`'附14'` → `phase3`，否则 `office`），模板 `@click="go(i.go, i.tag)"`。预 `pick` + 确认框 + `loadChain` 三句不动；附表行不碰 `billingPeriod`（`DataHomeView.spec:160/176` 两条的后半断言仍绿）。
- `npm run build` size-check：index ≤ 191KB（当前 189.2）。`useDeepPeriod` 今天落在 `ChainMonthGate` 块里（5 个消费屏都 import 它）；本期 8 个不 import ChainMonthGate 的屏也用它，rollup 会把它提升成新的共享块 —— 它只被懒加载屏 import，预期不进 index。**触线即停，先查是否被 index 级模块间接 import，不签字上调**。
- 每条新断言按 memory 节奏破坏验证（改坏 → 只该红的红 → **字符串替换还原，绝不 `git checkout`**）。
- 提交信息末尾：`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 所有命令在 worktree `C:\financial_dashboard\demo3\.claude\worktrees\model-12d043`；前端命令在 `frontend/`。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `frontend/src/views/pv/PvMeterView.vue` · `charging/CpMeterView.vue` · `elec/ElecCostView.vue` | 接 `useDeepPeriod`（pick 进 screenPeriod，三屏都不传 dirty）+ 补重读（Pv / Elec） |
| `frontend/src/views/__tests__/meterPeriodFlow.spec.ts` · `cpMeterFlow.spec.ts` · `elecCostFlow.spec.ts` | 补 vue-router 桩 + 深链用例 |
| `frontend/src/views/salary/SalaryView.vue` | 接 `useDeepPeriod`（pickCell）+ 补重读 + `FPToast` |
| `frontend/src/views/__tests__/salaryMonthGate.spec.ts` · `salaryGuards.spec.ts` | 补桩 + 深链用例 |
| `frontend/src/views/pv/PvView.vue` · `charging/ChargingView.vue` · `elec/ElecView.vue` · `utilities/UtilitiesView.vue` | 接 `useDeepPeriod`（pickYear，p 只取年）+ `mode` / `tab` 初值读 query + 补重读 + `FPToast` |
| `frontend/src/views/__tests__/twoBooksRail.spec.ts` | 补桩 + PvView 深链用例 |
| `frontend/src/views/__tests__/schedDeepLink.spec.ts`（新） | 附13/14 tab · 附表8 · 附表11 mode |
| `frontend/src/views/sales-income/S10View.vue` | `ensureLoaded` + 异步 apply（期区直写 activeBookId）+ 重读 + `FPToast`；删 `parseS10DeepLink` import |
| `frontend/src/views/__tests__/s10DeepLink.spec.ts`（新） | co=3 直落不撞 goGate / 旧 phase 链 / 只有年不动 / 切回重读 / dirty |
| `frontend/src/views/ledger/LedgerView.vue` · `LedgerWideTable.vue:63-64`（注释） | `ensureLoaded` + 异步 apply（co → 册）+ `dirtyCount` + 重读 + `FPToast`；删 `parseLedgerDeepLink` import |
| `frontend/src/views/__tests__/ledgerDeepLink.spec.ts`（新） | p+co / 旧 company 链 / 无 co 首册 / 认不出不动 / dirty / 无改动退编辑 / 切回重读 |
| `frontend/src/components/import/ImportResultToast.vue` | `go?: string` prop + `go` emit |
| `frontend/src/views/import-center/ImportCenterView.vue` | `parsePeriod` 预填 `lf` + `viewLink` + 「去查看」 |
| `frontend/src/views/__tests__/importCenterDeepLink.spec.ts`（新） | 预填 / 默认值 / co 不在名单 / 去查看 ×3 |
| `frontend/src/views/data-home/DataHomeView.vue:58-89, 217-218` · `DataHomeView.spec.ts` | 附表行走 `periodLink`（月表 p / 年表 p+mode / 附13·14 tab） |
| `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` 头行 / §4.2 / §12 | 口径随裁定 |

---

### Task 0: 准备与基线

- [ ] **Step 1: BASE 与基线**

```bash
git rev-parse --short HEAD
cd frontend && npx vitest run src/views/__tests__ src/views/data-home src/composables src/nav
```
Expected: 全绿；记下 files / tests。全量基线：186 files / 2181 tests；size-check index 189.2 / 191，合计 3871.4 / 3900。

---
### Task 1: 运营账三屏（分栋抄表 / 分桩明细 / 电费成本总览）

**Files:**
- Modify: `frontend/src/views/pv/PvMeterView.vue:9, 88, 183-188`
- Modify: `frontend/src/views/charging/CpMeterView.vue:17, 91`
- Modify: `frontend/src/views/elec/ElecCostView.vue:9, 85, 173-178`
- Modify: `frontend/src/views/__tests__/meterPeriodFlow.spec.ts:3, 45, 63, 79`
- Modify: `frontend/src/views/__tests__/cpMeterFlow.spec.ts:43, 71`
- Modify: `frontend/src/views/__tests__/elecCostFlow.spec.ts:3, 46, 84, 90`

**Interfaces:**
- Consumes: `useDeepPeriod({ current, apply, dirty? })`（P0a，`@/composables/useDeepPeriod`）；`onReactivated`（`@/composables/onReactivated`）；`useMonthGate` 解构出的 `pick: pickCell` / `ym: gateYm` / `picked`。
- Produces: 三屏带 `?p=YYYY-MM` 进屏直落该月；切回重读；`deepNote` toast。

- [ ] **Step 1: 三份 spec 补桩 + 写深链用例（先红）**

`meterPeriodFlow.spec.ts`：第 3 行 `import { defineComponent, nextTick } from 'vue'` 改为 `import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'`。第 45 行（locks 的 `vi.mock` 结束的 `}))` 之后）插入：

```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):屏接了 useDeepPeriod(内部 useRoute)。query 可变 —— 深链那几条要在切回之间换掉 ?p=;
// fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)。
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/pv-income?' + new URLSearchParams(query).toString() } }),
}))
```

`beforeEach` 里 `localStorage.clear()` 之后加一行 `for (const k of Object.keys(query)) delete query[k]`。`open()` 之后加：

```ts
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(照 meterWriteGuards.spec:299)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(PvMeterView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}
```

文件末尾追加：

```ts
describe('光伏分栋抄表 · 期间深链(SIDEBAR-UX-REDESIGN §4.2)', () => {
  it('❗带 p 进屏直落那个月:矩阵不出现,读数只拉一次、拉的就是那个月', async () => {
    // 红线:PvMeterView.vue 的 useDeepPeriod({ apply: … pickCell }) 删掉 → 落回矩阵;
    //      挪到 onMounted 之后 → 首载 readings 拉两次(onMounted 一次 + watch(gateYm) 一次)
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.fmg').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.pm-per').text()).toBe('2025-03')
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
    expect(pvMeterApi.readings, '首载只拉一次(期在 onMounted / watch 之前落定)').toHaveBeenCalledTimes(1)
  })

  it('只有年的链接不动 —— 本屏只认整月', async () => {
    query.p = '2025'
    const w = await open()
    expect(w.find('.fmg').exists()).toBe(true)
    expect(pvMeterApi.readings).not.toHaveBeenCalled()
  })

  it('❗切页签回来要重拉电站、账期清单与本月 —— 导入中心导完切回来不能还是旧表(spec §12)', async () => {
    // 红线:PvMeterView.vue 的 onReactivated 三支删掉 → 切回零请求
    const { w, alive } = await keptAlive()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    vi.mocked(pvMeterApi.stations).mockClear()
    vi.mocked(pvMeterApi.months).mockClear()
    vi.mocked(pvMeterApi.readings).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(pvMeterApi.stations).toHaveBeenCalledTimes(1)
    expect(pvMeterApi.months).toHaveBeenCalledTimes(1)
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
  })

  it('切回时地址栏换了月 → 先改期再重读:拉的是新月,没有一趟按旧月拉', async () => {
    // 红线:useDeepPeriod 挪到 onReactivated 之后 → 重读那支先按 2025-03 拉一次
    query.p = '2025-03'
    const { w, alive } = await keptAlive()
    vi.mocked(pvMeterApi.readings).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2025-04'
    alive.value = true; await flushPromises()
    expect(w.find('.pm-per').text()).toBe('2025-04')
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 4)
    expect(pvMeterApi.readings, '重读那趟不许还按旧月拉').not.toHaveBeenCalledWith(2025, 3)
  })

  it('抽屉里正在新增一行时切走 → 草稿随抽屉一起收掉;切回换月照换(本屏不设 dirty 闸:切回时没有草稿可护)', async () => {
    // 红线:onDeactivated 里的 `openSt.value = null` 删掉 → watch(openSt, cancelForm) 不跑,adding 留着 → 「草稿已收」断言红
    query.p = '2025-03'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(PvMeterView).vm as unknown as { openSt: unknown; startAdd: () => void; adding: boolean }
    vm.openSt = STATIONS[0]        // 走真实路径:新增行只能从抽屉里点出来
    vm.startAdd()
    await flushPromises()
    expect(vm.adding, '前提:新增行展开着').toBe(true)
    alive.value = false; await flushPromises()
    expect(vm.adding, '切走时抽屉收掉,草稿跟着没了').toBe(false)
    query.p = '2025-04'
    alive.value = true; await flushPromises()
    expect(w.find('.pm-per').text(), '没有草稿可护 → 期照换').toBe('2025-04')
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 4)
  })
})
```

`cpMeterFlow.spec.ts`：第 43 行（locks mock 的 `}))` 之后）插入同款桩（`const query` + `vi.mock('vue-router', …)`，fullPath 前缀改 `'/car-charging?'`）；`beforeEach` 里 `localStorage.clear()` 之后加 `for (const k of Object.keys(query)) delete query[k]`；文件末尾追加：

```ts
describe('分桩充电明细 · 期间深链(SIDEBAR-UX-REDESIGN §4.2)', () => {
  it('❗带 p 进屏直落那个月:矩阵不出现,记录只拉一次、拉的就是那个月', async () => {
    // 红线:CpMeterView.vue 的 useDeepPeriod 删掉 → 落回矩阵;挪到 onMounted 之后 → readings 拉两次
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.fmg').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.cm-page').exists()).toBe(true)
    expect(cpMeterApi.readings).toHaveBeenCalledWith(2025, 3)
    expect(cpMeterApi.readings).toHaveBeenCalledTimes(1)
  })

  it('抽屉里正在新增一行时切走 → 草稿随抽屉一起收掉;切回换月照换(本屏不设 dirty 闸:切回时没有草稿可护)', async () => {
    // 红线:onDeactivated 里的 `openSt.value = null` 删掉 → watch(openSt, cancelForm) 不跑,adding 留着 → 「草稿已收」断言红
    query.p = '2025-03'
    const Host = defineComponent({
      components: { CpMeterView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><CpMeterView v-if="on" vehicle-type="car" /></KeepAlive>',
    })
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    const vm = w.findComponent(CpMeterView).vm as unknown as { openSt: unknown; startAdd: () => void; adding: boolean }
    vm.openSt = STATIONS[0]        // 走真实路径:新增行只能从抽屉里点出来
    vm.startAdd()
    await flushPromises()
    expect(vm.adding, '前提:新增行展开着').toBe(true)
    await w.setProps({ on: false }); await flushPromises()
    expect(vm.adding, '切走时抽屉收掉,草稿跟着没了').toBe(false)
    query.p = '2025-04'
    await w.setProps({ on: true }); await flushPromises()
    expect(cpMeterApi.readings, '没有草稿可护 → 期照换').toHaveBeenCalledWith(2025, 4)
  })
})
```

`elecCostFlow.spec.ts`：第 3 行 `import { nextTick } from 'vue'` 改为 `import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'`；第 46 行（locks mock 的 `}))` 之后）插入同款桩（前缀 `'/elec-cost?'`）；`beforeEach` 加 query 清理；`open()` 之后加与 meterPeriodFlow 逐字相同的 `keptAlive()`（`h(ElecCostView)`）；文件末尾追加：

```ts
describe('电费成本总览 · 期间深链(SIDEBAR-UX-REDESIGN §4.2)', () => {
  it('❗带 p 进屏直落那个月:矩阵不出现,费项只拉一次、拉的就是那个月', async () => {
    // 红线:ElecCostView.vue 的 useDeepPeriod 删掉 → 落回矩阵;挪到 onMounted 之后 → entries 拉两次
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.fmg').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.ec-page').exists()).toBe(true)
    expect(elecCostApi.entries).toHaveBeenCalledWith(2025, 3)
    expect(elecCostApi.entries).toHaveBeenCalledTimes(1)
  })

  it('❗切页签回来要重拉电表、账期清单与本月 —— 本屏此前没有 onReactivated(spec §12)', async () => {
    // 红线:ElecCostView.vue 新加的 onReactivated 三支删掉 → 切回零请求
    query.p = '2025-03'
    const { w, alive } = await keptAlive()
    vi.mocked(elecCostApi.meters).mockClear()
    vi.mocked(elecCostApi.months).mockClear()
    vi.mocked(elecCostApi.entries).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(elecCostApi.meters).toHaveBeenCalledTimes(1)
    expect(elecCostApi.months).toHaveBeenCalledTimes(1)
    expect(elecCostApi.entries).toHaveBeenCalledWith(2025, 3)
    expect(w.find('.ec-page').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: 跑三份 spec 确认红**

Run: `cd frontend && npx vitest run src/views/__tests__/meterPeriodFlow.spec.ts src/views/__tests__/cpMeterFlow.spec.ts src/views/__tests__/elecCostFlow.spec.ts`
Expected: 既有用例仍绿（桩补上了）；新 9 条红（矩阵出现 / 无 toast / 切回零请求）。

- [ ] **Step 3: 三屏接线**

`PvMeterView.vue`：第 9 行 `import { ref, computed, onMounted, onDeactivated, watch } from 'vue'` 之后加
```ts
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
```
第 88 行 `const month = computed(() => gm.value ?? 0)` 之后插入：
```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月 —— 只 pick 进 screenPeriod,取数交给下面的 onMounted / watch(gateYm)。
// 必须在 onMounted / watch(gateYm) / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于重读改期。
// 只有年的链接不动(本屏只认整月)。不传 dirty、也不接 note:抽屉里的行草稿在切走时随抽屉一起收掉
// (onDeactivated 清 openSt → watch(openSt, cancelForm)),切回时没有草稿可护。
useDeepPeriod({
  current: () => ({ p: gateYm.value }),
  apply: (t) => { if (t.month != null) pickCell(t.year, t.month) },
})
```
第 183-187 行 `onMounted(() => { … })` 块之后、`watch(gateYm, …)` 之前插入：
```ts
// KeepAlive 切回重读(spec §12;照 CpMeterView 的三支):导入中心导完切回来,矩阵与本月不能还是导入前的
onReactivated(() => {
  loadStations()
  loadMonths()
  if (picked.value) loadReadings()
})
```
（模板不动：没有 dirty 就不会有提示。）

`CpMeterView.vue`：第 17 行 `import FPLockDialogs …` 之后加 `import { useDeepPeriod } from '@/composables/useDeepPeriod'`（`onReactivated` 第 32 行已有，三支重读也已有，不再加）。第 91 行 `const month = computed(() => gm.value ?? 0)` 之后插入与 PvMeterView 逐字相同的 useDeepPeriod 块。模板不动。

`ElecCostView.vue`：第 9 行 `import { ref, computed, onMounted, onDeactivated, watch } from 'vue'` 之后加 `onReactivated` / `useDeepPeriod` 两个 import（本屏不传 dirty，不接 note、不加 FPToast）。第 85 行 `const acctMonth = computed(...)` 之后插入：
```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月 —— 只 pick 进 screenPeriod,取数交给下面的 onMounted / watch(gateYm)。
// 必须在 onMounted / watch(gateYm) / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于重读改期。
// 只有年的链接不动(本屏只认整月)。本屏没有草稿(金额 / 备注 / 电价全是即时乐观提交),不传 dirty、也不接 note。
// 本屏按月锁(S.elecCost(year, month)):编辑态里被深链换月 = 换 scope,useEditMode 的 scopeWhileEditing 守卫接手,与屏内换月同一条路。
useDeepPeriod({
  current: () => ({ p: gateYm.value }),
  apply: (t) => { if (t.month != null) pickCell(t.year, t.month) },
})
```
第 173-177 行 `onMounted(() => { … })` 之后、`watch(gateYm, …)` 之前插入：
```ts
// KeepAlive 切回重读(spec §12;照 CpMeterView 的三支):导入中心导完切回来,矩阵与本月不能还是导入前的
onReactivated(() => {
  loadMeters()
  loadMonths()
  if (picked.value) loadMonth()
})
```
（模板不动。）

- [ ] **Step 4: 跑绿 + 门禁 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/__tests__/meterPeriodFlow.spec.ts src/views/__tests__/cpMeterFlow.spec.ts src/views/__tests__/elecCostFlow.spec.ts src/views/__tests__/meterPeriodGate.spec.ts src/views/__tests__/lockDialogsCoverage.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿。（`twoBooksRail.spec` 此刻会红：PvView 挂 PvMeterView 而它接了 useRoute、该 spec 还没桩 —— 那是 Task 3 补的，本任务不跑它。）破坏验证逐条：① 删 PvMeterView 的 useDeepPeriod 整段 → 用例 1 / 4 / 5 红；② 把它挪到 `watch(gateYm)` 之后 → 用例 1「只拉一次」红、用例 4「不按旧月拉」红；③ 删 PvMeterView / ElecCostView 新加的 onReactivated → 用例 3 / Elec 用例 2 红；④ 删 PvMeterView / CpMeterView 的 onDeactivated 里 `openSt.value = null` 那一句 → 用例 5 / Cp 用例 2「草稿已收」红。每条改坏后**字符串替换还原**，报告里逐条写红了哪条。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/pv/PvMeterView.vue frontend/src/views/charging/CpMeterView.vue frontend/src/views/elec/ElecCostView.vue frontend/src/views/__tests__/meterPeriodFlow.spec.ts frontend/src/views/__tests__/cpMeterFlow.spec.ts frontend/src/views/__tests__/elecCostFlow.spec.ts
git commit -m "feat(deeplink): 运营账三屏接 useDeepPeriod(pick 进 screenPeriod);分栋抄表 / 电费成本补切回重读"
```

---
### Task 2: 附表12 工资明细

**Files:**
- Modify: `frontend/src/views/salary/SalaryView.vue:20, 116-118`
- Modify: `frontend/src/views/__tests__/salaryMonthGate.spec.ts:2, 32, 47, 55`
- Modify: `frontend/src/views/__tests__/salaryGuards.spec.ts:58`

**Interfaces:**
- Consumes: `useDeepPeriod`；`useSchedScreen` 解构出的 `year`；屏内 `month` ref、`pickCell(y, m)`（函数声明，已提升）、`loadMonth(y)`、`reloadOverview()`。
- Produces: 带 `?p=YYYY-MM` 进屏直落该月宽表；切回重读总览 + 本月。

- [ ] **Step 1: 补桩 + 写用例（先红）**

`salaryGuards.spec.ts`：第 58 行（locks mock 的 `}))` 之后）插入最简桩（本文件不测深链，只要屏能挂起来）：
```ts
// 屏接了 useDeepPeriod(内部 useRoute):补桩,断言不动(照 chainPeriodFlow.spec:37)
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, fullPath: '/salary' }) }))
```

`salaryMonthGate.spec.ts`：第 2 行 `import { mount, flushPromises } from '@vue/test-utils'` 之后加 `import { defineComponent, h, KeepAlive, ref } from 'vue'`。第 32 行（salary mock 的 `}))` 之后）插入可变 query 桩：

```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):屏接了 useDeepPeriod(内部 useRoute)。query 可变 —— 深链那几条要在切回之间换掉 ?p=;
// fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)。
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/salary?' + new URLSearchParams(query).toString() } }),
}))
```

`beforeEach` 里 `localStorage.clear()` 之后加 `for (const k of Object.keys(query)) delete query[k]`。`open()` 之后加：

```ts
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(SalaryView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}
```

文件末尾追加：

```ts
describe('附表12 · 期间深链(SIDEBAR-UX-REDESIGN §4.2)', () => {
  it('❗带 p 进屏直落那个月的宽表:矩阵不出现,拉的就是那个月且只拉一次', async () => {
    // 红线:SalaryView.vue 的 useDeepPeriod({ apply: … pickCell }) 删掉 → 落回矩阵
    query.p = '2025-03'
    const w = await open()
    expect(w.findAll('.bmm-card').length, '矩阵该被深链跳过').toBe(0)
    expect(w.find('.s12-page').exists()).toBe(true)
    expect(salaryApi.records).toHaveBeenCalledWith(2025, 3)
    expect(salaryApi.records).toHaveBeenCalledTimes(1)
  })

  it('只有年的链接不动 —— 本屏只认整月', async () => {
    query.p = '2025'
    const w = await open()
    expect(w.findAll('.bmm-card').length).toBe(24)
    expect(salaryApi.records).not.toHaveBeenCalled()
  })

  it('❗切页签回来重读:总览与本月都重拉 —— 导入中心导完切回来不能还是旧表(spec §12)', async () => {
    // 红线:SalaryView.vue 新加的 onReactivated 删掉 → 切回零请求
    query.p = '2025-03'
    const { alive } = await keptAlive()
    vi.mocked(salaryApi.overview).mockClear()
    vi.mocked(salaryApi.records).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(salaryApi.overview).toHaveBeenCalledTimes(1)
    expect(salaryApi.records).toHaveBeenCalledWith(2025, 3)
  })
})
```

（不写「抽屉开着时切回不切期」用例：SalaryView.vue:124 的 onDeactivated 切走即关抽屉 / 导入窗，切回时没有草稿可护，dirty 探针恒为 0 —— 计划复查 P0B-2，本屏不传 dirty。）

- [ ] **Step 2: 确认红**

Run: `cd frontend && npx vitest run src/views/__tests__/salaryMonthGate.spec.ts src/views/__tests__/salaryGuards.spec.ts`
Expected: 既有 11 + 17 条绿；新 3 条红。

- [ ] **Step 3: 接线**

`SalaryView.vue` 第 20 行 `import { ref, computed, onMounted, onDeactivated, watch } from 'vue'` 之后加：
```ts
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { periodOf } from '@/nav/deepLink'
```
第 117 行注释 `// ── 进入屏:overview(§6 取数前不渲染) ──` 之前插入：
```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月宽表(pickCell 置月 + pickYear 取数,顺序已对);只有年的链接不动(本屏只认整月)。
// 必须在下面的 onMounted / onReactivated 之前调用:期先落定;切回时也先于重读改期。
// 不传 dirty、也不接 note:本屏所有写都即时落库,唯一的浮层(新增抽屉 / 导入窗)在下面的 onDeactivated 里切走即关 —— 切回时没有草稿可护。
useDeepPeriod({
  current: () => ({ p: year.value == null || month.value == null ? null : periodOf(year.value, month.value) }),
  apply: (t) => { if (t.month != null) void pickCell(t.year, t.month) },
})
// KeepAlive 切回重读(spec §12):导入中心导完切回来,矩阵与本月不能还是导入前的(loadMonth 自带竞态守卫与 try/catch)
onReactivated(() => {
  void reloadOverview()
  if (year.value != null && month.value != null) void loadMonth(year.value)
})
```
（模板不加 FPToast：没有 dirty 就不会有提示，与 P0a 的 LossLedgerView / PoolLedgerView 同口径。）

- [ ] **Step 4: 跑绿 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/__tests__/salaryMonthGate.spec.ts src/views/__tests__/salaryGuards.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts src/views/__tests__/twoBooksRail.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿（twoBooksRail 若仍红是 Task 1 留给 Task 3 的桩，与本任务无关，报告里注明）。破坏验证：① 删 useDeepPeriod 段 → 用例 1 红；② 删 onReactivated → 用例 3 红。字符串替换还原。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/salary/SalaryView.vue frontend/src/views/__tests__/salaryMonthGate.spec.ts frontend/src/views/__tests__/salaryGuards.spec.ts
git commit -m "feat(deeplink): 附表12 接 useDeepPeriod(pickCell)+ 切回重读"
```

---
### Task 3: 年表四屏（附6 光伏 / 附7·8 充电桩 / 附11 电费 / 附13·14 水电）

**Files:**
- Modify: `frontend/src/views/pv/PvView.vue:7, 41, 70-72, 239`
- Modify: `frontend/src/views/charging/ChargingView.vue:8, 58, 89-91, 266`
- Modify: `frontend/src/views/elec/ElecView.vue:7, 41, 77-79, 256`
- Modify: `frontend/src/views/utilities/UtilitiesView.vue:7, 40, 72-74, 252`
- Modify: `frontend/src/views/__tests__/twoBooksRail.spec.ts:3, 39, 47, 57`
- Create: `frontend/src/views/__tests__/schedDeepLink.spec.ts`

**Interfaces:**
- Consumes: `useDeepPeriod`；`useSchedScreen` 解构出的 `year` / `pickYear` / `refresh` / `drawer` / `importing`；`loadViewMode`。
- Produces: 四屏带 `?p=YYYY` 进屏直落该年年表；`?mode=` / `?tab=` 首载生效；切回 `refresh()`。

- [ ] **Step 1: twoBooksRail 补桩 + 写 PvView 用例；新建 schedDeepLink.spec（先红）**

`twoBooksRail.spec.ts`：第 3 行 `import { setActivePinia, createPinia } from 'pinia'` 之后加 `import { defineComponent, h, KeepAlive, ref } from 'vue'`。第 39 行（pvMeter mock 的 `}))` 之后）插入可变 query 桩：

```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):PvView 与子屏 PvMeterView 都接了 useDeepPeriod(内部 useRoute)。query 可变 —— 深链那几条要在切回之间换掉 ?p=;
// fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)。
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/pv-income?' + new URLSearchParams(query).toString() } }),
}))
```

`beforeEach` 里 `localStorage.clear()` 之后加 `for (const k of Object.keys(query)) delete query[k]`。`open()` 之后加：

```ts
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(照 meterWriteGuards.spec:299)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(PvView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}
```

文件末尾追加：

```ts
describe('光伏 · 期间深链(SIDEBAR-UX-REDESIGN §4.2 年表屏 p 只取年 / §5.1 extra.mode)', () => {
  // 年表 DTO 的形状不是这里要钉的:records 让它在途,屏落在转圈分支,断言只看门与请求
  const pending = () => vi.mocked(pvApi.records).mockReturnValue(new Promise(() => {}) as never)

  it('❗带 p=2025 进屏直落该年:年份门不出现,拉的就是那一年且只拉一次', async () => {
    // 红线:PvView.vue 的 useDeepPeriod 删掉 → 门出现;current 用 periodOf(year, month) → 切回每次白拉
    query.p = '2025'
    pending()
    const w = await open()
    expect(w.find('.sm-gate').exists(), '门该被深链跳过').toBe(false)
    expect(pvApi.records).toHaveBeenCalledWith(2025)
    expect(pvApi.records).toHaveBeenCalledTimes(1)
  })

  it('❗?mode=summary 盖过本机记住的运营账,且不写回本机', async () => {
    // 红线:mode 初值不看 route.query.mode → 落到运营账;deepMode 经 saveViewMode 写回 → 记忆被一条链接改掉
    localStorage.setItem('fp-view-mode:pv-income', 'meter')
    query.p = '2025'; query.mode = 'summary'
    pending()
    const w = await open()
    expect(w.findAll('.br-item')[0].classes(), '落在报送台账').toContain('on')
    expect(localStorage.getItem('fp-view-mode:pv-income'), '深链不改记忆').toBe('meter')
  })

  it('运营账那本开着时,年份深链不拉年表(它在 v-else 底下看不见);带月的 p 由子屏自己认', async () => {
    // 红线:apply 里的 mode === 'summary' 门删掉 → 看不见的年表白拉一趟
    localStorage.setItem('fp-view-mode:pv-income', 'meter')
    query.p = '2025-03'
    const w = await open()
    expect(w.findAll('.br-item')[1].classes()).toContain('on')
    expect(pvApi.records).not.toHaveBeenCalled()
    expect(pvMeterApi.readings, '子屏 PvMeterView 的深链照常').toHaveBeenCalledWith(2025, 3)
  })

  it('❗切页签回来重读年表与总览(spec §12)', async () => {
    // 红线:PvView.vue 新加的 onReactivated(refresh) 删掉 → 切回零请求
    query.p = '2025'
    // 这条不能用 pending():refresh 先 await load(year) 再 reloadOverview,records 不兑现 overview 永远到不了(计划复查 P0B-1)
    vi.mocked(pvApi.records).mockResolvedValue(null as never)
    const { alive } = await keptAlive()
    vi.mocked(pvApi.records).mockClear()
    vi.mocked(pvApi.overview).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(pvApi.records).toHaveBeenCalledWith(2025)
    expect(pvApi.overview).toHaveBeenCalledTimes(1)
  })

  it('❗新增抽屉开着时切回、地址栏换了年 → 不切年,deepNote 说清楚', async () => {
    // 红线:dirty 探针改成 () => 0 → 年被切到 2026,pickYear 顺手 edit=false 把抽屉关了
    query.p = '2025'
    pending()
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(PvView).vm as unknown as { drawer: boolean; year: number | null }
    vm.drawer = true
    await flushPromises()
    alive.value = false; await flushPromises()
    query.p = '2026'
    alive.value = true; await flushPromises()
    expect(pvApi.records).not.toHaveBeenCalledWith(2026)
    expect(vm.year).toBe(2025)
    expect(vm.drawer).toBe(true)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2026 期，本期有 1 处未保存')
  })

  it('❗current 只报年:切回时地址栏多了别的键、期没变 → 只有重读那一趟,深链不再 apply', async () => {
    // 红线:current 改成 periodOf(year.value, 1) → want '2025' 永不等于 '2025-01' → 地址栏一变键就多 apply 一次(pickYear 又拉一趟年表),records 两趟
    query.p = '2025'
    vi.mocked(pvApi.records).mockResolvedValue(null as never)
    const { alive } = await keptAlive()
    vi.mocked(pvApi.records).mockClear()
    alive.value = false; await flushPromises()
    query.mode = 'summary'   // 去重键变了,期没变
    alive.value = true; await flushPromises()
    expect(pvApi.records, '只有 refresh 那一趟').toHaveBeenCalledTimes(1)
  })
})
```

新建 `frontend/src/views/__tests__/schedDeepLink.spec.ts`：

```ts
// src/views/__tests__/schedDeepLink.spec.ts — 年表屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2「年表屏 p 只取年」/ §5.1 extra.tab · extra.mode)。
// 附6 的挂载测在 twoBooksRail.spec;这里钉另三屏各自的那一处差异:附13/14 的 tab、附表8 的 route.meta、附表11 的第二本叫 cost。
// 年表 DTO 的形状不是这里要钉的:records 一律在途(屏落在转圈分支),断言只看门与请求。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const query: Record<string, string> = {}
const meta: Record<string, unknown> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, meta, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/utilities', () => ({ utilitiesApi: { overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn(), overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/elec', () => ({ elecApi: { phases: vi.fn(), overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))

import UtilitiesView from '@/views/utilities/UtilitiesView.vue'
import ChargingView from '@/views/charging/ChargingView.vue'
import ElecView from '@/views/elec/ElecView.vue'
import { utilitiesApi } from '@/api/utilities'
import { chargingApi } from '@/api/charging'
import { elecApi } from '@/api/elec'

const NEVER = () => new Promise(() => {}) as never

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  for (const k of Object.keys(meta)) delete meta[k]
  vi.mocked(utilitiesApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(utilitiesApi.records).mockReturnValue(NEVER())
  vi.mocked(chargingApi.cats).mockResolvedValue([] as never)
  vi.mocked(chargingApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(chargingApi.records).mockReturnValue(NEVER())
  vi.mocked(elecApi.phases).mockResolvedValue([] as never)
  vi.mocked(elecApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(elecApi.records).mockReturnValue(NEVER())
})

async function open(C: typeof UtilitiesView | typeof ChargingView | typeof ElecView) {
  const w = mount(C, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

describe('年表屏 · 期间深链', () => {
  it('❗附13/14:?tab=phase3 先落子表再落年 —— records 只拉一次,拉的是附表14', async () => {
    // 红线:UtilitiesView.vue 的 tab 初值不读 route.query.tab → 拉的是 (13, 2025);
    //      tab 改在 apply 里 pickYear 之后才置 → 先拉 (13, 2025) 再补 (14, 2025),两趟
    query.p = '2025'; query.tab = 'phase3'
    const w = await open(UtilitiesView)
    expect(w.find('.sm-gate').exists(), '门该被深链跳过').toBe(false)
    expect(utilitiesApi.records).toHaveBeenCalledWith(14, 2025)
    expect(utilitiesApi.records).toHaveBeenCalledTimes(1)
  })

  it('附13/14:tab 认不出退回办公水电', async () => {
    query.p = '2025'; query.tab = 'nonsense'
    await open(UtilitiesView)
    expect(utilitiesApi.records).toHaveBeenCalledWith(13, 2025)
  })

  it('❗附表8:带 p 进屏直落该年 —— schedule no 仍从 route.meta 来', async () => {
    // 红线:ChargingView.vue 的 useDeepPeriod 删掉 → 门出现
    meta.kind = 'schedule8'
    query.p = '2025'
    const w = await open(ChargingView)
    expect(w.find('.sm-gate').exists()).toBe(false)
    expect(chargingApi.records).toHaveBeenCalledWith(8, 2025)
    expect(chargingApi.records).toHaveBeenCalledTimes(1)
  })

  it('❗附表11:?mode=summary 盖过本机记住的园区电费模型(第二本 id 是 cost 不是 meter)', async () => {
    // 红线:ElecView.vue 的 mode 初值不读 route.query.mode → 落到园区电费模型,年表不拉
    localStorage.setItem('fp-view-mode:elec-cost', 'cost')
    query.p = '2025'; query.mode = 'summary'
    const w = await open(ElecView)
    expect(w.findAll('.br-item')[0].classes()).toContain('on')
    expect(elecApi.records).toHaveBeenCalledWith(2025, 'energy')
    expect(elecApi.records).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('fp-view-mode:elec-cost'), '深链不改记忆').toBe('cost')
  })
})
```

- [ ] **Step 2: 确认红**

Run: `cd frontend && npx vitest run src/views/__tests__/twoBooksRail.spec.ts src/views/__tests__/schedDeepLink.spec.ts`
Expected: twoBooksRail 既有 8 条挂载测转绿（桩补上了）、新 6 条红；schedDeepLink 4 条红。

- [ ] **Step 3: 四屏接线**

`PvView.vue`：第 7 行 `import { ref, computed, onMounted , watch} from 'vue'` 之后加：
```ts
import { useRoute } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { periodOf } from '@/nav/deepLink'
import FPToast from '@/components/fp/FPToast.vue'
```
第 41 行 `const mode = ref<Mode>(loadViewMode(MODE_SCREEN, MODES.map(m => m.id), 'summary'))` 替换为：
```ts
// 深链 ?mode=summary|meter 只在首载认(首页附表行走 openFresh,实例总是新的;SIDEBAR-UX-REDESIGN §5.1):
// 盖过本机记住的那本,但不写回 —— 下面的 watch(mode) 非 immediate,只记用户自己的切换。
const route = useRoute()
const deepMode = MODES.find(m => m.id === route.query.mode)?.id ?? null
const mode = ref<Mode>(deepMode ?? loadViewMode(MODE_SCREEN, MODES.map(m => m.id), 'summary'))
```
第 70 行 `})`（useSchedScreen 解构结束）之后、第 72 行 `// ⚠ 切账本必须退出编辑态` 之前插入：
```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):年表屏 p 只取年(current 也只报年,否则首页发 YYYY-MM 时永不相等、每次切回白拉一趟)。
// 运营账那本开着时不拉年表 —— 它在 v-else 底下看不见;带月的 p 由子屏 PvMeterView 自己认。
// 必须在下面的 onMounted / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于重读改期。
// 本屏唯一的草稿是开着的新增抽屉 / 导入窗(pickYear 会经 edit=false 把它们关掉);切回时有 → 不切年,只在 deepNote 里说。
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: year.value == null ? null : periodOf(year.value, null) }),
  apply: (t) => { if (mode.value === 'summary') void pickYear(t.year).catch(() => {}) },
  dirty: () => (drawer.value || importing.value ? 1 : 0),
})
// KeepAlive 切回重读(spec §12):导入中心导完切回来,年表与总览不能还是导入前的(refresh = load(year) + reloadOverview)
onReactivated(() => { void refresh().catch(() => {}) })
```
第 239 行 `<ImportResultToast v-if="importResult" … />` 之后加一行 `    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />`。

`ChargingView.vue`（`route` 第 32 行已有，`useRoute` 已 import）：第 8 行之后加 `onReactivated` / `useDeepPeriod` / `periodOf` / `FPToast` 四个 import（同上，不含 useRoute）。第 58 行替换为：
```ts
// 深链 ?mode=summary|meter 只在首载认(首页附表行走 openFresh,实例总是新的;SIDEBAR-UX-REDESIGN §5.1):
// 盖过本机记住的那本,但不写回 —— 下面的 watch(mode) 非 immediate,只记用户自己的切换。
const deepMode = MODES.find(m => m.id === route.query.mode)?.id ?? null
const mode = ref<Mode>(deepMode ?? loadViewMode(MODE_SCREEN, MODES.map(m => m.id), 'summary'))
```
第 89 行 `})` 之后、第 91 行 `// ⚠ 切账本必须退出编辑态` 之前插入与 PvView 逐字相同的 useDeepPeriod + onReactivated 块（注释里「PvMeterView」改「CpMeterView」）。第 266 行 `<ImportResultToast … />` 之后加 FPToast 行。

`ElecView.vue`：第 7 行之后加五个 import（含 `useRoute`）。第 41 行替换为与 PvView 同款（含 `const route = useRoute()`）。第 77 行 `})` 之后、第 79 行 `// ⚠ 切账本必须退出编辑态` 之前插入同款块（注释里「运营账那本」改「园区电费模型那本(cost)」，「PvMeterView」改「ElecCostView」）。第 256 行 `<ImportResultToast … />` 之后加 FPToast 行。

`UtilitiesView.vue`：第 7 行 `import { ref, computed, onMounted } from 'vue'` 之后加五个 import（含 `useRoute`）。第 40 行 `const tab = ref<Tab>('office')` 替换为：
```ts
// 深链 ?tab=office|phase3 只在首载认(首页附13 / 附14 两行都指本屏,走 openFresh,实例总是新的;SIDEBAR-UX-REDESIGN §5.1)。
// 必须在 year 落定之前定下 —— loadYear 读的是 no(由 tab 派生),先落年再切 tab 会多拉一趟办公水电。
const route = useRoute()
const deepTab = (): Tab | null => {
  const t = route.query.tab
  return t === 'office' || t === 'phase3' ? t : null
}
const tab = ref<Tab>(deepTab() ?? 'office')
```
第 72 行 `})`（useSchedScreen 解构结束）之后、第 74 行 `// ⓪ overview.years → YearCard` 之前插入：
```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):年表屏 p 只取年(current 也只报年,否则首页发 YYYY-MM 时永不相等、每次切回白拉一趟)。
// 必须在下面的 onMounted / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于重读改期。
// 本屏唯一的草稿是开着的新增抽屉 / 导入窗(pickYear 会经 edit=false 把它们关掉);切回时有 → 不切年,只在 deepNote 里说。
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: year.value == null ? null : periodOf(year.value, null) }),
  apply: (t) => { void pickYear(t.year).catch(() => {}) },
  dirty: () => (drawer.value || importing.value ? 1 : 0),
})
// KeepAlive 切回重读(spec §12):导入中心导完切回来,年表与总览不能还是导入前的(refresh = load(year) + reloadOverview)
onReactivated(() => { void refresh().catch(() => {}) })
```
第 252 行 `<ImportResultToast … />` 之后加 FPToast 行。

- [ ] **Step 4: 跑绿 + 门禁 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/__tests__/twoBooksRail.spec.ts src/views/__tests__/schedDeepLink.spec.ts src/components/fp/bookRail.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts src/composables/__tests__/useSchedScreen.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿（含 twoBooksRail 的 `mode = ref<Mode>` 与键字面量门禁）。破坏验证：① 删 PvView 的 useDeepPeriod 段 → 用例 1 / 5 红；② PvView `current` 改 `periodOf(year.value, 1)` → 用例 6 红（切回多 apply 一次，records 两趟）；③ 删 `mode === 'summary'` 门 → 用例 3 红；④ mode 初值去掉 `deepMode ??` → 用例 2 与 schedDeepLink 用例 4 红；⑤ UtilitiesView tab 初值改回 `'office'` → schedDeepLink 用例 1 红；⑥ 删四屏任一 onReactivated → 用例 4 红（PvView）；⑦ dirty 改 `() => 0` → 用例 5 红。字符串替换还原。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/pv/PvView.vue frontend/src/views/charging/ChargingView.vue frontend/src/views/elec/ElecView.vue frontend/src/views/utilities/UtilitiesView.vue frontend/src/views/__tests__/twoBooksRail.spec.ts frontend/src/views/__tests__/schedDeepLink.spec.ts
git commit -m "feat(deeplink): 年表四屏接 useDeepPeriod(p 只取年)+ mode / tab 首载认 + 切回 refresh"
```

---
### Task 4: 附表10 销售收入（期区直写 activeBookId，不撞 goGate）

**Files:**
- Modify: `frontend/src/views/sales-income/S10View.vue:8-13, 216-234, 720`
- Create: `frontend/src/views/__tests__/s10DeepLink.spec.ts`

**Interfaces:**
- Consumes: `useDeepPeriod`；`type DeepPeriod` / `periodOf`（`@/nav/deepLink`）；屏内 `books` / `activeBookId` / `phase` / `month` / `dirty`、`pickCell(y, m)`（函数声明，已提升）、`loadMonth(y)` / `reloadOverview()`。
- Produces: `?p=YYYY-MM&co=<期区>` 直落该期区该月表格态；旧 `?y&m&phase&tenant` 照认；切回重读；`ensureLoaded()`（overview + books 只拉一次）。

- [ ] **Step 1: 写 s10DeepLink.spec（先红）**

新建 `frontend/src/views/__tests__/s10DeepLink.spec.ts`（夹具照 `archivedCols.spec.ts:83-105` 的附表10 段，多加一册三期）：

```ts
// src/views/__tests__/s10DeepLink.spec.ts — 附表10 消费期间深链(SIDEBAR-UX-REDESIGN §4.2「附10 co = 期区 1..4」/ §9 P0b 破坏验证「chip 深链不撞 goGate」)。
// 期区直写 activeBookId,不经 selectBook —— 它在表格态末行 goGate 把人推回矩阵;三个 ref 同一拍连写,templateAt 只跑一次。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { Book, BookDef } from '@/types/book'
import type { S10MonthDTO, S10RecordDTO, S10OverviewDTO } from '@/types/s10'

const s10Def: BookDef = {
  groups: [{ id: 'g1', label: '租金', cols: [
    { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: null },
  ] }],
}
const book1: Book = { id: 7, screen: 's10', companyId: null, phase: 1, name: '一期', ver: 3, latestVer: 3, definition: s10Def }
const book3: Book = { ...book1, id: 9, phase: 3, name: '三期' }
const row = {
  id: 11, tenantId: 11, tenantName: '甲户', phase: 1, profile: 'factory', note: null,
  source: 'manual', total: 0, extraFees: {},
} as unknown as S10RecordDTO
const monthOf = (phase: number, year: number, month: number): S10MonthDTO => ({
  phase, year, month, recorded: true, rows: [{ ...row, phase }], columnTotals: {}, grandTotal: 0, archivedCols: [],
})
const overview: S10OverviewDTO = {
  years: [2026], currentYear: 2026, currentMonth: 9,
  summaries: [{ year: 2026, recordedMonths: 9, tenantCount: 1 }],
}

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/sales-income?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/s10', () => ({
  s10Api: {
    getOverview: vi.fn(), getMonth: vi.fn(),
    batchDelete: () => Promise.resolve({ deleted: 0 }),
    clearImported: () => Promise.resolve({ deleted: 0 }),
  },
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn(), templateAt: vi.fn() } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import S10View from '@/views/sales-income/S10View.vue'
import S10Table from '@/views/sales-income/S10Table.vue'
import { s10Api } from '@/api/s10'
import { booksApi } from '@/api/books'

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  // ?tenant= 命中行会 scrollIntoView,jsdom 没实现(既有两份 spec 的 tenant 都是空串,没踩到)
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(s10Api.getOverview).mockResolvedValue(overview)
  vi.mocked(s10Api.getMonth).mockImplementation((p: number, y: number, m: number) => Promise.resolve(monthOf(p, y, m)))
  vi.mocked(booksApi.list).mockResolvedValue([book1, book3])
  vi.mocked(booksApi.templateAt).mockImplementation((id: number) => Promise.resolve(id === 9 ? book3 : book1))
})

async function open() {
  const w = mount(S10View, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(S10View) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}
interface Vm { dirty: Set<number>; monthData: S10MonthDTO | null; onCell: (r: S10RecordDTO, c: string, v: number) => void; focusTenant: string; year: number | null }

describe('附表10 · 期间深链', () => {
  it('❗co=3 直落三期账册该月:矩阵不出现、月表只拉一次且是 (3, 2026, 9)、模板只取一次 —— 不撞 selectBook → goGate', async () => {
    // 红线①:applyDeep 写成「先 pickCell 再 selectBook(b.id)」→ selectBook 末行 goGate 把 year 打回 null,.s10-gate 出现;
    // 红线②:册 / 月 / 年分两拍写(中间 await)→ templateAt 跑两次;
    // 红线③:useDeepPeriod 整段删掉 → 落回矩阵
    query.p = '2026-09'; query.co = '3'
    const w = await open()
    expect(w.find('.s10-gate').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.s10-page').exists()).toBe(true)
    expect(w.find('.s10-period-book').text()).toContain('三期')
    expect(s10Api.getMonth).toHaveBeenCalledWith(3, 2026, 9)
    expect(s10Api.getMonth).toHaveBeenCalledTimes(1)
    expect(booksApi.templateAt).toHaveBeenCalledWith(9, 2026, 9)
    expect(booksApi.templateAt, '册 / 月 / 年同一拍连写,watch 只跑一次').toHaveBeenCalledTimes(1)
    expect(s10Api.getOverview, 'overview 只拉一次(onMounted 与 apply 共用 ensureLoaded)').toHaveBeenCalledTimes(1)
    expect(booksApi.list).toHaveBeenCalledTimes(1)
  })

  it('旧链 ?y&m&phase=3&tenant= 照认(收入核对「去改附表10」/ 分析层本期不改发链侧)', async () => {
    query.y = '2026'; query.m = '9'; query.phase = '3'; query.tenant = '甲户'
    const w = await open()
    expect(s10Api.getMonth).toHaveBeenCalledWith(3, 2026, 9)
    // focusTenant 是一次性的:表渲染完就 emit focusDone、父层随即清空,所以钉「送到表里了」而不是钉父层的 ref(计划复查 P0B-2)
    expect(w.findComponent(S10Table).emitted('focusDone'), '旧链的 ?tenant= 送到表里了').toBeTruthy()
  })

  it('只有年的链接不动 —— 本屏只认整月', async () => {
    query.p = '2026'
    const w = await open()
    expect(w.find('.s10-gate').exists()).toBe(true)
    expect(s10Api.getMonth).not.toHaveBeenCalled()
  })

  it('❗切页签回来重读:总览与本月都重拉(spec §12)', async () => {
    // 红线:S10View.vue 新加的 onReactivated 删掉 → 切回零请求
    query.p = '2026-09'; query.co = '3'
    const { alive } = await keptAlive()
    vi.mocked(s10Api.getOverview).mockClear()
    vi.mocked(s10Api.getMonth).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(s10Api.getOverview).toHaveBeenCalledTimes(1)
    expect(s10Api.getMonth).toHaveBeenCalledWith(3, 2026, 9)
  })

  it('❗有未保存改动时切回、地址栏换了月 → 期不动、草稿不被冲掉(重读也不拉本月),deepNote 说清楚', async () => {
    // 红线①:dirty 探针改成 () => 0 → 期被切到 2026-10,loadMonth 顺手 dirty.clear();
    // 红线②:onReactivated 里的 dirty.size === 0 门删掉 → 重读 loadMonth 把草稿冲掉
    query.p = '2026-09'; query.co = '3'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(S10View).vm as unknown as Vm
    vm.onCell(vm.monthData!.rows[0], 'factoryRent', 5)
    await flushPromises()
    expect(vm.dirty.size, '前提:真的算脏了').toBe(1)
    vi.mocked(s10Api.getMonth).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2026-10'
    alive.value = true; await flushPromises()
    expect(s10Api.getMonth, '有草稿 → 不切期、不重读本月').not.toHaveBeenCalled()
    expect(vm.dirty.size).toBe(1)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2026-10 期，本期有 1 处未保存')
  })
})
```

- [ ] **Step 2: 确认红**

Run: `cd frontend && npx vitest run src/views/__tests__/s10DeepLink.spec.ts`
Expected: 用例 1 / 4 / 5 红（旧路径不认 `co`、无重读、无 toast）；用例 2 / 3 可能已绿（旧路径本来就认 y&m&phase）—— 红阶段报告里写清哪几条红。

- [ ] **Step 3: 接线**

`S10View.vue` 第 8 行 `import { ref, computed, watch, nextTick, onMounted, onDeactivated, reactive } from 'vue'` 之后加 `import { onReactivated } from '@/composables/onReactivated'`、`import { useDeepPeriod } from '@/composables/useDeepPeriod'`、`import { periodOf, type DeepPeriod } from '@/nav/deepLink'`、`import FPToast from '@/components/fp/FPToast.vue'`；**删掉**第 13 行 `import { parseS10DeepLink } from '@/utils/deepLink'`。

第 216-234 行（从注释 `// ── 进入屏:overview + 四册并取…` 到 `onMounted(async () => { … focusTenant.value = dl.tenant\n})` 整段）替换为：

```ts
// ── 进入屏:overview + 四册并取(§6 取数前不渲染)。深链(期间深链协议 §4.2 + 收入核对 / 分析层旧链)直落表格态并定位租户行 ──
const route = useRoute()
const focusTenant = ref('')   // 一次性:S10Table 定位完成后清空
// overview / books 只拉一次:onMounted 与深链 apply 谁先到谁发起,后到的等同一个 Promise
let loaded: Promise<void> | null = null
function ensureLoaded() {
  if (!loaded) loaded = (async () => {
    const [ov, bs] = await Promise.all([s10Api.getOverview(), booksApi.list('s10')])
    overview.value = ov
    books.value = bs
    month.value = ov.currentMonth || 1
    activeBookId.value = bs.find(b => b.phase === 1)?.id ?? bs[0]?.id ?? null
  })()
  return loaded
}
onMounted(() => { void ensureLoaded() })
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM&co=<期区 1..4> 直落该期区该月的表格态;只有年的链接不动(本屏只认整月)。
// setup 期 books 还没到 —— apply 是异步的:先等 ensureLoaded,再落册落期(与出账链五屏「同步 pick」不同,复查时别按那个口径看)。
// 期区**直写 activeBookId,不经 selectBook** —— selectBook 在表格态末行 goGate 把人推回矩阵(spec §9 P0b 破坏验证 / §12);
// 旧链(收入核对「去改附表10」、分析层 5 处)仍走 ?phase=,co 缺席时用它兜底;?tenant= 照旧定位高亮。
// 三个 ref 在同一拍连写(册 → pickCell 置月置年),watch([activeBookId, year, month]) 只跑一次 templateAt。
// 本屏草稿 = dirty 集合;切回时有 → 不切期,只在 deepNote 里说。必须在下面的 onReactivated 之前调用:先改期,后重读。
async function applyDeep(t: DeepPeriod) {
  if (t.month == null) return
  await ensureLoaded()
  const ph = typeof t.co === 'number' ? t.co : Number(route.query.phase)
  const b = books.value.find(x => x.phase === ph)
  if (b) activeBookId.value = b.id
  await pickCell(t.year, t.month)
  focusTenant.value = typeof route.query.tenant === 'string' ? route.query.tenant : ''
}
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: year.value == null ? null : periodOf(year.value, month.value), co: phase.value }),
  apply: (t) => { void applyDeep(t).catch(() => {}) },
  dirty: () => dirty.size,
})
// KeepAlive 切回重读(spec §12):导入中心导完切回来,矩阵与本月不能还是导入前的旧表;有草稿只刷总览(loadMonth 会 dirty.clear())
onReactivated(() => {
  void reloadOverview().catch(() => {})
  if (year.value != null && dirty.size === 0) void loadMonth(year.value).catch(() => {})
})
```

第 720 行 `<ImportResultToast v-if="importResult" … />` 之后加一行 `    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />`。

- [ ] **Step 4: 跑绿 + 门禁 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/__tests__/s10DeepLink.spec.ts src/views/__tests__/archivedCols.spec.ts src/views/__tests__/monthTemplate.spec.ts src/components/sched/__tests__/schedHeader.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts src/utils/deepLink.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿（`archivedCols` / `monthTemplate` 的附表10 用例走的是常量 `y&m&phase` query，经 apply 的 `?phase=` 兜底照旧落 2026-09；`utils/deepLink.spec` 的 `parseS10DeepLink` 用例照旧 —— 模块保留）。破坏验证：① applyDeep 改成 `await pickCell(…)` 之后再 `selectBook(b.id)` → 用例 1 「.s10-gate」红；② 把 `if (b) activeBookId.value = b.id` 挪到 `await pickCell` 之后 → 用例 1「templateAt 只跑一次」红；③ 删 onReactivated → 用例 4 红；④ onReactivated 去掉 `dirty.size === 0` → 用例 5「不重读本月」红；⑤ dirty 改 `() => 0` → 用例 5 红。字符串替换还原。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/sales-income/S10View.vue frontend/src/views/__tests__/s10DeepLink.spec.ts
git commit -m "feat(deeplink): 附表10 接 useDeepPeriod(期区直写 activeBookId,不撞 goGate)+ 切回重读"
```

---
### Task 5: 月度台账（co → 册，year/month 直落宽表）

**Files:**
- Modify: `frontend/src/views/ledger/LedgerView.vue:7-15, 117-132, 837`
- Modify: `frontend/src/views/ledger/LedgerWideTable.vue:63-64`（注释 4 条 → 5 条）
- Create: `frontend/src/views/__tests__/ledgerDeepLink.spec.ts`

**Interfaces:**
- Consumes: `useDeepPeriod`；`type DeepPeriod` / `periodOf`；屏内 `books` / `companies` / `activeBookId` / `chainBook` / `companyId` / `year` / `month` / `edit` / `draft` / `monthDto` / `deletedKeys` / `extraYears` / `drawerRowKey`、`loadBooks` / `loadCompanies` / `loadGateYears` / `loadOverviews` / `loadMonth` / `cancelEdit`（函数声明）、`ledgerRowKey`。
- Produces: `?p=YYYY-MM&co=<公司 id>` 直落该册该月宽表；旧 `?y&m&company&tenant` 照认；无 co 落当前册 / 首册；切回浏览态重读本月；`dirtyCount()`。

- [ ] **Step 1: 写 ledgerDeepLink.spec（先红）**

新建 `frontend/src/views/__tests__/ledgerDeepLink.spec.ts`（夹具照 `ledgerLeaveAndReturn.spec.ts:27-49` + `monthTemplate.spec.ts:50-58`，多加一册乙公司）：

```ts
// src/views/__tests__/ledgerDeepLink.spec.ts — 台账消费期间深链(SIDEBAR-UX-REDESIGN §4.2「台账 co 落 activeBookId + year/month 直落宽表」)。
// apply 是异步的(setup 期 books / companies 还没到,先等 ensureLoaded);co 数字按公司 id、字符串按旧公司名,没给 co 落当前册 / 首册。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { Book } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import { FEE_KEYS } from '@/utils/ledgerColumns'

const def: Book['definition'] = { groups: [{ id: 'g1', label: '租金', cols: [
  { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
] }] }
const bookA: Book = { id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司', ver: 1, latestVer: 1, definition: def }
const bookB: Book = { ...bookA, id: 2, companyId: 12, name: '乙公司' }
const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<string, number>
const rowOf = (name: string) => ({
  ...zeroFees(), id: 5, tenantId: 5, tenantName: name, balancePrev: 0, totalCollected: 0,
  note: null, totalReceivable: 0, balanceEnd: 0,
} as unknown as LedgerRowDTO)
const monthOf = (companyName: string, year: number, month: number): LedgerMonthDTO => ({
  companyName, year, month, prevMonth: month - 1, rows: [rowOf('甲户')],
  footer: { ...zeroFees(), balancePrev: 0, totalReceivable: 0, totalCollected: 0, balanceEnd: 0 } as LedgerMonthDTO['footer'],
  archivedCols: [],
})

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/ledger?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn(), templateAt: vi.fn() } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn() },
  ledgerApi: { years: vi.fn(), overview: vi.fn(), month: vi.fn() },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import LedgerView from '@/views/ledger/LedgerView.vue'
import LedgerWideTable from '@/views/ledger/LedgerWideTable.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { booksApi } from '@/api/books'
import { ledgerApi, companyApi } from '@/api/ledger'

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  // ?tenant= 命中行会 scrollIntoView,jsdom 没实现(既有两份 spec 的 tenant 都是空串,没踩到)
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(booksApi.list).mockResolvedValue([bookA, bookB])
  vi.mocked(booksApi.templateAt).mockImplementation((id: number) => Promise.resolve(id === 2 ? bookB : bookA))
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 9, name: '甲公司', short: '甲', sortNo: 1 }, { id: 12, name: '乙公司', short: '乙', sortNo: 2 },
  ])
  vi.mocked(ledgerApi.years).mockResolvedValue([])
  vi.mocked(ledgerApi.overview).mockImplementation((_c: number, y: number) => Promise.resolve({
    companyName: '', year: y, monthsWithData: 0, ytdRecv: 0, avgRecv: 0, activeTenants: 0, months: [],
  } as never))
  vi.mocked(ledgerApi.month).mockImplementation((c: number, y: number, m: number) =>
    Promise.resolve(monthOf(c === 12 ? '乙公司' : '甲公司', y, m)))
})

async function open() {
  const w = mount(LedgerView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(照 ledgerLeaveAndReturn.spec:80)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(LedgerView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}
interface Vm { edit: boolean; month: number | null; draft: LedgerRowDTO[]; focusTenant: string; enterEdit: () => void; activeBookId: number | null }

describe('月度台账 · 期间深链', () => {
  it('❗p + co(公司 id) 直落该册该月宽表:矩阵不出现,月表只拉一次且是 (12, 2026, 9),模板只取一次', async () => {
    // 红线:useDeepPeriod 整段删掉 → 停在选册占位。「册 / 年 / 月同一拍连写」由用例 8 钉 —— 首载从 null 起步时中间那拍 loadMonthBook 因 m == null 早退,这里钉不住
    query.p = '2026-09'; query.co = '12'
    const w = await open()
    expect(w.findComponent(LedgerWideTable).exists(), '直落宽表').toBe(true)
    expect(w.findComponent(BookMonthMatrix).exists(), '矩阵该被深链跳过').toBe(false)
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2026, 9)
    expect(ledgerApi.month).toHaveBeenCalledTimes(1)
    expect(booksApi.templateAt).toHaveBeenCalledWith(2, 2026, 9)
    expect(booksApi.templateAt).toHaveBeenCalledTimes(1)
    expect(booksApi.list, 'books 只拉一次(onMounted 与 apply 共用 ensureLoaded)').toHaveBeenCalledTimes(1)
  })

  it('旧链 ?y&m&company=甲公司&tenant= 照认(收入核对 / 分析层本期不改发链侧)', async () => {
    query.y = '2026'; query.m = '9'; query.company = '甲公司'; query.tenant = '甲户'
    const w = await open()
    expect(ledgerApi.month).toHaveBeenCalledWith(9, 2026, 9)
    // focusTenant 是一次性的:表渲染完就 emit focus-done、父层随即清空,所以钉「送到表里了」而不是钉父层的 ref(计划复查 P0B-2)
    expect(w.findComponent(LedgerWideTable).emitted('focus-done'), '旧链的 ?tenant= 送到表里了').toBeTruthy()
  })

  it('没给 co 落首册 —— 首页台账行本期不带公司(公司 chips 是 P2 的事)', async () => {
    // 红线:bookOf(null) 返回 null → 停在选册占位,首页那一击白点
    query.p = '2026-09'
    await open()
    expect(ledgerApi.month).toHaveBeenCalledWith(9, 2026, 9)
  })

  it('co 认不出 / 只有年 → 不动,停在选册占位', async () => {
    query.p = '2026-09'; query.co = '99'
    const w = await open()
    expect(w.findComponent(LedgerWideTable).exists()).toBe(false)
    expect(ledgerApi.month).not.toHaveBeenCalled()
    delete query.co; query.p = '2026'
    const w2 = await open()
    expect(w2.findComponent(LedgerWideTable).exists()).toBe(false)
    expect(ledgerApi.month).not.toHaveBeenCalled()
  })

  it('❗编辑态有改动时切回、地址栏换了月 → 期不动、草稿还在、编辑态不退,deepNote 说清楚', async () => {
    // 红线:dirty 探针改成 () => 0 → cancelEdit 把 draft 清了,期切到 2026-10
    query.p = '2026-09'; query.co = '12'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(LedgerView).vm as unknown as Vm
    vm.enterEdit()
    await flushPromises()
    ;(vm.draft[0] as unknown as Record<string, unknown>).factoryRent = 1
    await flushPromises()
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2026-10'
    alive.value = true; await flushPromises()
    expect(ledgerApi.month, '有草稿 → 不切期,编辑态也不重读').not.toHaveBeenCalled()
    expect(vm.month).toBe(9)
    expect(vm.edit).toBe(true)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2026-10 期，本期有 1 处未保存')
  })

  it('编辑态但没改动时切回换月 → 先退编辑态再换期(锁经 LedgerWideTable 的 watch(edit) 归还)', async () => {
    // 红线:applyDeep 里的 `if (edit.value) cancelEdit()` 删掉 → 新月的表挂在旧月的编辑态上,lockScope 换了键旧锁没人还
    query.p = '2026-09'; query.co = '12'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(LedgerView).vm as unknown as Vm
    vm.enterEdit()
    await flushPromises()
    alive.value = false; await flushPromises()
    query.p = '2026-10'
    alive.value = true; await flushPromises()
    expect(vm.edit).toBe(false)
    expect(vm.month).toBe(10)
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2026, 10)
  })

  it('❗切页签回来重读本月(spec §12 同款):浏览态重拉,编辑态不动', async () => {
    // 红线:LedgerView.vue 新加的第二个 onReactivated 删掉 → 浏览态切回零请求(既有那个只恢复抽屉)
    query.p = '2026-09'; query.co = '12'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(LedgerView).vm as unknown as Vm
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2026, 9)
    expect(ledgerApi.month).toHaveBeenCalledTimes(1)
    vm.enterEdit()
    await flushPromises()
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(ledgerApi.month, '编辑态不重读:换了快照会把 draft 判脏').not.toHaveBeenCalled()
  })

  it('❗浏览态切回换年:册 / 年 / 月同一拍连写 → 模板只取一次且是新年月', async () => {
    // 红线:applyDeep 里 year 与 month 之间夹一个 await(分两拍写)→ watch 先按 (2, 2025, 9) 取一次模板,再按 (2, 2025, 3) 取 → 两次
    query.p = '2026-09'; query.co = '12'
    const { alive } = await keptAlive()
    vi.mocked(booksApi.templateAt).mockClear()
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2025-03'
    alive.value = true; await flushPromises()
    expect(booksApi.templateAt).toHaveBeenCalledWith(2, 2025, 3)
    expect(booksApi.templateAt, '同一拍连写,watch 只跑一次').toHaveBeenCalledTimes(1)
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2025, 3)
  })
})
```

- [ ] **Step 2: 确认红**

Run: `cd frontend && npx vitest run src/views/__tests__/ledgerDeepLink.spec.ts`
Expected: 用例 1 / 3 / 5 / 6 / 7 / 8 红；用例 2 / 4 可能已绿（旧路径本来就认 y&m&company）—— 报告里写清。

- [ ] **Step 3: 接线**

`LedgerView.vue` 第 8 行 `import { onReactivated } from '@/composables/onReactivated'` 之后加 `import { useDeepPeriod } from '@/composables/useDeepPeriod'` 与 `import { periodOf, type DeepPeriod } from '@/nav/deepLink'`；**删掉**第 15 行 `import { parseLedgerDeepLink } from '@/utils/deepLink'`。

第 117-132 行 `onMounted(async () => { await Promise.all([loadBooks(), loadCompanies()]) … focusTenant.value = dl.tenant\n})` 整段替换为：

```ts
// books / companies 只拉一次:onMounted 与深链 apply 谁先到谁发起,后到的等同一个 Promise
let loaded: Promise<void> | null = null
function ensureLoaded() {
  if (!loaded) loaded = Promise.all([loadBooks(), loadCompanies()]).then(() => {})
  return loaded
}
onMounted(() => { void ensureLoaded() })
/** 深链的 co → 册:新链 co=<公司 id>;旧链 ?company=<公司名>(公司名认不到再按册名);没给 co 或 co='all'(台账没有「全部」视图)= 当前册,还没选册就是首册。认不出 → null(不动)。 */
function bookOf(co: DeepPeriod['co']): Book | null {
  if (typeof co === 'number') return books.value.find(b => b.companyId === co) ?? null
  if (typeof co === 'string' && co !== 'all') {
    const c = companies.value.find(x => x.name === co)
    return (c ? books.value.find(b => b.companyId === c.id) : books.value.find(b => b.name === co)) ?? null
  }
  return chainBook.value ?? books.value[0] ?? null
}
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM&co=<公司 id> 直落该册该月的宽表(绕过矩阵态);只有年的链接不动(本屏只认整月)。
// setup 期 books / companies 还没到 —— apply 是异步的:先等 ensureLoaded,再落册落期(与出账链五屏「同步 pick」不同,复查时别按那个口径看)。
// 换期前若在编辑态先 cancelEdit:LedgerWideTable 的 watch(edit) 据此还锁,否则 lockScope 换了键、旧锁没人认领(它是第 5 条退出编辑态的路)。
// 三个 ref(册 / 年 / 月)在同一拍连写,watch([activeBookId, year, month]) 只跑一次 templateAt。?tenant= 照旧定位高亮。
async function applyDeep(t: DeepPeriod) {
  if (t.month == null) return
  await ensureLoaded()
  const b = bookOf(t.co)
  if (!b) return
  if (edit.value) cancelEdit()
  activeBookId.value = b.id
  year.value = t.year
  extraYears.value = b.companyId != null ? loadExtraYears('ledger', b.companyId) : []
  // 矩阵数据后台补齐:「换期」返回矩阵时已就绪
  void loadGateYears().then(loadOverviews).catch(() => { /* 拉失败保持旧值即可,不抛 unhandledrejection(同 backToMonths) */ })
  month.value = t.month
  drawerRowKey.value = null
  // 先清上月快照,兜底转圈接管(同 pickCell)
  monthDto.value = null
  await loadMonth()
  focusTenant.value = typeof route.query.tenant === 'string' ? route.query.tenant : ''
}
/** 未保存改动数:编辑态下 draft 与服务端快照逐行比(含批删)。子组件 LedgerWideTable.isDirty 是同口径的布尔,它没 expose,父层自算。 */
function dirtyCount(): number {
  if (!edit.value) return 0
  const base = new Map((monthDto.value?.rows ?? []).map(r => [ledgerRowKey(r), JSON.stringify(r)]))
  let n = deletedKeys.value.size
  for (const r of draft.value) if (base.get(ledgerRowKey(r)) !== JSON.stringify(r)) n++
  return n
}
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: month.value == null ? null : periodOf(year.value, month.value), co: companyId.value }),
  apply: (t) => { void applyDeep(t).catch(() => {}) },
  dirty: dirtyCount,
})
// KeepAlive 切回重读本月(spec §12 同款):导入中心导完切回来,宽表不能还是导入前的;编辑态不动(草稿在 draft 里,快照换了会把它判脏)
onReactivated(() => { if (month.value != null && !edit.value) void loadMonth().catch(() => {}) })
```

第 837 行 `<FPToast v-model="verToast" placement="page" :duration="4000" />` 之后加一行 `  <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />`。

`LedgerWideTable.vue` 第 63-64 行注释 `// 用 watch 而不是在每个退出口各加一行 —— 父层有 4 条路会把 edit 置回 false\n// (取消/保存/换期/切册),漏一条就是一把没人认领的锁。` 改为 `// 用 watch 而不是在每个退出口各加一行 —— 父层有 5 条路会把 edit 置回 false\n// (取消/保存/换期/切册/深链换期),漏一条就是一把没人认领的锁。`

- [ ] **Step 4: 跑绿 + 门禁 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/__tests__/ledgerDeepLink.spec.ts src/views/__tests__/ledgerLeaveAndReturn.spec.ts src/views/__tests__/monthTemplate.spec.ts src/views/__tests__/archivedCols.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts src/utils/deepLink.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿（`ledgerLeaveAndReturn` 的 query 是 `{}`，parsePeriod 为 null，首跑与切回都不动；`monthTemplate` 台账两条走常量 `y&m&company` 经 apply 落 2026-09，`mount + flushPromises` 之后仍直接是表格态）。破坏验证：① 删 useDeepPeriod 段 → 用例 1 / 3 / 5 红；② `bookOf` 末行改 `return null` → 用例 3 红；③ 删 `if (edit.value) cancelEdit()` → 用例 6 红；④ 删新加的 onReactivated → 用例 7 红；⑤ `dirty: () => 0` → 用例 5 红；⑥ 把 `month.value = t.month` 挪到 `await loadMonth()` 之后 → 用例 1「templateAt 只取一次」仍绿但月表按 null 早退 → 用例 1「month 被调」红；⑦ 在 `year.value = t.year` 之后插一行 `await Promise.resolve()`（month 落到下一拍）→ 只有用例 8 红（templateAt 两次；用例 1 从 null 起步钉不住这个）。字符串替换还原。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ledger/LedgerView.vue frontend/src/views/ledger/LedgerWideTable.vue frontend/src/views/__tests__/ledgerDeepLink.spec.ts
git commit -m "feat(deeplink): 台账接 useDeepPeriod(co → 册,year/month 直落宽表)+ 浏览态切回重读本月"
```

---
### Task 6: 导入中心（p / co 预填 + 导后「去查看」）+ ImportResultToast

**Files:**
- Modify: `frontend/src/components/import/ImportResultToast.vue:9-10, 80-82, 125`
- Modify: `frontend/src/views/import-center/ImportCenterView.vue:4, 23, 41-43, 98, 150-161, 276`
- Create: `frontend/src/views/__tests__/importCenterDeepLink.spec.ts`

**Interfaces:**
- Consumes: `parsePeriod` / `periodLink` / `periodOf`（`@/nav/deepLink`）；`ImportCtx`（`ctx.year / month / companyId`）；section 导入的 `Pick`（`{ year?, month?, phase?, records }`）。
- Produces: `ImportResultToast` 新增 `go?: string` prop + `go` emit（不传 = 与今天一个字不差）；`ImportCenterView` 的 `viewLink(key, ctx, payload)` 与 `goView()`。

- [ ] **Step 1: 写 importCenterDeepLink.spec（先红）**

新建 `frontend/src/views/__tests__/importCenterDeepLink.spec.ts`（全仓此前零 spec 挂载导入中心，回归网从零搭）：

```ts
// src/views/__tests__/importCenterDeepLink.spec.ts — 导入中心消费期间深链(SIDEBAR-UX-REDESIGN §4.2「导入中心 p 预填表单」)+ 导后「去查看」(§9 P0b)。
// 本屏没有「当前期」,parsePeriod 读一次预填台账类表单;「去查看」只给期在导入时就已知的三类(台账 / 附10 / 附12)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { ImportCtx } from '@/utils/importRegistry'

const query: Record<string, string> = {}
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query, get fullPath() { return '/import?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/importLog', () => ({ importLogApi: { overview: vi.fn(), record: vi.fn() } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn() },
  ledgerApi: { month: vi.fn() },
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn() } }))
// 只桩 runImport:IMPORT_TYPES 要真的那份(磁贴按它渲染)
vi.mock('@/utils/importRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/importRegistry')>()),
  runImport: vi.fn(),
}))

import ImportCenterView from '@/views/import-center/ImportCenterView.vue'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import { runImport } from '@/utils/importRegistry'

interface Vm {
  lf: { companyId: number | null; year: number; month: number }
  activeKey: string | null
  ctx: ImportCtx
  doRun: (payload: unknown[], fileName: string) => Promise<void>
}
const vmOf = (w: { vm: unknown }) => w.vm as Vm

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(importLogApi.overview).mockResolvedValue({ latestByType: [], history: [] })
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 9, name: '甲公司', short: '甲', sortNo: 1 }, { id: 12, name: '乙公司', short: '乙', sortNo: 2 },
  ])
  vi.mocked(ledgerApi.month).mockResolvedValue({ rows: [] } as never)
  vi.mocked(booksApi.list).mockResolvedValue([])
  vi.mocked(runImport).mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
})

async function open() {
  const w = mount(ImportCenterView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 某类型磁贴上的「上传」按钮。 */
const uploadOf = (w: Awaited<ReturnType<typeof open>>, label: string) =>
  w.findAll('.im-tile').find(t => t.find('.im-tile-name').text() === label)!.find('button')

describe('导入中心 · 期间深链预填', () => {
  it('❗?p=2025-03&co=12 预填台账类表单 —— openImport 的重置也不丢', async () => {
    // 红线:lf 初值 / openImport 第 98 行不走 defaultLf → 表单开出来是当前年月 + 首家
    query.p = '2025-03'; query.co = '12'
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(w.find('.im-ctx').exists(), '公司 + 年月表单开着').toBe(true)
    expect(vmOf(w).lf).toEqual({ companyId: 12, year: 2025, month: 3 })
  })

  it('没有深链 → 当前年月 + 首家公司(改前口径)', async () => {
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: 9, year: 2025, month: 6 })
  })

  it('co 不在公司名单里 → 退回首家,期照用(不让「下一步」按一个不存在的公司)', async () => {
    query.p = '2025-03'; query.co = '99'
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: 9, year: 2025, month: 3 })
  })
})

describe('导入中心 · 导后「去查看」', () => {
  it('❗台账导完 →「去查看」带 p + co 去台账,点了弹层就关', async () => {
    // 红线:viewLink 的 ledger 分支删掉 → 没按钮;periodLink 的 co 漏了 → push 里没有 co
    const w = await open()
    const vm = vmOf(w)
    vm.activeKey = 'ledger'
    vm.ctx = { companyId: 12, companyName: '乙公司', year: 2025, month: 3 }
    await vm.doRun([{ tenantName: '甲户' }], 'a.xlsx')
    await flushPromises()
    const go = w.findAll('button').find(b => b.text() === '去查看')
    expect(go, '结果弹层该有「去查看」').toBeTruthy()
    await go!.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2025-03', co: '12' } })
    expect(w.find('.ir-scrim').exists(), '点了就关').toBe(false)
  })

  it('附表10 / 附表12 导完 → 期(与期区)从第一段取', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.activeKey = 's10'; vm.ctx = {}
    await vm.doRun([{ year: 2025, month: 3, phase: 2, records: [] }], 's10.xlsx')
    await flushPromises()
    await w.findAll('button').find(b => b.text() === '去查看')!.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/sales-income', query: { p: '2025-03', co: '2' } })

    vm.activeKey = 'salary'
    await vm.doRun([{ year: 2025, month: 4, records: [] }], 'salary.xlsx')
    await flushPromises()
    await w.findAll('button').find(b => b.text() === '去查看')!.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/salary', query: { p: '2025-04' } })
  })

  it('期读不出来的类型(附13 平铺行)没有「去查看」,结果弹层照旧', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.activeKey = 'office_13'; vm.ctx = {}
    await vm.doRun([{ acctMonth: '2025-03' }], 'u.xlsx')
    await flushPromises()
    expect(w.find('.ir-scrim').exists()).toBe(true)
    expect(w.findAll('button').some(b => b.text() === '去查看')).toBe(false)
    expect(w.findAll('button').some(b => b.text() === '知道了')).toBe(true)
  })
})
```

- [ ] **Step 2: 确认红**

Run: `cd frontend && npx vitest run src/views/__tests__/importCenterDeepLink.spec.ts`
Expected: 预填 3 条里第 1 / 3 条红（第 2 条是改前口径，绿）；去查看 3 条里前两条红、第三条绿。

- [ ] **Step 3: ImportResultToast 加「去查看」**

`ImportResultToast.vue` 第 9-10 行改为：
```ts
// summary: 智能整表多段导入时,各段「年月期·导入/跳过/错误」一行一段
// go: 传了就多一个按钮(文案即它),点击 emit('go') —— 导入中心「去查看」(SIDEBAR-UX-REDESIGN §9 P0b);其余 16 个消费方不传,一个字不变
const props = defineProps<{ result: ImportResultDTO; summary?: string; go?: string }>()
const emit = defineEmits<{ close: []; go: [] }>()
```
第 80-82 行改为：
```html
      <div class="ir-f">
        <Button v-if="go" variant="outline" full-width @click="emit('go')">{{ go }}</Button>
        <Button variant="filled" full-width @click="emit('close')">知道了</Button>
      </div>
```
第 125 行 `.ir-f { padding:16px 20px; }` 改为 `.ir-f { padding:16px 20px; display:flex; gap:10px; }`。

- [ ] **Step 4: ImportCenterView 接线**

第 4 行 `import { ref, onMounted, computed, h } from 'vue'` 之后加：
```ts
import { useRoute, useRouter } from 'vue-router'
import { parsePeriod, periodLink, periodOf } from '@/nav/deepLink'
```
第 41-43 行（`// 默认会计期 = 当前年月…` 到 `const lf = ref<…>({ … })`）替换为：
```ts
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM&co=<公司 id> 预填台账类表单。本屏没有「当前期」,读一次即可,不接 useDeepPeriod。
// 默认会计期 = 深链的期,没有就当前年月(不硬编码,跨年自适应);公司 = 深链的 co(必须在名单里),没有就首家。
const route = useRoute()
const router = useRouter()
const deep = parsePeriod(route.query as Record<string, unknown>)
const now = new Date()
function defaultLf(): { companyId: number | null; year: number; month: number } {
  const dc = deep?.co
  const companyId = typeof dc === 'number' && companies.value.some(c => c.id === dc) ? dc : companies.value[0]?.id ?? null
  return { companyId, year: deep?.year ?? now.getFullYear(), month: deep?.month ?? now.getMonth() + 1 }
}
const lf = ref(defaultLf())
```
第 98 行 `lf.value = { companyId: companies.value[0]?.id ?? null, year: now.getFullYear(), month: now.getMonth() + 1 }` 改为 `lf.value = defaultLf()`。

第 150-161 行 `doRun` 整个函数替换为：
```ts
// 导后「去查看」(SIDEBAR-UX-REDESIGN §9 P0b):只给期在导入时就已知的三类 —— 台账(ctx)、附10 / 附12(第一段 pick 的 year/month/phase);
// 平铺行的期在行里,本屏不解析,其余类型结果弹层照旧。年表屏 / 抄表屏的导入以后要接再加。
const viewTo = ref<{ path: string; query: Record<string, string> } | null>(null)
function viewLink(key: string, c: ImportCtx, payload: unknown[]): typeof viewTo.value {
  const first = payload[0] as { year?: number; month?: number; phase?: number } | undefined
  if (key === 'ledger' && c.year && c.month && c.companyId)
    return periodLink('ledger', { p: periodOf(c.year, c.month), co: c.companyId })
  if (key === 's10' && first?.year && first.month)
    return periodLink('sales-income', { p: periodOf(first.year, first.month), co: first.phase })
  if (key === 'salary' && first?.year && first.month)
    return periodLink('salary', { p: periodOf(first.year, first.month) })
  return null
}
// 裸 push:router.afterEach 会 tabs.open;目标页签活着就走它 onReactivated 那条深链,不活就新实例 setup 那条
function goView() {
  const to = viewTo.value
  importResult.value = null
  if (to) router.push(to)
}
async function doRun(payload: Parameters<typeof runImport>[1], fileName: string) {
  if (!activeKey.value) return
  // 覆盖预检仅平铺台账做;段模式(元素带 .records)不做覆盖 confirm(规范 v1 边界)
  const isSections = !!(payload as { records?: unknown }[])[0]?.records
  if (activeKey.value === 'ledger' && !isSections && !(await confirmLedgerOverwrite(payload as ImportRec[]))) return
  try {
    importResult.value = await runImport(activeKey.value, payload, ctx.value, fileName)
    viewTo.value = viewLink(activeKey.value, ctx.value, payload as unknown[])
    await reload()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}
```
第 276 行改为：
```html
  <ImportResultToast v-if="importResult" :result="importResult" :go="viewTo ? '去查看' : undefined" @go="goView" @close="importResult = null" />
```

- [ ] **Step 5: 跑绿 + 门禁 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/__tests__/importCenterDeepLink.spec.ts src/utils/importRegistry.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿（`<Button v-if="go">` 是组件标签，门禁不看）。破坏验证：① `lf` 初值改回旧字面量 → 预填用例 1 仍绿（openImport 走 defaultLf）—— 再把第 98 行改回旧字面量 → 用例 1 / 3 红（两处都要改坏才红，报告写明）；② `viewLink` 的 ledger 分支删掉 → 去查看用例 1 红；③ `co: c.companyId` 删掉 → 用例 1 push 形状红；④ `goView` 不清 `importResult` → 用例 1「点了就关」红。字符串替换还原。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/import/ImportResultToast.vue frontend/src/views/import-center/ImportCenterView.vue frontend/src/views/__tests__/importCenterDeepLink.spec.ts
git commit -m "feat(import): 导入中心按 p/co 预填台账表单;台账 / 附10 / 附12 导后「去查看」直落该期"
```

---
### Task 7: 发链侧 —— 首页附表行走 periodLink

**Files:**
- Modify: `frontend/src/views/data-home/DataHomeView.vue:58-89, 217-218`
- Modify: `frontend/src/views/data-home/DataHomeView.spec.ts:69-74, 137-142, 160-165`

**Interfaces:**
- Consumes: `periodLink` / `periodOf`（已 import）；Task 1-5 的目标屏都认得下面发的形状。
- Produces: 附表行 push 形状 —— 台账 / 附10 / 附12 `{ path, query: { p: 'YYYY-MM' } }`；附6 / 7 / 8 / 11 `{ p: 'YYYY', mode: 'summary' }`；附13 / 14 `{ p: 'YYYY', tab: 'office' | 'phase3' }`。

- [ ] **Step 1: 改 spec（先红）**

`DataHomeView.spec.ts` 第 69-74 行的 `items` 加一行（附14 与附13 同 go 异 tag）：
```ts
      items: [
        { name: '月度台账', tag: '凭证', done: false, go: 'ledger' },
        { name: '办公水电', tag: '附13', done: true, go: 'utilities' },
        { name: '光伏发电', tag: '附6', done: true, go: 'pv-income' },
        { name: '三期水电', tag: '附14', done: true, go: 'utilities' },
      ],
```
第 137-142 行「附表未录在前、已录在后」的最后一条断言改为 `expect(names.slice(1)).toEqual(['办公水电', '光伏发电', '三期水电'])   // 已录靠后`。

第 160-165 行「点附表项:不动 billingPeriod」改为：
```ts
  it('点附表项:不动 billingPeriod;月表行带 p=YYYY-MM(SIDEBAR-UX-REDESIGN §5.1,P0b)', async () => {
    const w = await mountWith()
    await w.findAll('.dh-item')[0].trigger('click')   // 月度台账
    expect(useBillingPeriodStore().picked).toBe(false)
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2024-02' } })
  })

  it('年表行带 p=YYYY + mode=summary —— 年表屏 p 只取年,盖过本机记住的运营账', async () => {
    // 红线:periodOf(p.year, p.month) → 目标屏 current 永不相等,每次切回白拉;mode 漏了 → 落到本机记住的运营账
    const w = await mountWith()
    await w.findAll('.dh-item')[2].trigger('click')   // 光伏发电(附6)
    expect(push).toHaveBeenCalledWith({ path: '/pv-income', query: { p: '2024', mode: 'summary' } })
  })

  it('附13 / 附14 同屏异 tab —— 按行的 tag 分', async () => {
    // 红线:模板只传 i.go → 两行都落办公水电
    const w = await mountWith()
    await w.findAll('.dh-item')[1].trigger('click')   // 办公水电(附13)
    expect(push).toHaveBeenLastCalledWith({ path: '/utilities', query: { p: '2024', tab: 'office' } })
    await w.findAll('.dh-item')[3].trigger('click')   // 三期水电(附14)
    expect(push).toHaveBeenLastCalledWith({ path: '/utilities', query: { p: '2024', tab: 'phase3' } })
  })
```

Run: `cd frontend && npx vitest run src/views/data-home`
Expected: 「附表未录在前」转绿（夹具改了）；改写的 1 条 + 新 2 条红（push 仍是 `'/ledger'` 裸字符串）。

- [ ] **Step 2: 改 go()**

`DataHomeView.vue` 第 58-89 行的 `go` 与它上方的注释块整段替换为：

```ts
// 行点击 = 「去做事」显式导航 → 全新状态(openFresh;侧栏语义翻案是 P3 的事,这里不动)。
// 出账链五屏共读 billingPeriod store:先 pick 首页当前月再 push,目标屏的选期矩阵就被前置满足
// (SIDEBAR-UX-REDESIGN §4.1 / D2)。pick 覆盖会话里已选的期 —— 首页写着的月就是用户刚点的意图;
// 本人握着任一链锁时先确认:openFresh 重建目标屏会清掉未保存草稿(不分同月异月)。
// 链屏与收入核对带 ?p(目标屏的 parsePeriod / parsePeriodQuery 都认);附表行也带(P0b,形状见 scheduleLink)。
// 前置条「去重算」的 go 也是 params,同样走这条 pick 分支 —— 它指向的正是首页显示月的参数屏,不 pick 反而落回矩阵(评审裁定 2026-09-03)。
// 本人锁的判断读 presence.users(3 秒一拍,PING_MS):刚进首页那一拍之前看不到自己别处的锁,确认框是尽力而为不是保证。
// ponytail: window.confirm —— 与 ParamCenterView / BillNoticesView 现有 200+ 处同款,P0 之后若换 FPDrawer 一起换。
const MONTH_ROWS = new Set(['ledger', 'sales-income', 'salary'])
const YEAR_ROWS = new Set(['pv-income', 'car-charging', 'ebike-charging', 'elec-cost'])
/** 附表行的深链形状(SIDEBAR-UX-REDESIGN §5.1):月表带 p=YYYY-MM;年表屏 p 只取年 + mode=summary(盖过本机记住的运营账);
 *  附13 / 附14 两行同指 utilities,按行的 tag 分 tab。台账行本期不带 co(公司 chips 是 P2 的事,目标屏落首册)。 */
function scheduleLink(v: string, tag: string, p: { year: number; month: number }) {
  if (MONTH_ROWS.has(v)) return periodLink(v, { p: periodOf(p.year, p.month) })
  if (YEAR_ROWS.has(v)) return periodLink(v, { p: periodOf(p.year, null), extra: { mode: 'summary' } })
  if (v === 'utilities') return periodLink(v, { p: periodOf(p.year, null), extra: { tab: tag === '附14' ? 'phase3' : 'office' } })
  return null
}
function go(v: string, tag = '') {
  // 用户刚在下拉里选的月优先于服务端回包(回包在途时也按他选的走);没选过才用锚定月
  const ym = pickedYm.value ?? curYm.value
  const p = ym ? { year: +ym.slice(0, 4), month: +ym.slice(5, 7) } : null
  if (p && CHAIN_VALUES.has(v)) {
    // 只要本人握着任一出账链/抄表锁就先确认:openFresh 会重建目标屏,编辑中的草稿不分同月异月都会丢
    // (2026-09-03 对抗复查 F3;侧栏改「恢复现场」的 P3 落地后再收窄)。
    const held = myChainLockPeriods()
    if (held.length && !window.confirm(`你正在编辑出账链（${held.join('、')}）。从首页重新打开会丢失未保存的改动，继续？`)) return
    period.pick(p.year, p.month)
    // 门被前置跳过 → ChainMonthGate 不再挂载,而它是 loadChain 的唯一调用方;不补这一句,
    // 目标屏的链路条读到的是空格子,五道工序全显「未做」(2026-09-03 对抗复查 F1)。
    // loadChain 幂等:已载入直接返回,在途去重。失败不阻断跳转(矩阵那边同样只标「加载失败」)。
    void period.loadChain().catch(() => {})
  }
  tabsStore.openFresh(v)
  // 链屏与收入核对带 ?p(SIDEBAR-UX-REDESIGN §4.1「显式选月 + periodLink」):目标屏 useDeepPeriod 认得,
  // 链屏还会与上面预 pick 的期比对(相同 → 不动);附表行按 scheduleLink 的形状带参(P0b)。
  if (p && (CHAIN_VALUES.has(v) || v === 'reconciliation')) {
    router.push(periodLink(v, { p: periodOf(p.year, p.month) }))
    return
  }
  const link = p ? scheduleLink(v, tag, p) : null
  router.push(link ?? '/' + v)
}
```
第 217-218 行 `<li v-for="i in sortedItems" … class="dh-item" @click="go(i.go)">` 改为 `@click="go(i.go, i.tag)"`。

- [ ] **Step 3: 跑绿 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/data-home src/views/__tests__/noInteractionLayoutShift.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿（含「点附表项不触发 loadChain」「不动 billingPeriod」的后半断言）。破坏验证：① `YEAR_ROWS` 分支的 `periodOf(p.year, null)` 改 `periodOf(p.year, p.month)` → 年表用例红；② 模板改回 `go(i.go)` → 附13/14 用例红；③ `MONTH_ROWS` 删掉 `'ledger'` → 台账用例红。字符串替换还原。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/data-home/DataHomeView.vue frontend/src/views/data-home/DataHomeView.spec.ts
git commit -m "feat(data-home): 附表行走 periodLink(月表 p / 年表 p+mode / 附13·14 tab)"
```

---
### Task 8: 门禁 + spec 口径 + 对抗复查 + 复查记录

- [ ] **Step 1: 全量门禁**

```bash
cd frontend && npx vitest run && npm run build
```
Expected: vitest 全绿（基线 186 files / 2181 tests → 190 files；+4 文件：schedDeepLink 4、s10DeepLink 5、ledgerDeepLink 8、importCenterDeepLink 6；既有文件新增：meterPeriodFlow 5、cpMeterFlow 2、elecCostFlow 2、salaryMonthGate 3、twoBooksRail 6、DataHomeView +2 = 合计 +43 → 2224 tests）；`npm run build` 绿，size-check index ≤ 191KB（预期不变：`useDeepPeriod` 从 ChainMonthGate 块升成独立共享块，仍只被懒加载屏 import）。**若 index 超线**：先 `grep -l 地址栏要求 dist/assets/*.js`（标识符被 esbuild 压掉，文案字符串才留得住；今天它落在 `ChainMonthGate-*.js`）看 useDeepPeriod 落到了哪个块、是否进了 index，再查是哪条 index 级 import 拖进来的 —— 应当没有；仍超则停下写清原因，不签字上调。

- [ ] **Step 2: spec 口径随裁定**

`docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md`：
- 头行「P1、P4 已在分支 … 实施」改为「P1、P4、P0a、P0b 已在分支 … 实施」。
- §4.2 第四条里「附10 `co` = 期区 1..4，`apply` 先置期再置册（避开 `S10View.selectBook → goGate`）」改为「附10 `co` = 期区 1..4，`apply` 直写 `activeBookId` 不经 `selectBook`（P0b 实测：`selectBook` 不在深链路径上，它在表格态末行 `goGate`）；台账没给 `co` 落当前册 / 首册（P0b 裁定，公司 chips 随 P2）；台账 / 附10 的 apply 是异步的（先等 books）」；同条末尾补「`extra.mode` / `extra.tab` 只在首载认（首页行走 openFresh）；apply 后紧跟 `onReactivated` 重读（先改期后重读），有草稿不重读当前期」。
- §12「附10 换期区仍撞 `S10View.selectBook → goGate`，… P0b 实测前按多 2 击计」改为「附10 期区深链直写 `activeBookId`，不经 `selectBook`，不撞 `goGate`（P0b 实测，`s10DeepLink.spec` 钉住）」；「无 `onReactivated` 的 8 张附表屏，P0b 必须补重读」改为「8 张附表屏 + 台账月表的切回重读 P0b 已补（有草稿不重读当前期）」。
随复查记录一起 `git add` 提交。

- [ ] **Step 3: 对抗复查（三镜头 → 逐条反驳）**

镜头：① 正确性 —— 11 屏首载取数次数（尤其台账 / 附10 的 `ensureLoaded` 与 `templateAt` 一次）、切回改期与各屏重读的先后、只有年的链接在认整月的屏上零副作用、旧链（`?company=` / `?phase=` / `?tenant=`）五处发链侧仍落得到、`extra.mode` 在 `mode='meter'` 时不白拉年表、`ElecCostView` 按月锁在编辑态被深链换月时 `useEditMode.scopeWhileEditing` 的行为、导入中心 co 不在名单时的兜底；② 护栏 —— 六份补桩 spec 的既有断言零改动、`meterPeriodGate` / `twoBooksRail` / `schedHeader` / `noInteractionLayoutShift` 是否被绕过、破坏验证是否逐条做了、`utils/deepLink.ts` 变成零生产消费方（裁定：留到 P0c）、`ImportResultToast` 17 个消费方零变化；③ 用户价值 —— 首页台账行落首册是否符合「本月台账」的直觉、年表屏切回重读会不会把用户正看的 type / cat / phase 筛选清掉（`refresh` 走 `load(year)` 不经 `onPickYear`，筛选应保留）、「去查看」按钮与「知道了」的主次、page toast 与 FPLockDialogs 同位。每条发现三名反驳者；坐实的进一次修复波 + 定向复审。

- [ ] **Step 4-5: 复查记录 + 提交**

本文件末尾追加「## 复查记录」并提交 `docs(plan): P0b 复查记录`；更新 memory `sidebar-ux-redesign-2026-09.md`（P0b 已实施，下一期 P0c）。

---

## 自查（对 spec §4.2 / §5.1 / §9 P0b / §10 / §12）

- §4.2 运营账三屏 `screenPeriod.pick`：Task 1（经 `useMonthGate.pick`）✓；台账 `co` 落 `activeBookId` + `year/month` 直落宽表：Task 5 ✓；附10 `co` = 期区、不撞 `goGate`：Task 4（直写 activeBookId，裁定改口径写进 Task 8 Step 2）✓；年表屏 `p` 只取年：Task 3（`current` 报 `periodOf(year, null)`，首页发 `periodOf(p.year, null)`）✓；导入中心 `p` 预填表单、接 `useRoute`：Task 6 ✓；附12：Task 2 ✓。
- §5.1 附13/14 `extra.tab`、附6/7/8/11 `extra.mode=summary` 随目标屏一起加：Task 3（目标屏读）+ Task 7（首页发）✓；「覆盖 localStorage 记住的运营账模式」= 初值盖过、不写回（裁定）✓。
- §9 P0b 价值「附表行各省一次门」：Task 7 发链 + Task 1-5 目标屏 ✓；「导后去查看」：Task 6（台账 / 附10 / 附12 三类，裁定）✓；破坏验证「附10 chip 深链不撞 goGate」：Task 4 用例 1 红线① ✓。
- §10：六份既有 spec 只补桩、断言不动 ✓；`monthTemplate` / `archivedCols` / `ledgerLeaveAndReturn` 桩已有、断言不动 ✓；`utils/deepLink.spec` 旧用例照旧 ✓。
- §12 8 张附表屏补重读：附10（T4）/ 附6·7·8·11·13·14（T3）/ 附12（T2）/ 分栋抄表 · 电费成本（T1）= 8 ✓ + 台账月表（T5，裁定）；「有草稿不重读当前期」附10 / 台账 ✓。
- 类型一致：`DeepPeriod` / `periodOf` / `periodLink`（P0a）→ 各屏 `current().p` 形状：运营账 `gateYm`（`YYYY-MM`）、年表 `periodOf(year, null)`（`YYYY`）、附10 / 附12 / 台账 `periodOf(year, month)` ✓；`periodLink.co` 是 `number | 'all'`，导入中心传 `ctx.companyId` / `first.phase`（number | undefined）✓；`ImportResultToast.go?: string` 与 `:go="viewTo ? '去查看' : undefined"` ✓；`scheduleLink` 返回 `{ path, query } | null`，`router.push(link ?? '/' + v)` ✓。
- 无占位：每个 Step 都有代码 / 命令 / 期望；每条新断言都写了红线。

## 复查记录（2026-09-04）

**计划级对抗复查**（实施前，3 镜头 → 每条 3 名反驳者，opus，39 agents）：12 条发现，7 坐实（去重 4 件）、5 被驳。坐实修入计划（53a042d）：twoBooksRail 用例 4 的 pending 桩卡死 `refresh()`（先 await load 再 reloadOverview）→ 改 `mockResolvedValue(null)`（P0B-1）；附12 的 onDeactivated 切走即关浮层、dirty 探针恒 0 → 不传 dirty、删用例（P0B-2）；「年表屏 current 只报年」无靶子（fullPath 去重挡住手工确认）→ 加用例 6（变键不变期只有 refresh 一趟）；`focusTenant` 被子表即时清空 + jsdom 无 `scrollIntoView` → 改断言 `emitted('focusDone' / 'focus-done')` + 桩。顺手：size-check 的 grep 改查文案字符串（标识符被压掉）；两处行号。被驳：异步 apply 的「先改期后重读」（机制属实、一次废请求，纳入代码复查镜头）；行号偏移（锚点文本为准）；「与 Task N 同款」（复查前已内联）；ElecCostView toast 锚点（toast 随裁定撤了）。

**任务级评审**（每任务一次，独立评审员 opus；实施者 sonnet）

| 任务 | 提交 | 结果 |
|---|---|---|
| T1 运营账三屏 | 66242f9 → 修复轮 363ec37 | Spec ✅；质量首轮 not approved：分栋抄表 / 分桩明细的 dirty 闸在产品里永远 0 —— 行草稿只能在抽屉里产生，onDeactivated 清 `openSt` → `watch(openSt, cancelForm)` 清 `adding`（计划复查的反驳者漏看了这一跳；评审员 `vm.openSt = STATIONS[0]` 一行探针即红）→ 裁定与附12 同口径不传 dirty、不加提示，两条用例改钉真实行为（红线 = 删 onDeactivated 的 openSt 清理）。复审 approved（评审员删 openSt 清理 → 4 红：2 新 + 2 既有抽屉用例，重叠接受） |
| T2 附表12 | a3d2d7c | 通过；备注：切回带新 p 拉两趟 records（apply + 重读，seq 丢弃；同 P0a 链屏形状，若收敛改在 composable 一处）；重读失败经 loadMonth catch 退编辑态 + 还锁（既有契约）；「只有年不动」用例钉的是「不许落月」（`t.month ?? 1` 即红） |
| T3 年表四屏 | d39d13d | 通过；4 minor：切回换年双拉（同上）；ElecView 注释 `summary|meter`（→ 修复波）；四屏缺 onDeactivated 收浮层是既有缺口、dirty 闸建立在它之上（→ 遗留）；twoBooksRail 在 T1/T2 窗口红（门禁刻意排除） |
| T4 附表10 | 03bdedb | 通过；4 minor（皆与计划冲突）：「同一拍连写 → templateAt 一次」注释与断言不符（首拍 year null 早退 → 修复波改口径）；切回换期先按旧期拉一趟（接受）；指名期区不存在静默落错册（→ 修复波加守卫 + 用例）；`current().co = phase` 与旧链 `t.co = null` 永不相同（只在变键切回多一次重载，接受） |
| T5 台账 | 160b92f → 修复轮 8c4b15e | Spec ✅；质量首轮 not approved：用例 1 注释声称的「分两拍写 → templateAt 两次」从 null 起步钉不住（评审员插 `await nextTick` 7 条全绿）→ 加用例 8（已落定状态下切回换年，templateAt 恰一次且 (2, 2025, 3)）；`loadGateYears().then(loadOverviews)` 缺 catch → 补；`bookOf('all')` 落当前册 / 首册补注。复审 approved；info：用例 8 可用 `toHaveBeenLastCalledWith`（→ 修复波）；深链首落时 years 失败 gateYears 停 null（既有） |
| T6 导入中心 | 718f23b | 通过；5 minor：报告 ① 因果写反（只 openImport 那处有护栏）；lf 初值只解析年月（→ 注释）；产出方须 openFresh（→ 注释）；多段导入只取第一段（brief 明文，接受）；`?p=YYYY` 拼出「深链年 + 时钟月」（→ 修复波不预填） |
| T7 首页发链 | 64c956c | 通过；遗留：`MONTH_ROWS` / `YEAR_ROWS` 是后端 monthly / yearly 的手抄本，9 行只钉 4 行（下期表驱动断言）；tag `'附14'` 前后端字面量耦合、无后端测试钉 (name, tag, go) |

**代码级对抗复查**（整分支 4cd3cf5..64c956c，3 镜头 → 每条 3 名反驳者，opus，30 agents）：9 条发现，3 坐实（全部 3/3），6 被驳。

| # | 发现 | 处置 |
|---|---|---|
| C1 正确性 | 台账旧链 `?company=<公司名>` → 册 的字符串分支全仓零护栏：用例用的「甲公司」恰是 `books[0]`，删掉整段分支 8/8 仍绿；6 处在产发链方（分析层 5 + 收入核对）靠它落册，回归即静默落到另一家公司同月台账 | **坐实** → 修复波：用例改用非首册（乙公司 → `month(12, …)`）+ 加「册名兜底」用例（丙册 → `month(15, …)`） |
| C2 护栏 | 附7·8 / 附11 / 附13·14 的切回重读一条红线都没有（三屏 `onReactivated` 改 `void 0`，367 条全绿） | **坐实** → 修复波：schedDeepLink 加三条 keptAlive 用例（records 必须 `mockResolvedValue(null)`，与 P0B-1 同坑） |
| C3 用户价值 | 台账整册多段导入后「去查看」按表单里的公司 / 月发链，而各段入库的是自己识别出的公司 / 月 → 用户被送去可能一行都没有的册与期 | **坐实** → 修复波：ledger 分支加 `!first?.records`（段模式不给按钮）+ 用例 |
| 其余 | R2 `void ensureLoaded()` 未捕获（Vue 的 async 钩子本来也不兜，applyDeep 已 catch）/ R3 换册不清 gateYears（不可达）/ R4 年表四屏无条件 refresh 与「有草稿不重读」相悖（计划已把该规则限定在附10 / 台账）/ 两条「覆盖缺口非缺陷」（mode 门未钉：同族抽样约定；附10 切回 apply 路径：开关在 composable 共用）/ R0 备查 | 被驳 |

修复波 f486611（C1 / C2 / C3 + 各任务留下的小项：ElecView 注释、附10 指名期区不存在不落错册 + 用例、两处「同一拍」注释口径、导入中心 `?p=YYYY` 不预填 + 用例 + 两处注释、台账用例 8 `toHaveBeenLastCalledWith`），定向复审 approved：三条坐实项各自重做探针精确命中；实施者报告里「附10 红线只见门消失」是 fail-fast 误读，实测 `getMonth(1, 2026, 9)` 同时被调；一处用例标题笔误（`?p=2025` 应为 2024）随本记录一起改。复查纪律：反驳者的在飞探针（LedgerView / S10 / importCenter 三处）结束时均已还原；两次 EOL-only 残留（DataHomeView.vue、importCenterDeepLink.spec.ts）由控制者按 blob hash 一致确认后恢复 CRLF。

**门禁**：全量 vitest 190 files / 2231 tests（基线 186 / 2181；+4 文件 / +50 = 计划 +43 + 修复波 +7）；`npm run build` 绿，size-check index 189.4KB / 191（基线 189.2），合计 3877.7 / 3900；`useDeepPeriod` 从 ChainMonthGate 块独立成 0.73KB 共享块（预判成立）。后端零改动。`useDeepPeriod.ts` / `utils/deepLink.ts` 承诺不改，零 diff。

**遗留（后续期）**：P0c 迁分析层 9 处 + 收入核对旧发链后删 `utils/deepLink.ts`（零生产消费方）与 ChurnView / FinCashflowView / ReconWorkbench 三处过时注释（「LedgerView 只在 onMounted 消费 query」）；年表四屏（附6 / 7·8 / 11 / 13·14）缺 onDeactivated 收浮层（既有缺陷，dirty 闸建立在它之上 —— 决定跟 SalaryView 走还是保留）；首页 9 行 go 值的表驱动断言 + 后端 (name, tag, go) 三元组快照；切回换期「先按旧期拉一趟」若要收敛改在 `useDeepPeriod` 一处；导入中心 `?p=YYYY` 连 co 也丢（当前无产出方）；page toast 与 okMsg / FPLockDialogs 同位（P0a 遗留照旧）；浏览器人工走查（首页 9 行各落点、导入中心「去查看」、切页签回来表是否刷新）由用户做。
