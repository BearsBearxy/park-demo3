# 失锁/接管弹窗覆盖到 7 个屏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 7 个屏在「别人占着锁」时能弹出接管抽屉、在「编辑中被接管」时能弹出失锁提示，不再两种情况都静默。

**Architecture:** 病根是 `useEditMode` 产出的 `lockedBy` / `evictedBy` 两个 ref 这 7 个屏一个都没接。给 `useEditMode` 补两个出口（`lockScope` / `onTaken`），新增一个只管这两个弹窗的共享件 `FPLockDialogs.vue`，7 个屏各接一行。**不动**已经工作的 `SchedHeader` 与各屏已有的 `FPElevateDialog`。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript strict + Pinia / Vitest + @vue/test-utils

**Spec:** `docs/superpowers/specs/2026-08-30-lock-dialogs-coverage-design.md`

## Global Constraints

- **不要接管道跑测试。** `npx vitest run 2>&1 | tail` 的退出码取自 `tail`（恒 0），会把红报成绿。直接跑，或读完整输出 grep `Failed Tests` / `passed`。见 `docs/design/IMPORT-GUIDE.md:59`；本项目 2026-08-30 阶段性验收时又踩中一次。
- **前端测试**：cwd = `frontend`，`npx vitest run <路径>`。类型闸 `npm run build`（含 vue-tsc 实跑）。
- **每条新断言必须做破坏验证**：改坏对应的 production 那一行 → **只有那一条**转红。前置不足的断言等于假绿，本项目栽过三次。
- **`FPEvictedDialog` 是 `Teleport to body`**（`FPEvictedDialog.vue:49`）。测它必须 `global: { stubs: { teleport: true } }`，否则 `wrapper.find` 一定找不到。`FPTakeoverDrawer` 不是 Teleport，无需桩。
- **锁 API 必须 mock**：不 mock 时 `locksApi` 走真 axios，jsdom 里抛错 → 被「拿不准就不进」兜住 → 一切走 `toggle`/`enter` 的路径全挂。照 `cpMeterFlow.spec.ts:34-44` 的写法。
- **不动** `FPEditModeButton` 的 `:disabled`，不动 7 屏传的禁用条件。按钮**本来就该可点** —— 点了 acquire 失败才让接管抽屉弹出来。
- **不动** `SchedHeader.vue`、各屏已有的 `FPElevateDialog`、`PayBookWindow.vue`（无锁，不受影响）。
- **不新建补零工具**。三个月粒度屏已有 `ym` computed，ElecCost 已有内联 `String(month).padStart(2, '0')`。

---

## 文件结构

**新建**

| 文件 | 职责 |
|---|---|
| `frontend/src/components/fp/FPLockDialogs.vue` | 只挂 `FPTakeoverDrawer` + `FPEvictedDialog` 两个弹窗，透传 scope，把两个 close 递回给屏 |
| `frontend/src/components/fp/__tests__/fpLockDialogs.spec.ts` | 共享件自身的两条断言 |
| `frontend/src/views/__tests__/lockDialogsCoverage.spec.ts` | 表驱动结构断言：7 个屏都接上了（以后加屏加一行） |

**修改**

| 文件 | 改什么 |
|---|---|
| `frontend/src/composables/useEditMode.ts` | return 面加 `lockScope` 与 `onTaken`；新增 `onTaken()` 实现 |
| `frontend/src/composables/__tests__/useEditMode.spec.ts` | 加两条（`lockScope` 逐字、`onTaken` 继承换期守卫） |
| 7 个屏（见 Task 3–9） | 解构追加 4 项 + 模板加一行 |
| `frontend/src/views/__tests__/meterPeriodFlow.spec.ts` | 加行为层两条（PvMeterView 真 mount） |

---

## Task 1: `useEditMode` 补 `lockScope` 与 `onTaken`

**Files:**
- Modify: `frontend/src/composables/useEditMode.ts`（`enter()` 定义之后、`return` 之前加 `onTaken`；:217 的 return 面加两项）
- Test: `frontend/src/composables/__tests__/useEditMode.spec.ts`

**Interfaces:**
- Consumes: 无（本任务是根）
- Produces: `useEditMode(...)` 的 return 面新增两项，Task 2–9 全部依赖：
  - `lockScope: () => string | null` —— 返回 `opts.scope?.() ?? null`
  - `onTaken: () => Promise<void>` —— 清 `lockedBy` 后走私有的 `enter()`

- [ ] **Step 1: 先读现状，确认插入点**

读 `frontend/src/composables/useEditMode.ts`，确认三件事：
1. `enter()` 是本文件内的私有 async 函数（约 :113–129），末尾是 `editMode.value = true`
2. `enter()` 里有两道守卫：`entering` 重入闸、占锁往返后的 `if ((opts.scope?.() ?? null) !== scope) { lock.release(); return }`
3. return 面在 :217，形如 `return { editMode, canEnter, missing, asking, lockedBy, evictedBy, heldByOther, toggle, askFor, cancelAsk, onElevated, exit }`

- [ ] **Step 2: 写失败测试**

追加到 `frontend/src/composables/__tests__/useEditMode.spec.ts`（**该文件已存在**，复用它顶部现成的 import 与 `@/api/locks` mock，不要另起一套）：

```ts
describe('lockScope / onTaken(接管闭环)', () => {
  it('❗lockScope() 与传入的 opts.scope() 逐字相同 —— 屏不必再写一遍表达式', () => {
    const year = ref(2025)
    const em = useEditMode(['meter-reading:edit'], { scope: () => `pv-meter:${year.value}` })
    expect(em.lockScope()).toBe('pv-meter:2025')
    year.value = 2026
    expect(em.lockScope(), '期变了要跟着变 —— 固化就会去接一把不是本屏握着的锁').toBe('pv-meter:2026')
  })

  it('❗onTaken() 走 enter():占锁往返中期变了 → 还锁且不进编辑态', async () => {
    // 这条守的是「复用 enter() 而不是另写一段 acquire」。另写一段就把换期复核摘掉了。
    const year = ref(2025)
    const em = useEditMode(['meter-reading:edit'], { scope: () => `pv-meter:${year.value}` })
    vi.mocked(locksApi.acquire).mockImplementation(async () => {
      year.value = 2026                      // 往返途中用户换了期
      return { granted: true, holder: null, acquiredAt: 1 }
    })
    await em.onTaken()
    expect(em.editMode.value, '期已经变了,不该留在编辑态').toBe(false)
    expect(locksApi.release).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 跑测试确认它红**

Run: `cd frontend && npx vitest run src/composables/__tests__/useEditMode.spec.ts`
Expected: FAIL —— `em.lockScope is not a function` / `em.onTaken is not a function`

- [ ] **Step 4: 实现**

在 `useEditMode.ts` 的 `enter()` 之后插入：

```ts
  /** 本屏这一期的锁作用域。暴露出去是为了让接管抽屉接同一把锁 ——
   *  让屏自己再写一遍 `S.pvMeter(year.value)` 必然漂移,漂移的后果是去接一把别的锁。 */
  const lockScope = () => opts.scope?.() ?? null

  /**
   * 接管成功后的闭环(语义照 SchedHeader.vue:124-128)。
   *
   * ⚠ 必须复用私有的 `enter()`,不要另写一段 acquire —— `enter()` 里的
   *   `entering` 重入闸与「占锁往返期间换了期就还锁」这两道守卫,另写一段就等于
   *   把它们从接管这条路上摘掉。
   *   FPTakeoverDrawer 在 emit `taken` 前已经调过 locksApi.takeover(),
   *   所以这里的 acquire 是重入(幂等,拿回 held 与心跳),与 SchedHeader 同形。
   */
  async function onTaken() {
    lockedBy.value = null
    await enter()
  }
```

把 return 面改成（只加两项，其余一字不动）：

```ts
  return { editMode, canEnter, missing, asking, lockedBy, evictedBy, heldByOther, toggle, askFor, cancelAsk, onElevated, exit, lockScope, onTaken }
```

- [ ] **Step 5: 跑测试确认它绿**

Run: `cd frontend && npx vitest run src/composables/__tests__/useEditMode.spec.ts`
Expected: PASS

- [ ] **Step 6: 破坏验证**

把 `onTaken` 里的 `await enter()` 换成 `await lock.acquire(lockScope() ?? ''); editMode.value = true`（即绕开守卫），再跑一次：**第二条必须红**。确认后改回来。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/composables/useEditMode.ts frontend/src/composables/__tests__/useEditMode.spec.ts
git commit -m "feat(edit-mode): 补 lockScope/onTaken —— 接管闭环缺的两样"
```

---

## Task 2: 新增共享件 `FPLockDialogs.vue`

**Files:**
- Create: `frontend/src/components/fp/FPLockDialogs.vue`
- Create: `frontend/src/components/fp/__tests__/fpLockDialogs.spec.ts`

**Interfaces:**
- Consumes: `LockHolder` / `Eviction`（`@/api/locks`）；Task 1 的 `lockScope()` 返回值作为 `scope` 传入
- Produces: 组件 `FPLockDialogs`，Task 3–9 全部依赖：
  - props: `lockedBy: LockHolder | null`、`evictedBy: Eviction | null`、`scope: string | null`、`what: string`
  - emits: `taken: []`、`close-takeover: []`、`close-evicted: []`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/components/fp/__tests__/fpLockDialogs.spec.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import type { LockHolder } from '@/api/locks'

const holder: LockHolder = {
  user: 'lisi', displayName: '李四', heldMs: 60_000, idleMs: 1_000, idle: false,
}

// FPEvictedDialog 是 Teleport to body(FPEvictedDialog.vue:49) —— 不桩 teleport 一定找不到
const mk = (props: Record<string, unknown>) => mount(FPLockDialogs, {
  props: { lockedBy: null, evictedBy: null, scope: null, what: '公共电核算 2024-02', ...props },
  global: { stubs: { teleport: true } },
})

describe('FPLockDialogs', () => {
  it('❗lockedBy 非空 → 接管抽屉出现(这正是「按钮点了没反应」的解药)', () => {
    expect(mk({ lockedBy: holder, scope: 'billing-chain:2024-02' }).find('.tk-body').exists()).toBe(true)
  })

  it('❗scope 原样透传 —— 共占锁的 scopeNote 全靠它说出「一把锁管四个写面」', () => {
    const w = mk({ lockedBy: holder, scope: 'billing-chain:2024-02' })
    expect(w.findComponent({ name: 'FPTakeoverDrawer' }).props('scope')).toBe('billing-chain:2024-02')
  })

  it('❗evictedBy 非空 → 失锁弹窗出现(这正是「静默踢出」的解药)', () => {
    const w = mk({ evictedBy: { scope: 'pv-meter:2025', by: 'lisi', byDisplayName: '李四', authorizerName: null } })
    expect(w.find('.evd-scrim').exists()).toBe(true)
  })

  it('不传 dirtyCount/copyText → 不出复制块(本次范围:只做提示,不做复制)', () => {
    const w = mk({ evictedBy: { scope: 'pv-meter:2025', by: 'lisi', byDisplayName: '李四', authorizerName: null } })
    expect(w.find('.evd-scrim').exists(), '前提:弹窗开着').toBe(true)
    expect(w.find('.evd-draft').exists()).toBe(false)
  })

  it('两个都为 null → 什么都不渲染', () => {
    const w = mk({})
    expect(w.find('.tk-body').exists()).toBe(false)
    expect(w.find('.evd-scrim').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认它红**

Run: `cd frontend && npx vitest run src/components/fp/__tests__/fpLockDialogs.spec.ts`
Expected: FAIL —— 找不到 `@/components/fp/FPLockDialogs.vue`

- [ ] **Step 3: 实现组件**

新建 `frontend/src/components/fp/FPLockDialogs.vue`：

```vue
<script setup lang="ts">
/**
 * 编辑锁的两个弹窗:被别人占着时的**接管抽屉**、编辑中被踢时的**失锁提示**。
 *
 * 为什么是一个共享件而不是每屏各挂两个:2026-08-30 的阶段性验收查出 7 个屏
 * 两个都没挂 —— 病根正是「每屏各接一遍,漏了没人发现」。各挂两个就是把同一个病根再种七回。
 *
 * 不含 FPElevateDialog:那个 7 屏各自都有且工作正常,不去搅动能用的代码。
 * 不含 dirtyCount/copyText:四个有草稿态的屏序列化各不相同,单独立项(spec §4.2)。
 */
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import type { LockHolder, Eviction } from '@/api/locks'

defineProps<{
  /** 来自 useEditMode。非空 = 锁被别人占着 → 接管抽屉自动开 */
  lockedBy: LockHolder | null
  /** 来自 useEditMode。非空 = 本屏刚被接管 → 失锁弹窗自动开 */
  evictedBy: Eviction | null
  /** 来自 useEditMode 的 lockScope()。**原样透传** —— 共占锁的 scopeNote 靠它 */
  scope: string | null
  /** 给人看的一句话,如「公共电核算 2024-02」。取本屏 FPElevateDialog 的 :page 措辞 */
  what: string
}>()

defineEmits<{ taken: []; 'close-takeover': []; 'close-evicted': [] }>()
</script>

<template>
  <FPTakeoverDrawer :holder="lockedBy" :scope="scope ?? ''" :what="what"
                    @close="$emit('close-takeover')" @taken="$emit('taken')" />
  <FPEvictedDialog :eviction="evictedBy" :what="what"
                   @close="$emit('close-evicted')" />
</template>
```

- [ ] **Step 4: 跑测试确认它绿**

Run: `cd frontend && npx vitest run src/components/fp/__tests__/fpLockDialogs.spec.ts`
Expected: PASS（5 条）

若 `findComponent({ name: 'FPTakeoverDrawer' })` 拿不到，改用 `w.findComponent(FPTakeoverDrawer)`（直接 import 组件对象），不要为了让测试过而给组件加 `name` 选项。

- [ ] **Step 5: 破坏验证**

把模板里的 `:scope="scope ?? ''"` 改成 `:scope="''"` → **只有第 2 条**转红。确认后改回来。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/fp/FPLockDialogs.vue frontend/src/components/fp/__tests__/fpLockDialogs.spec.ts
git commit -m "feat(fp): FPLockDialogs —— 接管抽屉 + 失锁弹窗的共享挂点"
```

---

## Task 3: `PvMeterView` 接线（样板屏 + 行为层证明）

这一屏额外承担**行为层**证明：真 mount 一次，走通「acquire 被拒 → 接管抽屉出现」与「心跳带回 eviction → 失锁弹窗出现」。后 6 屏只做接线，由 Task 10 的结构断言守住。

**Files:**
- Modify: `frontend/src/views/pv/PvMeterView.vue`（:42 解构、:755 附近模板）
- Test: `frontend/src/views/__tests__/meterPeriodFlow.spec.ts`（该屏已有的 spec，追加一个 describe）

**Interfaces:**
- Consumes: Task 1 的 `lockScope` / `onTaken`；Task 2 的 `FPLockDialogs`
- Produces: 无（叶子任务）

- [ ] **Step 1: 写失败测试**

追加到 `frontend/src/views/__tests__/meterPeriodFlow.spec.ts` 末尾。**mock 与挂载 helper 复用该文件既有的**（不要另起一套）；只需在本 describe 里覆盖 `locksApi.acquire` 并补 teleport 桩：

```ts
describe('PvMeterView 锁弹窗接线(C1/C2)', () => {
  it('❗别人占着锁时点编辑 → 接管抽屉出现(改前:点了什么都不发生)', async () => {
    vi.mocked(locksApi.acquire).mockResolvedValue({
      granted: false,
      holder: { user: 'lisi', displayName: '李四', heldMs: 60_000, idleMs: 1_000, idle: false },
    } as never)
    const w = mount(PvMeterView, { global: { stubs: { teleport: true } } })
    await flushPromises()
    await w.find('.fp-emb').trigger('click')
    await flushPromises()
    expect(w.find('.tk-body').exists(), '接管抽屉必须开 —— 没有它按钮就是死的').toBe(true)
  })

  it('❗编辑中被接管 → 失锁弹窗出现(改前:编辑态就地消失,一个字都不说)', async () => {
    vi.mocked(locksApi.acquire).mockResolvedValue({ granted: true, holder: null, acquiredAt: 1 } as never)
    const w = mount(PvMeterView, { global: { stubs: { teleport: true } } })
    await flushPromises()
    await w.find('.fp-emb').trigger('click')
    await flushPromises()

    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'pv-meter:2025', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)
    const { usePresenceStore } = await import('@/stores/presence')
    await usePresenceStore().ping()
    await flushPromises()

    expect(w.find('.evd-scrim').exists(), '被踢了必须说一声').toBe(true)
  })
})
```

> ⚠ 两处可能要按该文件既有夹具微调：① `.fp-emb` 是 `FPEditModeButton` 的根 class（`FPEditModeButton.vue`），若该 spec 已有取按钮的 helper 就用它；② eviction 里的 `scope` 必须与该屏当前 `year` 算出的 `S.pvMeter(year)` 一致，否则通知派不回来 —— 用夹具里实际的年份，不要写死 2025。

- [ ] **Step 2: 跑测试确认它红**

Run: `cd frontend && npx vitest run src/views/__tests__/meterPeriodFlow.spec.ts -t "锁弹窗接线"`
Expected: FAIL —— 两条都找不到对应元素

- [ ] **Step 3: 改解构**

`frontend/src/views/pv/PvMeterView.vue:42`，在 `heldByOther` 后追加四项：

```js
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken } =
  useEditMode(['meter-master:edit', 'meter-reading:edit'], { scope: () => S.pvMeter(year.value) })
```

- [ ] **Step 4: 加 import 与模板**

`<script setup>` 里加：

```js
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
```

模板里紧挨已有的 `<FPElevateDialog .../>`（:755-756）之后加一行：

```vue
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`光伏分栋抄表 ${year} 年`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
```

- [ ] **Step 5: 跑测试确认它绿**

Run: `cd frontend && npx vitest run src/views/__tests__/meterPeriodFlow.spec.ts`
Expected: PASS（含该文件原有全部用例，不许有回归）

- [ ] **Step 6: 破坏验证**

把新加的那一行 `<FPLockDialogs>` 注释掉 → **只有新加的两条**转红，该文件原有用例全绿。确认后取消注释。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/views/pv/PvMeterView.vue frontend/src/views/__tests__/meterPeriodFlow.spec.ts
git commit -m "fix(pv): 接上接管抽屉与失锁弹窗 —— 按钮不再点了没反应,被踢不再无声"
```

---

## Task 4–9: 其余 6 屏接线

**六个任务同形**，每个都是三步：解构追加四项 → 加 import → 模板紧挨 `FPElevateDialog` 加一行。
**没有新测试**（结构由 Task 10 的表驱动断言统一守住，行为已由 Task 3 证明）。
每屏改完跑该屏已有的 spec 确认无回归，然后单独提交。

各屏参数表（`what` 取自本屏 `FPElevateDialog` 的 `:page` 措辞，去掉 `·`）：

| Task | 文件 | 解构行 | 模板锚点（`FPElevateDialog` 行） | `what` |
|---|---|---|---|---|
| 4 | `frontend/src/views/charging/CpMeterView.vue` | :51 | :766-767 | `` `充电桩分桩明细 ${year} 年` `` |
| 5 | `frontend/src/views/elec/ElecCostView.vue` | :45 | :767-768 | `` `电费成本总览 ${year}-${String(month).padStart(2, '0')}` `` |
| 6 | `frontend/src/views/meters/MeterView.vue` | :66 | :851-852 | `` `园区抄表 ${year} 年` `` |
| 7 | `frontend/src/views/alloc/PoolLedgerView.vue` | :83 | :934-935 | `` `公共电核算 ${ym}` `` |
| 8 | `frontend/src/views/bills/BillNoticesView.vue` | :77 | :1182-1183 | `` `催缴单 ${ym}` `` |
| 9 | `frontend/src/views/params/ParamCenterView.vue` | :65 | :811-812 | `` `计费参数 ${ym}` `` |

各 Task 的三步（把表里对应那行代入）：

- [ ] **Step 1: 解构追加四项**

在既有解构的**尾部**追加 `lockedBy, evictedBy, lockScope, onTaken`。

> ⚠ **Task 6（MeterView）的解构与其余五屏不同**，它是：
> ```js
> const { editMode, canEnter, missing: lockedPerms, asking, askFor, cancelAsk, onElevated,
>         exit: exitEdit, heldByOther, toggle } = useEditMode(...)
> ```
> 没有 `toggle: toggleEdit` 这个改名。**不要盲替换**，只在尾部追加四项。

- [ ] **Step 2: 加 import**

```js
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
```

- [ ] **Step 3: 模板紧挨 `FPElevateDialog` 加一行**

```vue
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="<表里的 what>"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
```

> Task 7/8/9 三屏的 `ym` 是本屏已有的 computed（就是它们 `FPElevateDialog` 的 `:page` 在用的那个），直接用，不要另算。

- [ ] **Step 4: 跑该屏已有 spec 确认无回归**

| Task | 命令（cwd = `frontend`） |
|---|---|
| 4 | `npx vitest run src/views/__tests__/cpMeterFlow.spec.ts` |
| 5 | `npx vitest run src/views/__tests__/elecCostFlow.spec.ts` |
| 6 | `npx vitest run src/views/__tests__/meterWriteGuards.spec.ts src/views/__tests__/meterPeriodGate.spec.ts` |
| 7 | `npx vitest run src/views/__tests__/poolWriteGuards.spec.ts` |
| 8 | `npx vitest run src/views/__tests__/billNoticeWriteGuards.spec.ts` |
| 9 | `npx vitest run src/views/params/__tests__/paramCenterView.spec.ts` |

Expected: PASS，且用例数与改动前一致。

- [ ] **Step 5: 提交**

```bash
git add <该屏文件>
git commit -m "fix(<模块>): 接上接管抽屉与失锁弹窗"
```

---

## Task 10: 表驱动结构断言 + 全量验证

守住「以后加屏别再漏」。照 `views/__tests__/exactPlaceholderScreens.spec.ts` 的表驱动理由与 `components/sched/__tests__/schedHeader.spec.ts:140-145` 的源码断言写法。

**Files:**
- Create: `frontend/src/views/__tests__/lockDialogsCoverage.spec.ts`

**Interfaces:**
- Consumes: Task 3–9 全部完成
- Produces: 无（终点）

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 「7 个屏都接上了锁弹窗」的结构证明 —— 一份守七屏。
 *
 * 为什么是源码断言而不是七次真 mount:这七屏各自要十几个 API mock
 * (见 cpMeterFlow.spec.ts:24-44),七份堆一起没法维护,而这里要守的不是行为
 * (行为已由 meterPeriodFlow.spec.ts 的两条真 mount 证明),是**别漏**。
 * 表驱动的理由同 exactPlaceholderScreens.spec.ts:「改法一模一样,各写一份必然长歪」。
 *
 * 2026-08-30 阶段性验收查出的病根就是「每屏各接一遍,漏了没人发现」——
 * 以后再有屏接 useEditMode + scope,在下表加一行即可。
 */
const SCREENS = [
  '../pv/PvMeterView.vue',
  '../charging/CpMeterView.vue',
  '../elec/ElecCostView.vue',
  '../meters/MeterView.vue',
  '../alloc/PoolLedgerView.vue',
  '../bills/BillNoticesView.vue',
  '../params/ParamCenterView.vue',
]

describe('锁弹窗覆盖度(C1/C2 不回潮)', () => {
  for (const rel of SCREENS) {
    it(`❗${rel} 接上了 FPLockDialogs 且四个绑定齐`, () => {
      const s = readFileSync(join(__dirname, rel), 'utf8')
      expect(s.includes('<FPLockDialogs'), `${rel} 没挂 FPLockDialogs —— 别人占锁时按钮是死的`).toBe(true)
      expect(/:locked-by="lockedBy"/.test(s), `${rel} 没绑 locked-by —— 接管抽屉永远不开`).toBe(true)
      expect(/:evicted-by="evictedBy"/.test(s), `${rel} 没绑 evicted-by —— 被踢时静默`).toBe(true)
      expect(/:scope="lockScope\(\)"/.test(s), `${rel} 没透传 scope —— 共占锁那句话说不出来`).toBe(true)
      expect(/@taken="onTaken"/.test(s), `${rel} 没接 taken —— 接管成功后进不了编辑态`).toBe(true)
    })

    it(`❗${rel} 的解构取了这四项`, () => {
      const s = readFileSync(join(__dirname, rel), 'utf8')
      for (const k of ['lockedBy', 'evictedBy', 'lockScope', 'onTaken']) {
        expect(new RegExp(`\\b${k}\\b`).test(s), `${rel} 解构里没有 ${k}`).toBe(true)
      }
    })
  }
})
```

- [ ] **Step 2: 跑测试确认它绿（14 条）**

Run: `cd frontend && npx vitest run src/views/__tests__/lockDialogsCoverage.spec.ts`
Expected: PASS（7 屏 × 2 条）

- [ ] **Step 3: 破坏验证**

把 `PoolLedgerView.vue` 里新加的 `<FPLockDialogs>` 那一行注释掉 → **只有该屏那两条**转红，另外六屏全绿。确认后取消注释。

- [ ] **Step 4: 全量测试**

Run: `cd frontend && npx vitest run`
Expected: 全绿。**不要接管道**（Global Constraints 第一条）。读输出里的 `Test Files` / `Tests` 两行确认 0 failed。

> 已知：`src/utils/billNoticeExcel.spec.ts` 在冷跑并发下可能 30s 超时（单跑 551ms 通过）。若只有它红，单独重跑一次确认，并在提交说明里注明它与本次改动无关。

- [ ] **Step 5: 类型闸与构建**

Run: `cd frontend && npm run build`
Expected: PASS（含 vue-tsc 类型检查 + 体积预算 `scripts/size-check.mjs`）

> 体积预算：新增一个共享件、7 屏各多一行，首屏块理论上只多几百字节。若预算被压破，**不要直接调预算数字** —— 先看是不是把 `FPLockDialogs` 静态 import 进了不该进的地方。预算上调在本仓是一次署名决定（见 `size-check.mjs` 里历次记录）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/views/__tests__/lockDialogsCoverage.spec.ts
git commit -m "test(locks): 7 屏锁弹窗覆盖度的表驱动结构断言 —— 以后加屏加一行"
```

---

## 完工验收（对照 spec §6）

- [ ] 7 个屏：别人占锁时点编辑按钮 → 弹出接管抽屉
- [ ] 7 个屏：编辑中被接管 → 弹出失锁提示
- [ ] 5/6/7 三屏（PoolLedger / BillNotices / ParamCenter）的接管抽屉里能看到「一把锁管四个写面」那句话
- [ ] `npx vitest run` 全绿（不接管道）
- [ ] `npm run build` 过
- [ ] 未动 `SchedHeader.vue`、未动各屏 `FPElevateDialog`、未动 `FPEditModeButton` 的 `:disabled`、未碰 `PayBookWindow.vue`
