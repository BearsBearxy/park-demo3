# 失锁/接管弹窗覆盖到 7 个屏

> 2026-08-30 设计稿。上游：`docs/design/CONCURRENCY-SPEC.md` §4、`EDIT-MODE-SPEC`、
> 阶段性验收报告 `stage-review-2026-08-30.md` 的 C1/C2。
> 触发点：验收走查发现 7 个屏在「别人占锁」与「被接管」两种情况下**什么都不说**。

## §1 病是什么

两条症状，**同一个根**。

### C1 · 死按钮

别人占着锁时，编辑按钮显示「张三 编辑中」**且可点**；点下去什么都不发生，屏上也没有申请接管的入口。

- [`FPEditModeButton.vue:42`](../../../frontend/src/components/fp/FPEditModeButton.vue) `:disabled="disabled"` —— 组件的禁用**不看 `held`**（这是对的，见 §2）
- [`PvMeterView.vue:516`](../../../frontend/src/views/pv/PvMeterView.vue) 传的是 `:disabled="!editMode && !!loadErr"`，`heldByOther` 不在禁用条件里
- 点击 → `toggleEdit()` → `useEditMode.toggle()` → `enter()` → `lock.acquire()` →
  [`useEditLock.ts:87`](../../../frontend/src/composables/useEditLock.ts) `if (!r.granted) { lockedBy.value = r.holder; return false }`
- **`lockedBy` 被赋了值，但这 7 个屏一个都没接** → 没人渲染 → 静默

### C2 · 静默踢出

编辑中被接管，编辑态就地消失，草稿没了，一个字的提示都没有。

- 失锁通知按 scope 正确派回本屏（[`presence.ts:195-199`](../../../frontend/src/stores/presence.ts)）
- 回调里 [`useEditLock.ts:130`](../../../frontend/src/composables/useEditLock.ts) `evictedBy.value = e`
- **同样没人接** → `editMode` 就地翻假 → 各屏 `watch(editMode)` 关掉弹窗 → 用户不知道发生了什么
- `AppShell` / `App.vue` 也没有全局兜底（`FPEvictedDialog` 在 shell 层零命中）

### 根

`useEditMode` 的 return 面里有 `lockedBy` 和 `evictedBy`（[`useEditMode.ts:217`](../../../frontend/src/composables/useEditMode.ts)），
**7 个屏的解构里一个都没取**：

```js
// 7 屏逐字相同的解构（PvMeterView.vue:42 / CpMeterView.vue:51 / ElecCostView.vue:45 …）
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther } = useEditMode(...)
//                                                                              ↑ 少了 lockedBy, evictedBy
```

对照组做对了：`SchedHeader.vue:63,184-187`、`CoefBookWindow.vue:71,522-524`、
`LedgerWideTable.vue:69,323-326`、三张报表屏。它们**接了这两个 ref 并挂上对应弹窗**，于是同一套机制就工作。

## §2 一条必须先说清的事：按钮不该被禁掉

直觉上「别人占着就该禁用按钮」是错的，**样板屏的正确行为恰恰是让它可点**：

- `FPTakeoverDrawer` 的开关是 `open = computed(() => !!props.holder)`（`FPTakeoverDrawer.vue:31`）
- 点击 → acquire 失败 → `lockedBy` 非空 → **接管抽屉自动弹出**

也就是说：**按钮点了没反应，正是因为没人挂接管抽屉。** 挂上它，按钮当场就活了。
本次**不动** `FPEditModeButton` 的 `:disabled`，也不动 7 屏传的禁用条件。

## §3 范围：7 个屏

用 `useEditMode` 且传了 `scope` 的全部屏：

| # | 屏 | `useEditMode(...)` 行 | scope | 备注 |
|---|---|---|---|---|
| 1 | `views/pv/PvMeterView.vue` | :43 | `S.pvMeter(year)` | |
| 2 | `views/charging/CpMeterView.vue` | :52 | `S.cpMeter(vehicleType, year)` | 双实例（汽车/电动车） |
| 3 | `views/elec/ElecCostView.vue` | :46 | `S.elecCost(year, month)` | |
| 4 | `views/meters/MeterView.vue` | :67 | `S.meters(year)` | |
| 5 | `views/alloc/PoolLedgerView.vue` | :84 | `S.poolLedger(year, month)` | **共占 `billing-chain`** |
| 6 | `views/bills/BillNoticesView.vue` | :78 | `S.billNotices(year, month)` | **共占 `billing-chain`** |
| 7 | `views/params/ParamCenterView.vue` | :66 | `S.paramCenter(year, month)` | **共占 `billing-chain`** |

**不在范围内**（验收报告原写「8 个屏」，此处更正）：

- `views/bills/PayBookWindow.vue` —— **根本没有编辑锁**。`PayBookWindow.vue:60-61` 明写
  「本窗口不走 useEditMode，也没有编辑锁（收款簿改的是 `bill_pay_company`，不进出账链快照）」。
  它有 `FPElevateDialog` 只是为了提权，与本次两条 Critical 无关。
- `components/sched/SchedHeader.vue` —— 自带三件套且工作正常。**不动**（无谓风险）。
- 各屏已有的 `FPElevateDialog` —— **不动**，本次只补缺的两个。

5/6/7 三屏共用一把 `billing-chain:YYYY-MM` 锁（`lockScopes.ts:17-19`）。
`FPTakeoverDrawer` 的 `scopeNote(scope)` 会为共占锁多说一句「一把锁管四个写面」——
所以共享件必须把 `scope` **原样透传**，不能自己拼一个。

## §4 改动设计

### 4.1 `composables/useEditMode.ts` 补两个出口

现在缺的是接管闭环所需的两样东西。

**`lockScope`** —— 暴露已解析的 scope 字符串，供接管抽屉用：

```js
const lockScope = () => opts.scope?.() ?? null
```

不让屏自己再写一遍 `S.pvMeter(year.value)`：**同一个表达式写两处必然漂移**，
而漂移的后果是接管抽屉去接一把不是本屏握着的锁。

**`onTaken()`** —— 接管成功后的闭环，语义照 `SchedHeader.vue:124-128`：

```js
async function onTaken() {
  lockedBy.value = null
  await enter()      // 重入拿回 held 与心跳，并进编辑态
}
```

**复用私有的 `enter()`，不要另写一段 acquire。** `enter()` 里有两道守卫必须继承：
`entering` 重入闸（`useEditMode.ts:114`）与占锁往返期间的换期复核（:127）。
另写一段就等于把这两道守卫从接管这条路上摘掉。

> `FPTakeoverDrawer` 在 emit `taken` 之前已经调过 `locksApi.takeover()`（`FPTakeoverDrawer.vue:81-85`），
> 所以 `enter()` 里的 `acquire` 是**重入**（幂等，拿回 `held` 与心跳），与 SchedHeader 同形。

return 面加这两项，其余不动。

### 4.2 新增 `components/fp/FPLockDialogs.vue`

只管**缺的那两个**弹窗。不含 `FPElevateDialog`（7 屏各自已有，不去搅动能用的代码）。

```
props:
  lockedBy   : LockHolder | null    // 来自 useEditMode
  evictedBy  : Eviction | null      // 来自 useEditMode
  scope      : string | null        // 来自 useEditMode 的 lockScope()
  what       : string               // 给人看的一句话，如「光伏抄表 2025 年」
emits:
  taken            : []             // 透传 FPTakeoverDrawer 的 taken
  'close-takeover' : []             // 关接管抽屉 → 屏把 lockedBy 清空
  'close-evicted'  : []             // 关失锁弹窗 → 屏把 evictedBy 清空
```

> **为什么不用 `v-model:locked-by`**：本仓自定义组件的双向绑定只用过 `update:modelValue`
> 单值形态（`FPPhaseTabs` / `FPTenantPicker` / `FPToast`），具名 v-model 一处都没有。
> 两个显式 close 事件与既有的 `@close="lockedBy = null"`（`BalanceSheetView.vue:515`）
> 是同一个写法，不引入本仓没有的风格。

内部就是两行：

```vue
<FPTakeoverDrawer :holder="lockedBy" :scope="scope ?? ''" :what="what"
                  @close="$emit('close-takeover')" @taken="$emit('taken')" />
<FPEvictedDialog :eviction="evictedBy" :what="what"
                 @close="$emit('close-evicted')" />
```

**本次不传 `dirtyCount` / `copyText`**（已拍板）。不传 → 复制块不显示，
弹窗只负责把「你被 X 接管了」说出来。四个有草稿态的屏（ElecCost / Meter / PoolLedger / BillNotices）
的 TSV 序列化各不相同，混进来会让这次的 diff 没法审 —— 单独立项。

### 4.3 7 个屏各改两处

**解构加三项**（`onTaken` 一项 + 两个 ref）：

```js
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken } = useEditMode(...)
```

**模板加一行**，与各屏已有的 `<FPElevateDialog>` 并排：

```vue
<FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy"
               :scope="lockScope()" :what="`光伏抄表 ${year} 年`"
               @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
```

`what` 每屏一句。**取值规则：照本屏 `FPElevateDialog` 的 `:page` 措辞**（去掉中间的 `·`）。
这样期粒度天然与 scope 对齐，用词也与同一文件里已有的提权窗一致，不必另发明一套。

| 屏 | `what` | 来源（本屏 FPElevateDialog `:page`） |
|---|---|---|
| PvMeterView | `` `光伏分栋抄表 ${year} 年` `` | :756 |
| CpMeterView | `` `充电桩分桩明细 ${year} 年` `` | :767 |
| ElecCostView | `` `电费成本总览 ${year}-${String(month).padStart(2, '0')}` `` | :768（本屏就是这么写的，不引 `pad2`） |
| MeterView | `` `园区抄表 ${year} 年` `` | :852 |
| PoolLedgerView | `` `公共电核算 ${ym}` `` | :935（本屏已有 `ym` computed） |
| BillNoticesView | `` `催缴单 ${ym}` `` | :1183（已有 `ym`） |
| ParamCenterView | `` `计费参数 ${ym}` `` | :812（已有 `ym`） |

> 因此**不需要**任何新的补零工具：三个月粒度屏已有 `ym`，ElecCost 已有内联 `padStart`。

### 4.4 ⚠ MeterView 的解构与其余六屏不同

六屏是 `toggle: toggleEdit`；`MeterView.vue:66` 是：

```js
const { editMode, canEnter, missing: lockedPerms, asking, askFor, cancelAsk, onElevated,
        exit: exitEdit, heldByOther, toggle } = useEditMode(...)
```

**不要盲替换**。这屏只在既有解构尾部追加 `lockedBy, evictedBy, lockScope, onTaken` 四项即可。

## §5 测试

每屏一条 spec（或并入该屏已有的 spec 文件），断言两件事：

1. `lockedBy` 非空 → 接管抽屉出现（`FPTakeoverDrawer` 渲染）
2. `evictedBy` 非空 → 失锁弹窗出现（`FPEvictedDialog` 渲染）

再加**两条只写一次**的共享件测试（`components/fp/__tests__/fpLockDialogs.spec.ts`）：

3. `scope` 原样透传给 `FPTakeoverDrawer`（共占锁的 `scopeNote` 依赖它）
4. 未传 `dirtyCount`/`copyText` 时不出复制块

**每条断言必须做破坏验证**：把对应那一行 `<FPLockDialogs>` 注释掉 → 只有那一条转红。
前置不足的断言等于假绿，本项目栽过。

`useEditMode` 的两个新出口另加两条：

5. `lockScope()` 返回值与传入 `opts.scope()` 逐字相同
6. `onTaken()` 走 `enter()`：换期守卫仍然生效（占锁往返中期变了 → release 且不进编辑态）

## §6 验收

- 7 个屏：别人占锁时点编辑按钮 → **弹出接管抽屉**（不再是点了没反应）
- 7 个屏：编辑中被接管 → **弹出失锁提示**（不再是静默退出）
- 5/6/7 三屏的接管抽屉里能看到「一把锁管四个写面」那句话（`scope` 透传成功的证据）
- `npm run build`（含 vue-tsc 类型闸 + 体积预算）过
- `npx vitest run` 全绿 —— **不要接管道跑**（退出码会取自 `tail`，恒 0；本项目 `docs/design/IMPORT-GUIDE.md:59` 与
  `plans/2026-08-29-phase3-pool-opening.md` Global Constraints 都记了这条，阶段性验收时又踩中一次）

## §7 明确不做

- **不动** `FPEditModeButton` 的 `:disabled`，也不动 7 屏传的禁用条件（§2 已述理由）
- **不动** `SchedHeader`（自带三件套，工作正常）
- **不动** 各屏已有的 `FPElevateDialog`
- **不做**「复制我的改动」（`dirtyCount`/`copyText`）—— 单独立项
- **不做** AppShell 全局兜底 —— 接管抽屉要 per-scope 的 holder、`evictedBy` 活在每个
  `useEditLock` 实例里，提到全局要动并发核心，收益不抵风险
- **不碰** `PayBookWindow`（无锁，不受影响）
