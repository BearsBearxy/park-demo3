# R2 审核机制前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 R1 已经落库的审核态接到屏上 —— 已审核 / 待审核的表进不了编辑模式，清单行看得见审核态并能交审 / 通过 / 退回 / 撤销，审核员有队列，录入方知道被退回了。

**Architecture:** 一份按月缓存的 `stores/review.ts` 喂三个消费方：① 两条编辑闸（`useEditMode` 与 `SchedHeader`，全站仅此两处持编辑态）② 本月出账屏的两栏清单与审核条 ③ 铃铛。后端只补两件 R1 没发的数据：整月锁账的月集合、被退回的条数。

**Tech Stack:** Vue 3 + TS + Pinia + vitest（前端主体）；Spring Boot 3.3.5 + MyBatis-Plus（两个小端点）。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §7.5（前端）+ §7.4 里划给 R2 的两句（通知字段、R1/R2 边界）

---

## Global Constraints

- **零布局位移**（§8.1 / LAYOUT-STABILITY-SPEC）：药丸与编辑按钮同宽（`min-width:150px`）；审核态列是常驻 `<span>`，不 `v-if` 掉；审核条沿用主管条的 32px 定高，零待审仍占位。
- **计数与屏内同源**（§12，假绿栽过三次）：屏上任何「n/总」都从渲染出来的 rows 算，不抄后端另一个数。
- **一次一屏 + 对抗复查 + 逐条破坏验证**（memory `sabotage-verification-cadence`）：每条新断言都要证明「把逻辑改坏它会红」；杀不掉的断言写明理由，不许伪造。
- **错误口径**：后端 `BizException` → HTTP 200 + `body.code`。`423` = 这张表本月已审 / 待审；`409` = 上游前置未满。前端必须**分开显示**，合成一句就分不出「去催上游」和「去找审核员撤销」。
- **审核键格式** `kind[:scope]:period`，`period` 恒 `YYYY-MM`，`kind` 白名单是后端 `ReviewKind` 的 14 个 code。解析**从右切**（kind 含连字符不含冒号）。
- **不做**（§11）：单元格级批注、两级审核、审核时限与逾期提醒、收入核对与报表层进审核、审核态进页签标题。

---

## 拍板与偏离（执行中新增的追加在末尾）

| 编号 | 内容 |
|---|---|
| **D-R2-1** | **闸落在 `useEditMode.enter()`，不是 spec 写的 `toggle()`。** `toggle` / `onElevated`（主管授权后）/ `onTaken`（接管后）三条路都汇进 `enter()`；只挂 `toggle` 的话，叫主管授权进来的人和接管进来的人照样能改已审核的表。深链（`?edit=1` 直接写 `editMode.value = true`）不过 `enter()`，用与既有 `watch([editMode, missing])` 同款的守卫兜底。 |
| **D-R2-2** | **闸有两条路，spec §7.5 只写了一条。** `SchedHeader.vue` 头注写明「本组件不走 `useEditMode` —— 编辑态由 7 个消费屏各自持有」，它自己接了一份 `useEditLock`。附表族 6 屏（附6/7/8/10/11/12/13/14）的编辑按钮全在这里。只改 `useEditMode` 等于放过一半的审核键。 |
| **D-R2-3** | **药丸只有两处。** 全站编辑按钮只有 `FPEditModeButton.vue`（自称「全站唯一的一份」，实际是 `useEditMode` 那 10 屏用）与 `SchedHeader.vue` 内联的那颗。两处各加一次，不是 12 屏各加一次。 |
| **D-R2-4** | **退回提醒零迁移；撤销不发提醒。** 「我交的表被退回了」= `review_state WHERE submitted_by=me AND status='returned'` 一条 count，自清（重新交审 status 转 submitted）。撤销做不到：`withdraw` 是**删行**（`ReviewService.withdraw` 头注：不留 returned，理由留在 `review_log`），`submitted_by` 随行消失。要发就得加列或加「每人已读位」，超出 R2 该付的代价 —— 记进 §12 边界。 |
| **D-R2-5** | **月格 ✓ 走第 5 个 `/months` 型端点。** `billingPeriod.fetchAll()` 已经并发拉 4 个 `/months`，加第 5 个 `GET /api/review/closed-months` 是最短的接法。后端先用一条 group-by 找「已审核键数 ≥ 12」的候选月，只对候选月跑 `keysOf` 全集比对 —— 否则要为窗口内每个月各跑一遍 `dataHome.overview()`（十几条 count 查询 × 48 个月）。 |
| **D-R2-6** | **store 按月一份，编辑闸也走它。** 编辑闸要的是单键，但全月一趟（~20 键）比逐键 N 趟便宜，且屏切回来能命中缓存。四个动作之后失效当月。 |

---

## File Structure

**新建（前端）**
- `frontend/src/types/review.ts` — `ReviewRow` / `ReviewStatus` / `parseReviewKey`
- `frontend/src/api/review.ts` — 五个端点
- `frontend/src/stores/review.ts` — 按月缓存 + 失效 + 单键查询
- `frontend/src/components/fp/FPReviewDialog.vue` — 退回 / 撤销的理由弹卡
- `frontend/src/stores/__tests__/review.spec.ts`
- `frontend/src/views/__tests__/reviewGateCoverage.spec.ts` — 源码门禁：14 个 kind 每个都有屏声明
- `frontend/src/components/fp/__tests__/reviewDialog.spec.ts`

**改（前端）**
- `composables/useEditMode.ts` — `opts.reviewKey` + 闸 + 守卫
- `components/sched/SchedHeader.vue` — 同形第二条路
- `components/fp/FPEditModeButton.vue` — `reviewNote` 药丸
- 12 个消费屏 — 各声明自己的 `reviewKey`
- `views/data-home/monthClose.logic.ts` — `review` 真值化 + 本月锁账派生
- `views/data-home/DataHomeView.vue` — 审核态列 + 行动作 + 审核条
- `stores/presence.ts` — 收 `pendingReviews` / `myReturned`
- `stores/billingPeriod.ts` — `ChainCell.closed`
- `components/shell/Toolbar.vue` / `mobile/MobileTopBar.vue` — 铃铛计数并入
- `components/fp/FPApprovalDrawer.vue` — 「待审核」段
- `components/fp/BookMonthMatrix.vue` — 月格 ✓
- `views/system/SystemLogsView.vue` + `types/system.ts` — 日志第 4 路的 4 处展示

**改（后端，两件小的）**
- `controller/ReviewController.java` — `GET /api/review/closed-months?from=&to=`
- `service/ReviewService.java` — `closedMonths()` + `returnedCount(user)`
- `dto/PresenceDtos.java` + `service/PresenceService.java` — `PingResp` 第 6 件事 `myReturned`

---

# 任务

## Task 1: 契约层 —— types / api / store

**Files:**
- Create: `frontend/src/types/review.ts`, `frontend/src/api/review.ts`, `frontend/src/stores/review.ts`
- Test: `frontend/src/stores/__tests__/review.spec.ts`

**Interfaces:**
- Produces: `ReviewStatus`、`ReviewRow`、`parseReviewKey(raw)`、`reviewApi`、`useReviewStore()` 的 `ensure(period)` / `rowOf(key)` / `rowsOf(period)` / `invalidate(period)` / `submit|approve|returnBack|withdraw(key, reason?)`

- [ ] **Step 1: `types/review.ts`**

```ts
// 审核态的前端契约（SIDEBAR-UX-REDESIGN §7.1 / §7.4）。后端 ReviewRowDTO 的镜像。
export type ReviewStatus = 'entered' | 'submitted' | 'approved' | 'returned'

/** 两个锁态。`returned` 的可编辑性等同 `entered`（§7.2：只是留痕）。 */
export const LOCKING: readonly ReviewStatus[] = ['submitted', 'approved']

export interface ReviewRow {
  key: string
  kind: string
  scope: string | null
  status: ReviewStatus
  submittedBy: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reason: string | null
  /** 通过前置缺的上游人话名。没有前置或已满足时是**空数组不是 null**（后端保证）。 */
  blockedBy: string[]
}

/**
 * `kind[:scope]:period` → 三段。**从右切**：kind 里有连字符（`alloc-loss` / `charging-car`）
 * 但没有冒号，period 恒是最后一段，scope 是中间可选的一段。
 * 与后端 `ReviewKey.parse` 用 `lastIndexOf` 同一条理由。
 */
export function parseReviewKey(raw: string): { kind: string; scope: string | null; period: string } | null {
  const i = raw.lastIndexOf(':')
  if (i < 0) return null
  const period = raw.slice(i + 1)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null
  const head = raw.slice(0, i)
  const j = head.lastIndexOf(':')
  return j < 0
    ? { kind: head, scope: null, period }
    : { kind: head.slice(0, j), scope: head.slice(j + 1), period }
}
```

- [ ] **Step 2: `api/review.ts`**

```ts
import api from '@/api'
import type { ReviewRow } from '@/types/review'

export const reviewApi = {
  list: (period: string) => api.get<ReviewRow[]>('/review', { params: { period } }),
  submit: (key: string) => api.post<void>(`/review/${encodeURIComponent(key)}/submit`),
  approve: (key: string) => api.post<void>(`/review/${encodeURIComponent(key)}/approve`),
  returnBack: (key: string, reason: string) => api.post<void>(`/review/${encodeURIComponent(key)}/return`, { reason }),
  withdraw: (key: string, reason: string) => api.post<void>(`/review/${encodeURIComponent(key)}/withdraw`, { reason }),
  /** 整月全审的月集合（D-R2-5）。矩阵月格的 ✓ 靠它。 */
  closedMonths: () => api.get<string[]>('/review/closed-months'),
}
```

⚠ `encodeURIComponent` 是必须的：键里带冒号（`ledger:7:2024-02`），冒号在 path segment 里合法，但 `s10:一期:...` 这类将来要是出现非 ASCII scope 就会炸。后端 `@PathVariable` 收的是解码后的值，两边对得上。

- [ ] **Step 3: `stores/review.ts`**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { reviewApi } from '@/api/review'
import { parseReviewKey, type ReviewRow } from '@/types/review'

/**
 * 审核态（§7.5）。**按月一份**缓存 —— 编辑闸要的是单键，但全月一趟（~20 键）比逐键 N 趟
 * 便宜，且切走再切回能命中。四个动作之后失效当月。
 *
 * ponytail: 没有 TTL。审核是低频动作，且四个动作都会主动失效；别人在别的浏览器审的，
 *   这边靠 ping 的 pendingReviews 变化 + 进屏重取覆盖。要实时到秒再上 WebSocket。
 */
export const useReviewStore = defineStore('review', () => {
  const byPeriod = ref<Map<string, ReviewRow[]>>(new Map())
  const inflight = new Map<string, Promise<void>>()
  /** 拉失败的月：屏上要能区分「没有审核记录」和「不知道」——后者不许显示成可编辑。 */
  const failed = ref<Set<string>>(new Set())

  async function ensure(period: string | null): Promise<void> {
    if (!period || byPeriod.value.has(period)) return
    let p = inflight.get(period)
    if (!p) {
      p = reviewApi.list(period)
        .then(rows => {
          byPeriod.value = new Map(byPeriod.value).set(period, rows)
          failed.value.delete(period)
        })
        .catch(() => { failed.value = new Set(failed.value).add(period) })
        .finally(() => { inflight.delete(period) })
      inflight.set(period, p)
    }
    return p
  }

  function rowsOf(period: string | null): ReviewRow[] {
    return (period && byPeriod.value.get(period)) || []
  }

  /** 单键。没有这一行 = 派生「录入中」，返回 null（调用方按未锁处理）。 */
  function rowOf(key: string | null): ReviewRow | null {
    if (!key) return null
    const p = parseReviewKey(key)?.period
    return rowsOf(p ?? null).find(r => r.key === key) ?? null
  }

  function invalidate(period: string | null) {
    if (!period) return
    const m = new Map(byPeriod.value)
    m.delete(period)
    byPeriod.value = m
    inflight.delete(period)
  }

  /** 四个动作：做完一律失效当月并重取 —— 通过一把键会改变下游的 blockedBy。 */
  async function act(fn: () => Promise<unknown>, key: string) {
    await fn()
    const p = parseReviewKey(key)?.period ?? null
    invalidate(p)
    await ensure(p)
  }
  const submit     = (k: string) => act(() => reviewApi.submit(k), k)
  const approve    = (k: string) => act(() => reviewApi.approve(k), k)
  const returnBack = (k: string, r: string) => act(() => reviewApi.returnBack(k, r), k)
  const withdraw   = (k: string, r: string) => act(() => reviewApi.withdraw(k, r), k)

  return { byPeriod, failed, ensure, rowsOf, rowOf, invalidate, submit, approve, returnBack, withdraw }
})
```

- [ ] **Step 4: 测试 `stores/__tests__/review.spec.ts`（6 条）**

1. `parseReviewKey('ledger:7:2024-02')` → `{kind:'ledger', scope:'7', period:'2024-02'}`
2. `parseReviewKey('alloc-loss:2024-02')` → `{kind:'alloc-loss', scope:null, ...}` — **破坏验证**：把 `lastIndexOf` 改成 `indexOf`，这条红（会切成 `kind='alloc'`）
3. `parseReviewKey('salary:2024-13')` → `null`（月份闸，与后端 `ReviewKind.PERIOD` 同严）
4. `ensure` 同月并发两次只打一趟网络（`inflight` 去重）
5. `rowOf` 命中 / 未命中（未命中回 null）
6. `submit` 之后当月缓存被重取（mock 两次返回不同 status，断言第二次的值上屏）

- [ ] **Step 5: 跑测试 + 提交**

```bash
cd frontend && npx vitest run src/stores/__tests__/review.spec.ts
```

```bash
git add frontend/src/types/review.ts frontend/src/api/review.ts frontend/src/stores/review.ts frontend/src/stores/__tests__/review.spec.ts && git commit -m "feat(review): R2 T1 前端契约层 —— types / api / 按月缓存 store"
```

---

## Task 2: 编辑闸 · `useEditMode` 那条路 + 药丸

**Files:**
- Modify: `frontend/src/composables/useEditMode.ts`、`frontend/src/components/fp/FPEditModeButton.vue`
- Test: `frontend/src/composables/__tests__/useEditMode.spec.ts`

**Interfaces:**
- Consumes: T1 的 `useReviewStore` / `LOCKING`
- Produces: `EditModeOpts.reviewKey?: () => string | null`；返回值多两个：`reviewLock`（`{status, note} | null`）、`reviewNote`（药丸文案 `string | null`）

- [ ] **Step 1: `EditModeOpts` 加 `reviewKey`**

```ts
  /**
   * 本屏当前这一期的审核键（SIDEBAR-UX-REDESIGN §7.1），如 `ledger:7:2025-06`。
   *
   * 与 `scope` 同风格传函数：键跟着公司/年月变。
   * **不传（或返回 null）= 这一屏不受审核约束** —— `@NoReviewGuard` 的四屏
   * （光伏/充电桩分栋抄表、母册两屏）与不在审核范围内的十几屏一个字不改。
   */
  reviewKey?: () => string | null
```

- [ ] **Step 2: 闸 + 药丸文案**

```ts
  const review = useReviewStore()

  // 药丸要在**点之前**就画出来，所以进屏与换期时主动取一次。
  // ensure 幂等且按月去重，附表族一年 12 个月切来切去也只打 12 趟。
  watch(() => opts.reviewKey?.() ?? null, (k) => {
    void review.ensure(k ? parseReviewKey(k)?.period ?? null : null)
  }, { immediate: true })

  /** 这一期的审核态挡不挡编辑。null = 不挡。 */
  const reviewLock = computed(() => {
    const k = opts.reviewKey?.() ?? null
    if (!k) return null
    const r = review.rowOf(k)
    if (!r || !LOCKING.includes(r.status)) return null
    return r
  })

  /** 按钮位那颗禁用药丸的文案（§7.5：同尺寸、零位移）。 */
  const reviewNote = computed(() => {
    const r = reviewLock.value
    if (!r) return null
    if (r.status === 'submitted') return '待审核 · 已交审'
    const who = r.reviewedBy ?? ''
    const day = r.reviewedAt ? r.reviewedAt.slice(5, 10) : ''
    return `已审核${who ? ' · ' + who : ''}${day ? ' ' + day : ''}`
  })
```

- [ ] **Step 3: 闸装进 `enter()`（D-R2-1），不是 `toggle()`**

`enter()` 开头、`entering` 闸之后、取 scope 之前：

```ts
  async function enter() {
    if (entering) return
    // 审核闸(§7.5 三道闸之二：权限 → 审核态 → 锁)。
    // ⚠ 装在 enter() 不是 toggle()：toggle / onElevated(主管授权后) / onTaken(接管后)
    //   三条路都汇进这里。只挂 toggle 的话，叫主管授权进来的人和接管进来的人照样进得去，
    //   而那正是 §7.3 明写「主管接管锁、当场提权都过不去」的两条路。
    const rk = opts.reviewKey?.() ?? null
    if (rk) {
      await review.ensure(parseReviewKey(rk)?.period ?? null)
      if (reviewLock.value) return
    }
    ...
  }
```

`toggle()` 里**不再另判** —— 药丸已经把按钮换掉了，点不到；真点到了（药丸没渲染的路径）`enter()` 挡住。

- [ ] **Step 4: 深链兜底守卫**

改既有那条 watch（`watch([editMode, missing], ...)`），把审核态并进同一个守卫：

```ts
  // 「在编辑模式里权限却不齐」与「在编辑模式里表却被审了」这两个状态一秒都不许存在。
  // 三条路会走到这里：
  //   · 授权 30 分钟到期
  //   · 深链(?edit=1 / ?generate=1)直接写 editMode.value = true，绕过 enter() 的两道闸
  //   · 别人在另一个浏览器把这张表审了，本屏刷新 store 之后 reviewLock 转真
  watch([editMode, missing, reviewLock], ([on, m, rl]) => { if (on && (m.length || rl)) exit() })
```

- [ ] **Step 5: `FPEditModeButton` 加药丸**

```ts
  /** 审核态挡着时的药丸文案。非空 = 按钮位换成同尺寸禁用药丸（§7.5，零位移）。 */
  reviewNote?: string | null
```

模板最前面加一支（在 `v-if="canEnter"` 那颗之前，两者互斥）：

```html
  <!-- 审核闸(§7.5)：已审核 / 待审核时按钮位换成同尺寸禁用药丸。
       与下面那颗 Button 同 min-width:150px —— 换的是内容不是版面（LAYOUT-STABILITY）。
       canEnter 为假(只读账号)时两颗都不出：那种账号本来就没有编辑按钮，
       给他看「已审核」等于凭空多一条他不需要的信息。 -->
  <span v-if="canEnter && reviewNote" class="fp-emb fp-emb-rv" :title="'撤销审核需审核员'">
    <component :is="iconFor('lock')" :size="14" />{{ reviewNote }}
  </span>
  <Button v-else-if="canEnter" ...>
```

样式（与按钮同尺寸）：

```css
/* 审核药丸：与按钮同宽同高，只是不能点。撤销要找审核员 —— tooltip 说的就是这句。 */
.fp-emb-rv {
  min-width: 150px; height: 30px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 0 12px; border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle); background: var(--bg-subtle);
  color: var(--text-muted); font-size: var(--fs-label); cursor: not-allowed;
  white-space: nowrap;
}
```

⚠ 高度必须与 `Button size="sm"` 实测一致，不许拍脑袋 —— 执行时先量 `ds/Button.vue` 的 sm 高度再填。

- [ ] **Step 6: 测试 `useEditMode.spec.ts` +5**

| # | 断言 | 破坏验证 |
|---|---|---|
| 1 | `approved` 时 `toggle()` 不进编辑态 | 删 `enter()` 里的 `if (reviewLock.value) return` → 红 |
| 2 | `submitted` 时同样不进 | 把 `LOCKING` 改成只含 `approved` → 红 |
| 3 | `returned` 可以进（可编辑性等同录入中） | 把 `returned` 加进 `LOCKING` → 红 |
| 4 | `onElevated()`（主管授权后）在 `approved` 时也进不去 | 把闸挪回 `toggle()` → 红 ← **这条是 D-R2-1 的证据** |
| 5 | 深链写 `editMode.value = true` 后 `reviewLock` 转真 → 自动退出 | 从 watch 的依赖数组里删掉 `reviewLock` → 红 |
| 6 | 不传 `reviewKey` 的屏行为一字不变（不打网络、不挡） | 把 `if (rk)` 改成无条件 `ensure` → 红（断言 `list` 未被调用）|

- [ ] **Step 7: 跑测试 + 提交**

```bash
cd frontend && npx vitest run src/composables/__tests__/useEditMode.spec.ts
```

---

## Task 3: 编辑闸 · `SchedHeader` 那条路（D-R2-2）

**Files:**
- Modify: `frontend/src/components/sched/SchedHeader.vue`
- Test: `frontend/src/components/sched/__tests__/schedHeader.spec.ts`

**Interfaces:**
- Consumes: T1 的 store、T2 的药丸样式约定
- Produces: `SchedHeader` 新 prop `reviewKey?: string | null`

`SchedHeader` 不走 `useEditMode`（头注：「编辑态由 7 个消费屏各自持有」），所以闸要在这里再接一次。**接的是同一个 store，不是另抄一份判据。**

- [ ] **Step 1: prop + 派生**

```ts
  /** 本屏当前这一期的审核键（§7.1）。附表族按年进屏、按月审 —— 传的是**当前选中月**那把键。
   *  不传 = 这一屏不受审核约束（损益附表：报表层本轮不进审核，§7.1）。 */
  reviewKey?: string | null
```

```ts
const review = useReviewStore()
watch(() => props.reviewKey, (k) => {
  void review.ensure(k ? parseReviewKey(k)?.period ?? null : null)
}, { immediate: true })
const reviewLock = computed(() => {
  const r = props.reviewKey ? review.rowOf(props.reviewKey) : null
  return r && LOCKING.includes(r.status) ? r : null
})
const reviewNote = computed(() => reviewNoteOf(reviewLock.value))
```

`reviewNoteOf` 提到 `types/review.ts` 里共用 —— 两条路的药丸文案必须逐字相同，各写一份必漂移。T2 的 `reviewNote` 也改成调它。

- [ ] **Step 2: 闸装进 `onToggleEdit`**

```ts
async function onToggleEdit() {
  // 审核闸(§7.5)。退出编辑（edit 为真）不拦 —— 已经在里面的人要出得来。
  if (!props.edit && reviewLock.value) return
  ...
}
```

并在接管回调 `onTaken` 里同样拦一次（接管拿到的是锁，不是改已审核表的资格）。

- [ ] **Step 3: 药丸**

按钮前加一支 `v-if="canAsk && reviewNote"`，`v-else-if="canAsk"` 接原按钮。样式复用 `.lc-lockbtn` 的宽度常量。

- [ ] **Step 4: 测试 `schedHeader.spec.ts` +3**

1. `reviewKey` 指向 `approved` 的键 → 点按钮不 emit `toggle-edit`，药丸在
2. `submitted` 同样
3. 不传 `reviewKey` 时行为一字不变

破坏验证：删掉 `onToggleEdit` 开头那一行 → 前两条红。

- [ ] **Step 5: 提交**

---

## Task 4: 12 屏声明 `reviewKey` + 源码门禁

**Files:**
- Modify: 12 个消费屏
- Create: `frontend/src/views/__tests__/reviewGateCoverage.spec.ts`

kind → 屏 → 走哪条闸（执行前先复核，这张表就是门禁测试的期望值）：

| kind | 屏 | 闸 | scope |
|---|---|---|---|
| `params` | `views/params/ParamCenterView.vue` | useEditMode | — |
| `meters` | `views/meters/MeterView.vue` | useEditMode | — |
| `alloc` | `views/alloc/PoolLedgerView.vue` | useEditMode | — |
| `alloc-loss` | 同上（一屏两键，取**较严**的那把：任一把锁着就锁）| useEditMode | — |
| `bill-notices` | `views/bills/BillNoticesView.vue` | useEditMode | — |
| `ledger` | `views/ledger/LedgerWideTable.vue` | useEditMode | companyId |
| `elec-model` | `views/elec/ElecCostView.vue` | useEditMode | — |
| `s10` | `views/sales-income/S10View.vue` | SchedHeader | phase no |
| `salary` | `views/salary/SalaryView.vue` | SchedHeader | — |
| `utilities` | `views/utilities/UtilitiesView.vue` | SchedHeader | office/phase3 |
| `pv` | `views/pv/PvView.vue` | SchedHeader | — |
| `charging-car` / `charging-ebike` | `views/charging/ChargingView.vue` | SchedHeader | — |
| `elec-cost` | `views/elec/ElecView.vue` | SchedHeader | — |

**不声明的屏**（对应后端 `@NoReviewGuard`）：`PvMeterView` / `CpMeterView`（分栋抄表是附表的下游）、`CoefBookWindow` / `PayBookWindow`（母册，P6 录入即冻结）、`PnlScheduleView`（报表层不进审核）。

⚠ 附表族屏是**按年进屏、按月审**：`reviewKey` 要跟着屏内选中的月走，不是年。执行时逐屏确认「屏上此刻在改哪个月」这个值从哪来 —— 取不到月的屏（整年一张表一起存的）改用**该年任一月被锁就锁**，并在 §12 记为边界。

- [ ] **Step 1..12: 逐屏加 `reviewKey`**（每屏一次编辑 + 一次 `npx vue-tsc --noEmit` 型检）

- [ ] **Step 13: 源码门禁 `reviewGateCoverage.spec.ts`**

照 R1 `ReviewGuardCoverageTest` 的精神，但形状简单得多（前端没有 controller→service 链）：

```ts
// 14 个 kind 每个都得有屏声明 —— 少一个就是「屏上显示已审核，编辑按钮照样能点」，
// 是这一层最坏的假绿。R1 那份后端覆盖率测试守的是写路径，这份守的是**入口**。
//
// ⚠ 三条不许省（照 R1 的教训）：
//   ① 读不出文件一律 fail()，不许 continue —— 「解析不了就跳过」是这类测试最常见的假绿源
//   ② 扫到的文件数有下限断言，防空扫
//   ③ 白名单（不进审核的屏）写死并断言理由非空
const KINDS = ['params','meters','alloc','alloc-loss','bill-notices','ledger','s10','salary',
               'utilities','pv','charging-car','charging-ebike','elec-cost','elec-model']
```

实现：`fs.readdirSync` 递归收 `src/views/**/*.vue` + `SchedHeader.vue`，全文搜每个 kind 的字面量出现在**声明 reviewKey 的那一段**里。断言：
1. 每个 kind 至少一处
2. 扫到的 `.vue` 文件数 > 60（防空扫）
3. 白名单 5 屏各自有一行 `// no-review:` 注释 + 非空理由

**破坏验证**：从 `SalaryView.vue` 删掉 `reviewKey` 那一行 → 断言 1 红并点名 `salary`。

- [ ] **Step 14: 提交**

---

## Task 5: 清单落数 —— `monthClose.logic.ts`

**Files:**
- Modify: `frontend/src/views/data-home/monthClose.logic.ts`
- Test: `frontend/src/views/data-home/__tests__/monthClose.logic.spec.ts`

- [ ] **Step 1: 类型换形**

```ts
export interface CloseChip {
  label: string
  done: boolean
  co?: number | 'all'
  go?: string
  tab?: string
  /** 这枚 chip 自己那把键的审核态（台账每公司一键 / 附10 每期区一键）。 */
  review?: ReviewStatus
  reviewKey?: string
}

export interface CloseRow {
  ...
  /** 这一行的审核态。行有多把键（台账 N 公司 / 附10 N 期区 / 合并行两把）时取**最不进展**的那个：
   *  entered < returned < submitted < approved —— 一行显示「已审核」而底下挂着没交审的公司，
   *  是 P2 那条「行 done 收严成所有 chip 都 done」同一条理由。 */
  review: ReviewStatus | 'na'
  /** 单键行的键；多键行不给（动作在 chip 上）。 */
  reviewKey?: string
}

export interface RowsInput {
  overview: DataHomeOverviewDTO
  recon: ReconMonthMeta | null
  review: ReviewRow[] | null   // null = 还没到，全行显 'na'
}
```

- [ ] **Step 2: kind ↔ 清单行 key 的映射表**

```ts
/** 清单行 key → 审核 kind。**一行可能对多个 kind**（附表7/8 合并成一行、办公·三期两个 scope）。
 *  出账链五步的 step.key 逐字就是前五个 kind code（DataHomeService.buildChain 写死的），
 *  记账列的行 key 是 monthClose 自己起的，两边对不上，所以要这张表。 */
const ROW_KINDS: Record<string, string[]> = {
  params: ['params'], meters: ['meters'], alloc: ['alloc'],
  'alloc-loss': ['alloc-loss'], 'bill-notices': ['bill-notices'],
  ledger: ['ledger'], 'sales-income': ['s10'], salary: ['salary'],
  utilities: ['utilities'], 'pv-income': ['pv'],
  charging: ['charging-car', 'charging-ebike'], 'elec-cost': ['elec-cost'],
  import: [],           // 导入中心没有审核键
  reconciliation: [],   // 收入核对本轮不进审核（§7.1）
}
```

⚠ 执行时**先跑一遍**把 `overview.chain.steps[i].key` 打出来核对，不许照抄这张表就上 —— 前五行的 key 来自后端，猜错了整列显 'na' 而且不会红。

- [ ] **Step 3: 取最不进展的态**

```ts
const RANK: Record<ReviewStatus, number> = { entered: 0, returned: 1, submitted: 2, approved: 3 }
const leastOf = (ss: ReviewStatus[]): ReviewStatus | 'na' =>
  ss.length ? ss.reduce((a, b) => (RANK[b] < RANK[a] ? b : a)) : 'na'
```

- [ ] **Step 4: 本月锁账行改成派生**

```ts
/** 本月锁账 = 该月**全部** countsTowardMonthClose 的键 approved（D20）。
 *  `elec-model` 不计入 —— 它没有清单行，计入的话锁账永远达不成（§7.1）。
 *  前端不重算键集合：后端 `GET /api/review` 发来的就是那个集合，这里只做过滤与计数。 */
function monthLockRow(review: ReviewRow[] | null): CloseRow {
  if (!review) return { key:'month-lock', col:'billing', label:'本月锁账', state:'na',
                        countable:false, locked:'审核态加载中', review:'na' }
  const inSet = review.filter(r => r.kind !== 'elec-model')
  const left = inSet.filter(r => r.status !== 'approved').length
  return {
    key: 'month-lock', col: 'billing', label: '本月锁账',
    state: left === 0 ? 'done' : 'todo',
    // countable 仍为 false：它是「其余 14 行全做完」的同义反复，进分母等于把同一件事数两遍。
    countable: false,
    ...(left ? { locked: `还有 ${left} 张表没审完` } : {}),
    review: 'na',
  }
}
```

⚠ **`countable` 保持 false** —— P2 定的分母口径（`checks.byCol`）不许被 R2 改动，改了六项计数全变，而 §12 明写「计数与审核键集合必须与屏内同源，假绿栽过三次」。

- [ ] **Step 5: 测试 `monthClose.logic.spec.ts` +8**

1. `review: null` → 全行 `review === 'na'`，本月锁账 `state:'na'`
2. 单键行（附表12）落 `approved`
3. 台账行 3 个公司里 1 个 `entered` → 行显 `entered`（取最不进展）— 破坏：把 `leastOf` 改成取第一个 → 红
4. 附表7/8 合并行两把键取最不进展
5. 全部 approved（含 elec-model 也 approved）→ 本月锁账 `done`
6. **只有 elec-model 没审、其余全审 → 本月锁账仍 `done`** — 破坏：删掉 `r.kind !== 'elec-model'` 过滤 → 红 ← 这条钉 §7.1 的拆键决定
7. 差一张 → `locked: '还有 1 张表没审完'`
8. 计数 `checks` 不受审核态影响（分母口径没变）— 破坏：把 `countable` 改成 true → 红

- [ ] **Step 6: 提交**

---

## Task 6: 屏上审核态列 + 行动作 + 弹窗

**Files:**
- Create: `frontend/src/components/fp/FPReviewDialog.vue`、`frontend/src/components/fp/__tests__/reviewDialog.spec.ts`
- Modify: `frontend/src/views/data-home/DataHomeView.vue`

- [ ] **Step 1: `FPReviewDialog.vue`** — 居中弹卡（DESIGN-FIDELITY §七），理由必填（`trim()` 后为空则确认按钮禁用 + 提示），最长 255（后端 `@Size(max=255)`）。两种用途（退回 / 撤销）只是标题与提示文案不同，一个组件带 `action: 'return' | 'withdraw'`。

- [ ] **Step 2: 审核态列真值化**

既有那行 `<span class="dh-rreview" :data-review="r.review">{{ r.review === 'na' ? '—' : r.review }}</span>` 换成人话 + tooltip：

```html
<span class="dh-rreview" :data-review="r.review" :title="reviewTip(r)">{{ reviewText(r) }}</span>
```

`reviewText`：`entered→未交审` / `submitted→待审核` / `approved→已审核` / `returned→已退回` / `na→—`
`reviewTip`：已审核 → `李审 · 03-05`；已退回 → 理由；待审核 → `张三 交审 · 03-04`

- [ ] **Step 3: 行动作**

行尾加动作位（常驻宽度，无动作时空占位 —— 零位移）：
- 有该表 edit 权 且 `entered|returned` 且行 `done` → 「交审」
- `can('review:approve')` 且 `submitted` → 「通过」「退回」
- `can('review:approve')` 且 `approved` → 「撤销」
- `blockedBy.length` → 「通过」禁用 + tooltip 列缺项

⚠ `@click.stop` —— 行本身是「去做事」跳转，动作按钮不能顺带跳走。

⚠ 「有该表 edit 权」判据：`kind → perm` 那张表在后端 `ReviewKind.perms()`。**前端不重列一份** —— 让后端在 `ReviewRowDTO` 里多发一个 `canSubmit: boolean`？不行，那要改 R1 的 DTO。折中：前端只按 `auth.can('entry:edit') || auth.can('billing-run:edit') || ...` 粗判**显不显示按钮**，点下去由后端 403 兜底并把错误文案原样弹出。执行时把这条记进 §12 边界。

- [ ] **Step 4: 错误分流（423 / 409 / 403）**

四个动作的 catch 里按 `body.code` 分：409 → 「先去催上游：{message}」；403 → 「你没有这张表的权限」；其余原样。**不许合成一句**（Global Constraints）。

- [ ] **Step 5: chips 带审核色**

`data-review` 属性驱动：已审绿勾 / 待审橙钟 / 录入中灰底 / 未录虚线（既有 `data-done` 保留，两个属性叠加）。

- [ ] **Step 6: 测试**（`reviewDialog.spec.ts` 3 条 + `DataHomeView.spec.ts` +6）

理由必填：空 / 全空格 → 确认禁用；填了 → 触发 emit 且带 trim 后的值。破坏：去掉 `trim()` → 全空格那条红。

- [ ] **Step 7: 提交**

---

## Task 7: 审核条（审核员落地位）

**Files:** Modify `frontend/src/views/data-home/DataHomeView.vue`

审核员（`can('review:approve')` 且非主管）看到的是审核条，不是主管条；两者都有的（admin）**两条都显示**，各占各的 32px —— 合并成一条会让 admin 少看见一半信息。

- [ ] **Step 1:** 「待审核 N」按钮（点击 = 只看待审筛选开关）+ 「本月已审 n/总」
- [ ] **Step 2:** 筛选：开时两栏只渲染 `review === 'submitted'` 的行。**行仍占位**（P2 裁定 1/2：不许 v-if 掉整条），改用压暗而不是移除？—— 不：筛选是用户主动要的，这里允许真的少渲染行，但**两栏的容器与标题常驻**。执行时按 P2 那三条裁定复核一遍再定。
- [ ] **Step 3:** 计数从渲染出来的 rows 算（Global Constraints）
- [ ] **Step 4:** 测试 +4；破坏：把「本月已审」改成抄 `review.length` → 红
- [ ] **Step 5: 提交**

---

## Task 8: 铃铛 —— `pendingReviews` 进 presence / Toolbar / 抽屉

**Files:** Modify `stores/presence.ts`、`Toolbar.vue`、`mobile/MobileTopBar.vue`、`FPApprovalDrawer.vue`

- [ ] **Step 1:** `presence.ping()` 的回包类型加 `pendingReviews: number`，存进 `const pendingReviews = ref(0)`
- [ ] **Step 2:** `Toolbar.pendingCount` 改成 `presence.approvals.length + presence.pendingReviews`
- [ ] **Step 3:** `FPApprovalDrawer` 加「待审核」段：标题 + 条数 + 一个「去审核」按钮 → `periodLink('data-home', ...)`。
  ⚠ ping **只发个数不发清单**（§7.4）—— 抽屉里列不出具体哪几张表，只能给个数 + 跳转。要清单去 `GET /api/review`。抽屉不为此再打一趟网络（它是浮层，开一次打一趟不划算）；跳过去清单屏上什么都有。
- [ ] **Step 4:** 测试：`presence.spec.ts` +2（字段落地 / 缺字段时回 0）；Toolbar 计数 +1
- [ ] **Step 5: 提交**

---

## Task 9: 退回提醒（D-R2-4，后端零迁移）

**Files:** Modify `ReviewService.java`、`PresenceDtos.java`、`PresenceService.java`、`stores/presence.ts`、`Toolbar.vue`
**Test:** `ReviewPingIT.java` +2

- [ ] **Step 1: 后端 `ReviewService.returnedCount(String user)`**

```java
/** 「我交的表被退回了」的条数。撤销不在内 —— withdraw 是删行，submitted_by 随行消失（§12 边界）。 */
public int returnedCount(String user) {
    return Math.toIntExact(states.selectCount(new QueryWrapper<ReviewState>()
        .eq("status", "returned").eq("submitted_by", user)));
}
```

- [ ] **Step 2: `PingResp` 第 6 件事 `int myReturned`**（javadoc「一条通道五件事」→ 六件事）
- [ ] **Step 3: `PresenceService`** 填它 —— 无条件填（每个人都可能被退回，不像 `pendingReviews` 要 `review:approve`）
- [ ] **Step 4: 前端**：`presence.myReturned` → 铃铛计数第三项 + 抽屉「被退回」段（文案「你交的 N 张表被退回了」+ 去看）
- [ ] **Step 5: `ReviewPingIT` +2**

1. A 交审 → 审核员退回 → A 的 ping `myReturned=1`，B 的是 0
2. A 重新交审 → 回 0（自清）— **破坏**：把 `submit` 里那句「重新交审要把上一轮退回的痕迹清掉」的 status 改回 returned → 红

- [ ] **Step 6: 提交**

---

## Task 10: 月格 ✓（D-R2-5）

**Files:** Modify `ReviewController.java`、`ReviewService.java`、`api/review.ts`、`stores/billingPeriod.ts`、`BookMonthMatrix.vue`
**Test:** `ReviewApiIT` +3、`billingPeriod` 前端 spec +2

- [ ] **Step 1: 后端 `closedMonths()`**

```java
/**
 * 整月全审的月份（D20）。矩阵月格的 ✓ 靠它。
 *
 * ponytail: 两段式 —— 先一条 group-by 拿「已审核键数 ≥ 12」的候选月（12 = 固定键
 *   5+1+2+5 减去不计入锁账的 elec-model，是任何月的下限），再只对候选月跑一遍
 *   keysOf 全集比对。直接对窗口内每个月跑 keysOf 要各调一次 dataHome.overview()
 *   （十几条 count 查询），48 个月就是几百条查询换一屏 ✓。
 *   升级路径：候选月多到几十个再说，那意味着这个库已经审了好几年。
 */
public List<String> closedMonths() { ... }
```

- [ ] **Step 2: 端点 `GET /api/review/closed-months`**（GET 不进 `PermissionRegistry`，读全开）
- [ ] **Step 3: `ChainCell` 加 `closed: boolean`**，`fetchAll()` 的 `Promise.all` 加第 5 个源
  ⚠ 与既有四个源同款：拉失败**整屏说加载失败**（那段 catch 已经写明「半张矩阵比没有矩阵更坏」）—— 但 `closed` 拉失败只该少一个 ✓ 不该整屏红。按 `stale` 那一段的写法（单独 try/catch，失败不阻断）接。
- [ ] **Step 4: `BookMonthMatrix` 月格 ✓**（absolute 角标，零位移 —— §8.1 明列「锁角标 absolute」）
- [ ] **Step 5: 测试**
  - 后端：全审 → 在列表里；差一张 → 不在；只差 elec-model → **在**（破坏：把 elec-model 算进去 → 红）
  - 前端：`closed` 为真的格子有 ✓；拉失败时其余四个工序点照常
- [ ] **Step 6: 提交**

---

## Task 11: 日志屏第 4 路的 4 处展示

**Files:** Modify `views/system/SystemLogsView.vue`（`SRC` / `ACTION` / `SRC_OPTS` 三处）、`types/system.ts`（`AuditSource` 联合类型）

R1 已经把 `review_log` 并进 `AuditQueryMapper` 的第 4 路 UNION，后端发得出来；前端 `SRC` 有 `OTHER` 兜底所以不改也不崩，只是显示成「其他」。

- [ ] **Step 1:** `AuditSource` 加 `'review'`
- [ ] **Step 2:** `SRC` 加 `review: { label: '审核', ... }`（图标/色与其余三路同风格）
- [ ] **Step 3:** `ACTION` 加 `submit/approve/return/withdraw` 四条人话
- [ ] **Step 4:** `SRC_OPTS` 加筛选项
- [ ] **Step 5:** 测试 +1（`source:'review'` 的行显「审核」不显「其他」）；破坏：删掉 `SRC.review` → 红
- [ ] **Step 6: 提交**

---

## Task 12: 规范同步 + 全量门禁

**Files:** Modify 规范若干

- [ ] **Step 1: spec §7.5** 按实际落地形状订正 —— 至少三处：闸在 `enter()` 不是 `toggle()`（D-R2-1）、`SchedHeader` 是第二条独立的路（D-R2-2）、撤销不发提醒（D-R2-4）
- [ ] **Step 2: spec §12** 补边界：撤销无提醒、前端「有没有该表 edit 权」是粗判靠后端兜底、整年一张表的附表屏按年锁
- [ ] **Step 3: `EDIT-MODE-SPEC.md` §1.1** 三道闸从「设计」改成「已落地，落点在此」
- [ ] **Step 4: `RBAC-SPEC.md` §7** 日志第 4 路的前端展示已接
- [ ] **Step 5: 全量门禁**

```bash
cd frontend && npm run test -- --run
```

```bash
cd frontend && npm run build
```

```bash
./mvnw -B verify
```

基线：后端 931 tests（R1 收尾数）。前端跑之前先记基线数。
`npm run build` 的 index 体积对 §8.1 那条「191KB 上限」复核一次。

- [ ] **Step 6: 提交 + 开 PR**

---

## Self-Review 记录

**Spec coverage（§7.5 逐句对任务）**

| §7.5 原文 | 任务 |
|---|---|
| 编辑模式闸 · `useEditMode.toggle()` 查 `reviewState` | T2（落点改 `enter()`，D-R2-1） |
| `opts.reviewKey?: () => string \| null` | T2 |
| 同尺寸禁用药丸 / tooltip「撤销审核需审核员」 | T2 + T3 |
| `elevate:request` 弹窗不出现 | T2（闸在 `enter()`，`toggle` 的提权分支在闸之前就返回了 —— **执行时验证这一条**：`toggle` 里 `missing.length` 的判断在 `enter()` 之前，缺权限的人点了仍会弹提权窗。要让它不弹，`toggle()` 里得先判 `reviewLock`。**T2 Step 3 要补这一句**） |
| `stores/review.ts` 按月一份，写后失效 | T1 |
| 顶栏上下文 chip 带审核态图标 | **未覆盖 → 补进 T6 Step 8** |
| 矩阵月格全审 ✓ | T10 |
| 清单行审核态列四态 | T6 |
| 行动作按权限 | T6 |
| 台账/附10 chips 带审核态色 | T6 Step 5 |
| 审核员落地 `/data-home` | **P5 的事**（§9 落地顺序表把落地页归 P5），R2 不做 —— 记进 T12 Step 2 |
| 审核条「待审核 N」+ 只看待审 + 本月已审 n/总 | T7 |
| 退回/撤销弹窗理由必填 | T6 Step 1 |
| 审核态不占锁、不发在场点 | **无需改动**（审核走的是 review_state，一行锁的代码都没碰）—— T12 Step 1 里写一句说明 |
| 与催缴单确认三步并存 | 无需改动 |
| §7.4 R2 边界：ping 字段进 store / 铃铛 / 抽屉 / 行点 periodLink | T8 |
| §7.4 R2 边界：退回撤销 → submitted_by 铃铛 | T9（撤销做不到，D-R2-4） |

**补：T6 Step 8** — 顶栏上下文 chip 审核态图标。执行时先找到那颗 chip 在哪个组件（`Toolbar.vue` 或 `FPContextChip`），再定形状。

**类型一致性**：`ReviewStatus` 在 T1 定义，T2/T3/T5/T6 消费；`CloseRow.review` 从 `'na'` 字面量类型放宽成 `ReviewStatus | 'na'`（T5），T6 的模板跟着改 —— **P2 留的那两处模板 `r.review === 'na' ? '—' : r.review` 会直接把 `submitted` 显示成英文**，T6 Step 2 必须换掉，别只改逻辑不改模板。

**Placeholder 扫描**：T4 的「逐屏加 `reviewKey`」与 T7 Step 2 的筛选形状是两处刻意留给执行期的判断（前者要逐屏确认「屏上此刻在改哪个月」的来源，后者要对 P2 三条裁定复核），已在文中写明判据与复核对象，不是 TBD。
