# 出账链/动线分支 · 并行交接说明

> 分支 `claude/period-context-chain`,截至 `04e5686`(2026-08-30):**ahead 32 / behind 12**,
> **尚未推送、尚未开 PR**。本文是 RESPONSIVE-LAYOUT-SPEC §12 的镜像 —— 那边写响应式分支的
> 契约,这边写本分支的。**任何人在下列文件上解冲突或继续开发,先读完本文再动手。**

## §1 冲突现状(2026-08-30 实测,`git merge-tree origin/master HEAD`)

与 origin/master 合并会在 **14 个文件**上冲突。根因:master 新进的响应式迁移
(P1–P3,#13/#14)是**基于旧屏结构**改的,而本分支把其中几屏的结构整个重做了。

### 1a. 结构重做屏(5 个)—— 本分支结构赢,响应式**意图**要移植

| 文件 | 本分支做了什么 | master 做了什么 | 解法 |
|---|---|---|---|
| `pv/PvView.vue` | 功能门整段删除 → `BookRailShell` 左栏两本账 | 给**功能门**挂 `fp-fluid` + 功能门 CSS 响应式 | 功能门连同其 fp-fluid/CSS 一起消亡(HEAD 侧赢);把 §8 摘地板意图**重新挂到新结构**(见 §3) |
| `charging/ChargingView.vue` | 同上 | 同上 | 同上 |
| `elec/ElecView.vue` | 同上 | 同上 | 同上 |
| `salary/SalaryView.vue` | 年份门删除 → 一层全年份矩阵;+失败面(`s12-fail`)/overviewErr/readErr | 给**年份门**(`SchedYearGate` + `S.salaryYear`)挂 fp-fluid;+`s12-s-hint` S 档提示行 | ⚠ **编译陷阱**:`S.salaryYear` 在本分支已删除,保留 master 的年份门块 = 编译错。年份门消亡;`s12-s-hint` 提示行**保留**并入宽表分支;失败面(`v-else-if="readErr"` / overviewErr 硬失败面)是 HEAD 侧新增,**必须保留** |
| `reports/pnl/PnlScheduleView.vue` | `toggleEdit(forced)` 强退分支、draftAsTsv、`:copy-text` | 响应式/查看态迁移 | 两边保留手工合段 |

### 1b. 守卫增量屏(9 个)—— 两边功能正交,逐段两边保留

`alloc/LossLedgerView` · `alloc/PoolLedgerView` · `bills/BillNoticesView` ·
`meters/MeterView` · `params/ParamCenterView` · `reports/balance-sheet|income-statement|trial-balance` ·
`reports/recon/ReconView` · `sales-income/S10View`

本分支在这些文件里加的是**并发/失败态守卫**(script 段的 `watch(editMode)`、写函数开头的
自守 `if (!edit…) return`、模板上的 `fp-stale`/`:disabled`/失败条、深链先认领期):
master 加的是 @media/卡片化/fp-fluid。**互不重叠,冲突全是相邻行 —— 手工合段,别整块保留一边。**

## §2 本分支的契约(合并/后续开发不得破坏)

1. **失败态三件套**(Pv/Cp/Elec/Salary 明细屏):每数据源独立错误槽 + seq 竞态守卫 +
   **错误只在成功分支清**。别把 `readErr.value = null` 挪回请求开头。
2. **写口自守**:写函数开头的 `if (!editX.value) return` / `if (!canRun.value) return`
   一行都不能少 —— 关弹窗只是 UI 补丁,守发请求这层才不漏。
3. **`fp-stale` 盖住全部带写入口的卡**(不止主表 —— CpMeter 电表卡、ElecCost 参数卡是
   曾经漏过的教训);行内提交函数配 `if (reloading.value) return`(样式挡不住已聚焦输入框)。
4. **`FPEditModeButton :disabled` 必须带 `!editMode &&`** —— 组件的 disabled 不分编辑态,
   不带会把「完成」禁掉造成退不出的死锁。
5. **SchedHeader 协议**(04e5686):`toggle-edit` 事件带 `forced?: boolean`;
   用户点「完成」**只 emit 不还锁**,收尾统一在 `watch(props.edit)`(锁跟着 edit 走);
   强制路径(接管/提权到期/换期)立即还锁。脏检查屏(S10/Pnl)的处理函数必须有
   `if (forced)` 直退分支。
6. **presence 协议(前后端一起改过)**:ping 带 `editScopes` 数组逐把续锁,响应是
   `evictions` 数组(单数 `evicted` 是给旧页签的垫层);`PingReq.mode` 是兼容字段别删;
   失锁是**每拍从锁现状推导**;还锁带 `?t=` acquiredAt 围栏。动 `stores/presence.ts` /
   `useEditLock.ts` / 后端 `PresenceStore|PresenceService|LockService` 前先读这几处头注。
7. **useSchedScreen 双监听**:`watch(year)` 清勾选(尊重 `keepSelectionOnNav`)、
   `watch(edit)` 关 drawer/importing —— 附表族全体共用,别在屏内绕开。
8. **lockScopes 的 SAMPLES 表**(`lockScopes.spec.ts`)由 `Object.keys(S)` 完整性断言驱动:
   **新增锁构造器必须同步登记样例与认领导航项**,否则测试红(这是故意的)。
9. **深链先认领期**:`?edit=1`/`?generate=1` 必须先 `adoptYm` 且 `period.picked` 才
   `toggleEdit` —— 反序会占到 `billing-chain:0-00` 被占锁后复核判死。
10. 出账链期**只记会话内**(不进 URL/localStorage);报表层期走查询参数。两者理由相反且都成立
    (period-context-redesign §3.2/§6),别互相"统一"。

## §3 合并时要替响应式侧补的活(他们的意图,我们的新结构)

master 侧给旧结构挂的 `fp-fluid` 消亡后,需按 RESPONSIVE-LAYOUT-SPEC §8 重新评估本分支
新件的屏根:`BookRailShell` 根、`FPMonthGate`/`ChainMonthGate` 矩阵态、`SalaryView` 的
`s12-gate` 矩阵态与 `s12-fail` 失败面、各明细屏的 `*-gate-fail` 硬失败面。
它们都是"屏根首元素"的新形态,响应式分支没见过 —— 合并者要么逐个挂 `fp-fluid` 并做
390 视口抽查,要么先保地板并在 RESPONSIVE spec 的迁移清单里记一笔欠账。**别默默不管。**

## §4 测试即执法 —— 红了别改测试

本分支的护卫断言全部做过**变异验证**(改坏 production → 只有对应那条红)。合并后若某条红,
**先假定是把守卫合丢了**,对照下表恢复守卫,而不是改测试:

| spec | 守的是 |
|---|---|
| `meterPeriodFlow` / `cpMeterFlow` / `elecCostFlow` / `salaryGuards` | 四明细屏失败态三件套、写口自守、fp-stale、写后刷清单 |
| `meterWriteGuards` / `billNoticeWriteGuards` / `poolWriteGuards` / `paramCenterView`(守卫段) | 四链条屏的编辑态收口与写口自守 |
| `schedHeader`(forced/还锁时序段) | 契约 5 |
| `presence` / `useEditLock` / `useEditMode` | 契约 6 + 占锁重叠/围栏/代次 |
| `useSchedScreen` | 契约 7 |
| `lockScopes` | 契约 8(枚举+认领集) |
| `twoBooksRail` / `meterPeriodGate` / `chainPeriodGate` / `salaryMonthGate` / `bookRail` | 动线结构门禁(功能门不回潮/键各归各/共壳) |
| 后端 `PresenceStoreTest` / `PresenceServiceTest` / `LockApiIT`(围栏条) | 契约 6 的后端半 |

## §5 合并后红线(在响应式 §12.3 之上追加)

```bash
cd frontend && npm run build && npx vitest run
cd ../backend && ./mvnw.cmd test -Dtest="PresenceStoreTest,PresenceServiceTest,LockApiIT"
```

后端一行不能省 —— 本分支动了 presence/lock 协议,只跑前端是假绿。
之后照 §12.3 做四宽抽查,再加三条动线抽查:出账链矩阵→链路条横跳不换期;
附表6 左栏切两本账、换页签回来记得住;附表12 一层矩阵直进宽表。

## §6 定向提醒

- **`spec/phase3-pool-opening`(主仓检出,正在动 alloc 两屏)**:你改的
  `PoolLedgerView`/`LossLedgerView` 在本分支也重改过(写口自守/watch(editMode)/
  深链顺序/onDeactivated 收 alertOpen)。你后落地就照 §1b 手工合段;
  **别删 `applyHandoff` 里"先 adoptYm 再 toggleEdit"的顺序**(契约 9)。
- **launch.json**:master 有 `frontend-wt`=5273(响应式分支立的);本 worktree 本地
  另有未提交的 5175 条目。合并后以 master 的 5273 为准,5175 是本会话临时用的。
- 本分支**未推送**。开 PR 前先在本 worktree `git merge origin/master` 按本文解掉
  14 处,过 §5 红线再推 —— 别把冲突留给 PR 页面。

## §7 已知未做(不算冲突,别顺手"修")

附表11 费用类型轴待拍板;schedules-6-12 稿 §4 立项单(明细屏接管三件套/三外壳首载
catch/elec 分析深链等)未立项;后端不校验锁与导入中心绕门是明写的结构前提。
清单以 `2026-08-29-schedules-6-12-flow-redesign.md` §4/§5 为准。
