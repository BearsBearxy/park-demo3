# 预测置信带与「一句话结论」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让经营分析层的图自己把话说清楚 —— 屏上不再出现没有护栏的离群数、没有样本量的百分比、没有读数的带子。

**Architecture:** 三层分工钉死：卡头 `hint` 说「这张图是什么」（≤24 字）· 新增 `.ana-read` 说「读出来是什么」（≤30 字）· `AnaMethodNote` 说「口径」（不限长，可收）。带子统一由 `anaTheme.ts` 的 `bandSeries()` 生成，句子统一由 `anaSentence.ts` 的纯函数生成，未闭月判定统一由 `anaData.ts` 的一个共享谓词生成 —— 三处「唯一事实源」，各屏只消费不重写。

**Tech Stack:** Vue 3.5 `<script setup>` + TypeScript strict · ECharts 6（`components/ana/echartsBundle.ts` 统一装配）· Pinia · vitest 2 + @vue/test-utils · 无新依赖

**Spec:**
- 主稿 `docs/design/FORECAST-BAND-AND-PLAIN-SENTENCE-2026-09-06.md`（270 行，现在 worktree `demo3-analytics-screen-review-e25465`，**未提交**）
- 普查稿 `docs/design/ANALYSIS-SCREEN-REVIEW-2026-09-05.md`（61 行，同一 worktree，**未提交**）
- 房规 `docs/design/PV-ANALYSIS-SPEC.md` §05（已在 master）

> ⚠ 开工第一件事：把这两份稿 commit 进本分支。它们现在只存在于某个 worktree 的未跟踪文件里，
> 谁清一次工作区就没了，而本计划全程引用它们。

---

## Global Constraints

以下每一条都适用于**每一个** Task，不再逐条重复。

1. **基准日必须显式传入，禁止 `new Date()` / `CURDATE()`。** 稿里所有数都是按 **2025-12-01** 算的（稿里没写这句，是反推出来的）。实测对照：

   | 基准日 | 续签率 | 未来 12 月到期 |
   |---|---|---|
   | 2025-12-01 | 18 / 90 = 20.0%（与稿完全吻合） | 83 份 / 209.2 万 |
   | 2026-09-10（真实时钟） | 39 / 136 = 28.7% | 39 份 / 108.1 万 |

   任何取 `asOf` 的纯函数，签名里必须有 `asOf: string` 且无默认值。

2. **禁止修改 `frontend/src/components/ana/anaFmt.ts:74-77` 的 `std`。** 它今天唯一的下游是 `views/analysis/TenantEnergy.logic.ts:6`（`import { std as aStd }`，用在 `:88` 的 `buildParkBand`），那里要的**正是总体口径**。改成 n−1 会静默放松 `TenantEnergyView.vue` 屏上已印出的阈值，并弄红 `TenantEnergy.logic.spec.ts`。稿 §4 那句是「别拿它当残差 σ 用」的预防性警告，**不是工单**。要残差 σ 时复用现成的：`views/analysis/pvMeterAna.logic.ts:547`（`sse/(n-p)`）与 `:559`（半宽 `1.96*sqrt(s2*q)`）。

3. **新做的三种带没有一种是置信区间，屏上的标签不许出现「置信」二字。**

   | 带 | 它是什么 | 不是什么 |
   |---|---|---|
   | 合约租金带 | **预测区间**（对一个未来随机量 `R = Σ r_i·X_i` 的区间） | 不是置信区间。CI 只占它方差的 14%（`Var(p̂)·(Σr)²` 那一项），另外 86% 是个体随机性（`p(1−p)·Σr²`）。**稿里「不能只用 Wilson」那句的技术含义就是「CI 不等于 PI」** —— Wilson 给的是 `p` 的置信区间，你要的是 `R` 的预测区间，只用前者会把带画到约三分之一宽 |
   | 同类对标带 | **描述性分位区间**（观测到的横截面 P25~P75） | 既不是 CI 也不是 PI。它不含任何推断，没有抽样分布也没有模型 —— 正因如此 §05 才允许它，也正因如此它能印百分比 |
   | 未闭月护栏 | **离群标记**（收入 < 0） | 根本不是区间 |

   **全站唯一一条真正的置信区间是已有的那条**：`pvMeterAna.logic.ts:559` 的 `1.96 * sqrt(s2 * q)`（`q = x'(X'X)⁻¹x`），那是回归**拟合均值**的置信带，`PvLabTable.vue:44` 标「95% 置信」是对的。若要改成预测区间，`sqrt` 里必须是 `s2 * (1 + q)` —— **不要顺手加**，那是另一件事。

   ⚠ 主稿标题叫「预测置信带」、§0 开篇写「历史 → 预测 + 置信区间」，两个词并排是松的；但 §1.1 表格写的「Wilson + 个体随机性」是对的。以表格为准。

4. **P25~P75 是中间一半，不是 80%。** 主稿 §3.3 的模板句写「80% 的同类在 {下} ~ {上}」，而 `views/analysis/monitor.logic.ts:116-121` 画的是 `quantile(.25)`~`quantile(.75)`，`TenantEnergyView.vue:163-164` 画的是均值 ±1σ。照抄那句 = 把 50% 说成 80%，当场撒谎。**本计划一律用「中间一半的同类在 {下} ~ {上}」**，均值 ±σ 那条单列口径文案。

5. **未闭月逐格判，不许整期丢。** 2025-12 只有损益侧被年末冲回污染（实测 `pnl_row` 全年只命中一行：`s1 园区总租金收入 = -3,412,533.97`），能耗侧干净。整期丢会连带抹掉 `analysis/anaData.ts:283-320` `buildEnergyMonths` 那条与损益无关的 12 月能耗。普查稿第 45 行的整期判**已被主稿 §2.7 推翻**，以主稿为准。

6. **屏上不写「已闭月」。** 后端确有 `GET /api/review/closed-months`（`ReviewController.java:43`），但它的语义是「整月全部审核项已通过」，不是会计封账，且分析层对它零引用（实测 grep）。屏上写「截至 11 月」或「该月尚未审核完成」。

7. **光伏分栋屏 `PvMeterAnaView.vue` 不加 `.ana-read`。** `PV-ANALYSIS-SPEC.md` §05 禁模型结论，且 `views/__tests__/pvMeterAnaScreen.spec.ts:636` 起有判词扫描门禁会红。它只参与 Task 1 的 helper 收编。

8. **每个纯函数配 `.spec.ts`，断言逐条做破坏验证**（把实现改坏，确认该断言真的红）。这是本仓成文规矩。

9. **跑测试不接管道，判据落在产物上。** `npx vitest run <file>` 直接看它打印的 `Tests  N passed`；`npm run build` 末尾看 `size-check: 合计 X / 3950KB` 那一行原文。`./mvnw verify 2>&1 | tail` 式的写法退出码取自 `tail`，本仓栽过。

10. **体积预算只剩 11.3KB。** 实测 `node scripts/size-check.mjs` → `合计 3938.7KB / 3950KB`，`index 187.4KB / 191KB`。Task 5 是净负体积（长文案压缩，约 −9KB），**Task 7 的空间从那里来**，顺序不许颠倒。

11. **过程中只跑与改动直接相关的 spec 文件；全量留到 Task 9 收口时跑一次。**

12. **禁做清单（主稿 §5，逐条照抄，任何 Task 都不许越线）：**

    | 不许加带的地方 | 理由 |
    |---|---|
    | 光伏 / 电费分表 / 充电桩分站的**任何**预测带 | 三张表 100% 是模拟填充（实测 3171 / 235 / 33 行全是 `simulated`）。`PvMeterService.simulate()` 的逐日权重是种子随机，波动是随机数生成器的性质不是园区的性质 |
    | 月度收缴（`FinCashflowView`） | 80% 带宽 > 均值 150% |
    | 办公楼电量（`ParkEnergyView` 走 `anaData.ts:315` 的 office 累加） | 附表14 有 7 个月存 `0.00` 不是 NULL，序列不存在；附表13 有季节性也过不了样本外（前 6 月定带只盖 1/6） |
    | 财务报表趋势（`FinPnlView` / `FinBalanceView`） | 只有 2024-10 与 2025-10 两个时点 |
    | 台账应收总额（`AnomalyView` 应收 vs 实收条） | 涨幅全来自招商（户数 +32.1%、户均 −4.3%），带子会显得很窄，骗人程度最高 |
    | 保本点（`breakeven.logic.ts`） | 是会计恒等式的代数解，带该加在**输入的收入**上不是加在解上 |
    | 退租活跃度（`ChurnView`） | 当期截面不是时序，流失是离散事件 |
    | 预算（`BudgetView`） | 预算是目标不是观测。注意 `budgetView.logic.ts:6-14` 的 `isForecast` 只是「有预算无实际画虚线描边柱」，不是统计外推，**不受此条约束也不要顺手改** |
    | 到期墙（`expiry.logic.ts:145-162` 的 `wallOption`） | `end_date` 在库里，是排期表不是随机过程。⚠ 与 Task 7 不矛盾，见该任务说明 |
    | 任何标了百分比却没同屏印样本量的句子 | 这是新增时的约束不是存量修改 —— 今天全站没有一句带百分比的读数句 |

    **不许用月度线性回归外推配教科书预测区间**：滚动起点回测名义 80% 只中 2/5，残差正自相关（DW 1.013），公式前提被破坏。月度序列只许印频次原话「过去 5 次中 2 次」。
    **不许用「带子窄」挑序列，只能用回测覆盖挑**：拟合最好的收入 4/5 落空，拟合更差的成本（R² 0.66）与利润（R² 0.61）反而各 4/5 命中。
    **不许拿样本内覆盖率当证据**：用全年 12 个比值定带再回头测这 12 个月，覆盖率会很好看，那是样本内不是预测。

---

## 前置裁定（未拍板不许开工的部分）

| # | 要拍板的一句话 | 卡住哪个 Task |
|---|---|---|
| **D1** | `PV-ANALYSIS-SPEC.md` §05「要过一个模型才得出的是结论，不写」原样保留、只管光伏分栋屏；经营屏开一个口子，补一条对称规矩：**凡是印了概率的句子，必须同屏印出样本量与回测命中数**。 | Task 6 的百分数句、Task 7 全部 |
| **D2** | §05 那条「p / q / σ / 置信区间四处不许出现」的作用域是不是也只管光伏屏。若跨屏生效，`TenantEnergyView.vue:358` 的 hint「灰带 = 跨户均值±σ」当场违规要立刻改。 | Task 5 |
| **D3** | 样本量 20~99 这一档稿里没规定（§2.2 要 ≥100 才可写百分比，§3.3 要 <20 不给区间）。建议三档：**<20 不画带 / 20–99 画带但句子不出百分数 / ≥100 才准写百分数**。 | Task 6 |
| **D4** | §3.3 缺第七条模板「频次句」。模板①的闭嘴出口写着「换频次句」，而月度序列一律不许写百分比，唯一出口正是这条没定义的模板。建议骨架：`{指标}拟合区间 {下}~{上}，过去 {N} 次中 {k} 次`，≤30 字，回测 <5 次就不画带只出点。 | Task 4 |
| **D5** | `AnaMethodNote.vue:42` 去掉 `v-if="tier !== 's'"`、桌面档也走 pill 浮层。一行的事，但同时改 18 个屏的观感。建议先看一屏再全推。 | Task 5 |
| **D6** | `ElecAnalysisView.vue:306` 的双轴要不要真拆成上下两张小图。**本计划不含这一件**，建议单独排。 | 不在本计划内 |

D1 未拍板前，Task 1–5 照做，Task 6 只做「补 n 与样本门」不出百分数句，Task 7 不开工。

---

## File Structure

**新建（3 个）**

| 文件 | 职责 |
|---|---|
| `frontend/src/components/ana/anaSentence.ts` | 七条句式模板，每条一个纯函数，返回 `string \| null`（`null` = 闭嘴）。不做成组件，不做成配置。 |
| `frontend/src/components/ana/__tests__/anaSentence.spec.ts` | 逐条测「该闭嘴时返回 null」「超字上限时抛」。 |
| `frontend/src/views/__tests__/anaCopyLint.spec.ts` | 静态扫描门禁：`hint` ≤24 字、`.ana-read` ≤30 字、带 `%` 的读数句同卡必须有样本量。 |

**修改（按 Task 顺序）**

| 文件 | 改什么 |
|---|---|
| `frontend/vite.config.ts:60-63` | `test` 段加 `testTimeout`（Task 0） |
| `frontend/src/components/ana/anaTheme.ts` | 新增 `bandSeries()`（Task 1） |
| `frontend/src/views/analysis/AnomalyView.vue` | 收编带 + 读数句（Task 1 / 5 / 6） |
| `frontend/src/views/analysis/TenantEnergyView.vue` | 同上 |
| `frontend/src/views/analysis/PvMeterAnaView.vue` | 只收编三处带，不加读数句（Task 1） |
| `frontend/src/analysis/anaData.ts` | 新增共享谓词 `isOutlierMonth`（Task 3） |
| `frontend/src/views/analysis/breakeven.logic.ts:34-41` | 改调共享谓词（Task 3） |
| `frontend/src/views/analysis/cockpit.logic.ts` | `mainChart` 与 `budgetAch` 排除离群月（Task 3） |
| `frontend/src/components/ana/ana.css` | 新增 `.ana-read` / `.ana-ref`（Task 4） |
| `frontend/src/components/ana/AnaMethodNote.vue:42` | 去掉 tier 判断（Task 5，需 D5） |
| `frontend/src/views/analysis/monitor.logic.ts` | `band` 结构加 `n`（Task 6） |
| `frontend/src/views/analysis/TenantEnergy.logic.ts` | `ParkBand` 加 `n`（Task 6） |
| `frontend/src/views/analysis/expiry.logic.ts` | 新增 `lockedRentByMonth` / `buildRentRoll`（Task 7） |
| `frontend/src/views/analysis/ExpiryView.vue` | 新增一张卡（Task 7） |

---

## Task 0: 先把那条 flake 摁住

**为什么在第一位**：Task 1 要改 `pvMeterAnaScreen.spec.ts:632`。而这个文件今天在全量跑里会随机红一条（实测 2664 passed / 1 failed，红的是「回看已经过去的月」那条，报 `Test timed out in 5000ms`，实测耗时 7703ms；单独跑该文件 53/53 全绿）。不先摁住，你分不清红的是自己改坏了还是 flake。

**Files:**
- Modify: `frontend/vite.config.ts:60-63`

**Interfaces:**
- Consumes: 无
- Produces: 全仓测试的 `testTimeout` 基线，后续每个 Task 的验收都靠它稳定

- [ ] **Step 1: 复现，拿到红的证据**

```bash
cd frontend && npx vitest run src/views/__tests__/pvMeterAnaScreen.spec.ts --reporter=json --outputFile=/tmp/a.json
```

单跑应当全绿（53 passed）。红只在全量并行下出现 —— 这正是它是 flake 而非缺陷的判据。

- [ ] **Step 2: 改配置**

`frontend/vite.config.ts` 第 60-63 行今天是：

```ts
  test: {
    environment: 'jsdom',
    globals: true,
  },
```

改成：

```ts
  test: {
    environment: 'jsdom',
    globals: true,
    // 2026-09-10:全量并行下重屏 spec 撞 5000ms 默认线(pvMeterAnaScreen 单条实测 7703ms,
    // 同文件另有 5 条落在 3993~7703ms)。放宽到 15s —— 真死循环仍会被拦,
    // 而 exceljs 那两条自带 30s 的 describe 级 timeout 不受影响(billNoticeExcel.spec.ts:258)。
    testTimeout: 15_000,
  },
```

- [ ] **Step 3: 连跑三次全量，确认不再随机红**

```bash
cd frontend && for i in 1 2 3; do npx vitest run --reporter=json --outputFile=/tmp/v$i.json; done
```

判据落产物，不看退出码：

```bash
node -e "for(const f of ['/tmp/v1.json','/tmp/v2.json','/tmp/v3.json']){const j=require(f);let p=0,x=0;for(const r of j.testResults)for(const a of r.assertionResults){a.status==='passed'?p++:x++}console.log(f,'passed',p,'failed',x)}"
```

Expected: 三行 `failed 0`。

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "test(ana): 全量测试的默认超时 5s → 15s —— 重屏 spec 撞线导致 CI 随机红

pvMeterAnaScreen.spec.ts 单条实测 7703ms、同文件另有 5 条在 3993~7703ms,
在 170+ 文件并行下被饿到超过 5000ms 默认线。单跑该文件 53/53 全绿,
说明是并行竞争不是功能缺陷。放宽到 15s;真死循环仍被拦。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 1: `bandSeries` helper 收编五处手写带

**为什么提到第一位**：主稿 §5 把这条排在 P3，但 §5 的 P2 自己写着「复用已有的三处带」—— 先做 P2 就得先手写一遍再回头收编，两遍活。顺序反了。

**另外纠一个数**：稿说「仓库里已独立实现三次」，**实测是五处**（`stack:` + `lineStyle: { opacity: 0 }` 已穷尽全仓）。漏的两处都在 `PvMeterAnaView` 自己身上。

**Files:**
- Modify: `frontend/src/components/ana/anaTheme.ts`（新增导出）
- Modify: `frontend/src/views/analysis/AnomalyView.vue:66-69, 88-89`
- Modify: `frontend/src/views/analysis/TenantEnergyView.vue:154, 163-164`
- Modify: `frontend/src/views/analysis/PvMeterAnaView.vue:323-327, 831-838, 906-911`
- Modify: `frontend/src/views/__tests__/pvMeterAnaScreen.spec.ts:632`（`'p25'` → `''`）
- Create: `frontend/src/components/ana/__tests__/bandSeries.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `bandSeries(lo, hi, opt?) => object[]`，签名见 Step 3。Task 6、Task 7 都消费它。

- [ ] **Step 1: 写失败的测试**

Create `frontend/src/components/ana/__tests__/bandSeries.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { bandSeries } from '../anaTheme'

describe('bandSeries —— 全站唯一一份带子', () => {
  it('返回两条:下沿哨兵 + 上沿宽度,宽度 = hi − lo', () => {
    const s = bandSeries([1, 2], [4, 6]) as Array<Record<string, unknown>>
    expect(s).toHaveLength(2)
    expect(s[0].data).toEqual([1, 2])
    expect(s[1].data).toEqual([3, 4])
  })

  it('❗任一端为 null 则该点整体 null —— 五处旧写法有四种 null 判法,收编后只许一种', () => {
    const s = bandSeries([1, null, 3], [4, 8, null]) as Array<Record<string, unknown>>
    expect(s[1].data).toEqual([3, null, null])
    expect(s[0].data).toEqual([1, null, null])
  })

  it('下沿哨兵不进图例、不吃 tooltip', () => {
    const s = bandSeries([1], [2]) as Array<Record<string, unknown>>
    expect(s[0].name).toBe('')
    expect(s[0].tooltip).toEqual({ show: false })
    expect(s[0].silent).toBe(true)
    expect((s[0].lineStyle as Record<string, unknown>).opacity).toBe(0)
  })

  it('dp 控制小数位:PV 三处要 3~4 位,金额两处要 0 位', () => {
    const s = bandSeries([1.23456], [2.34567], { dp: 3 }) as Array<Record<string, unknown>>
    expect(s[1].data).toEqual([1.111])
  })

  it('stack 键可换 —— 同屏三条带并存时必须互不串台(PvMeterAnaView 的 band/q/se)', () => {
    const s = bandSeries([1], [2], { stack: 'se' }) as Array<Record<string, unknown>>
    expect(s[0].stack).toBe('se')
    expect(s[1].stack).toBe('se')
  })

  it('series 附加项透传 —— B3 要展开它自己的 const L', () => {
    const s = bandSeries([1], [2], { series: { smooth: true } }) as Array<Record<string, unknown>>
    expect(s[0].smooth).toBe(true)
    expect(s[1].smooth).toBe(true)
  })
})
```

- [ ] **Step 2: 跑它，确认红**

```bash
cd frontend && npx vitest run src/components/ana/__tests__/bandSeries.spec.ts
```

Expected: FAIL，`bandSeries is not a function`。

- [ ] **Step 3: 实现**

在 `frontend/src/components/ana/anaTheme.ts` 末尾追加（放这里不放 `anaFmt.ts` —— 后者被 logic 层引用，塞 ECharts option 会让 logic 层顺带吃进图表形状；带色本来就是色板决定）：

```ts
/**
 * 全站唯一一份「带子」—— 两条堆叠线:下沿透明哨兵 + 上沿只留填充,不描边(描了会被读成两条数据线)。
 *
 * 收编前全仓有五处逐字近似的手写:AnomalyView(园区 P25~P75)、TenantEnergyView(跨户均值±σ)、
 * PvMeterAnaView 三处(各栋四分位距 stack 'q'、样条带 stack 'band'、斜率标准误 stack 'se')。
 * 五处写了**四种** null 判法,收编后只许这一种:任一端 null → 该点整体 null。
 *
 * ⚠ 带色不在这里统一:AnomalyView/TenantEnergyView 用 rgba(28,28,28,.07),PV 三处用 C.INK100,
 *   差一档灰是有意的(PV-ANALYSIS-SPEC 要求渐变透明不描硬边)。统一配色是配色决定,不搭这趟车。
 */
export function bandSeries(
  lo: (number | null)[],
  hi: (number | null)[],
  opt: { name?: string; color?: string; stack?: string; dp?: number; series?: Record<string, unknown> } = {},
): object[] {
  const { name = '', color = 'rgba(28,28,28,.07)', stack = 'band', dp = 0, series = {} } = opt
  const base = { type: 'line', stack, symbol: 'none', silent: true, lineStyle: { opacity: 0 }, ...series }
  const width = lo.map((l, i) => {
    const h = hi[i]
    return l == null || h == null ? null : +(h - l).toFixed(dp)
  })
  const floor = lo.map((l, i) => (l == null || hi[i] == null ? null : +l.toFixed(dp)))
  return [
    { ...base, name: '', data: floor, tooltip: { show: false } },
    { ...base, name, data: width, areaStyle: { color } },
  ]
}
```

- [ ] **Step 4: 跑，确认绿**

```bash
cd frontend && npx vitest run src/components/ana/__tests__/bandSeries.spec.ts
```

Expected: `Tests  6 passed`。

- [ ] **Step 5: 收编 AnomalyView**

`AnomalyView.vue:66-69` 今天是：

```ts
  const p25 = t.months.map((ym) => m.band[ym]?.p25 ?? null)
  const bandW = t.months.map((ym) => (m.band[ym] ? m.band[ym].p75 - m.band[ym].p25 : null))
```

改成（删掉 `bandW`，改出 `p75`）：

```ts
  const p25 = t.months.map((ym) => m.band[ym]?.p25 ?? null)
  const p75 = t.months.map((ym) => m.band[ym]?.p75 ?? null)
```

`:88-89` 那两行整体替换为：

```ts
      ...bandSeries(p25, p75, { name: '园区P25~P75' }),
```

顶部加 `import { bandSeries } from '@/components/ana/anaTheme'`（若该文件已从 anaTheme 引入其它符号，并进同一条 import）。

- [ ] **Step 6: 收编 TenantEnergyView**

`TenantEnergyView.vue:154` 的 `const diff = ...` 整行删掉；`:163-164` 两行替换为：

```ts
      ...bandSeries(band.lo, band.hi, { name: '均值±σ带' }),
```

- [ ] **Step 7: 收编 PvMeterAnaView 三处**

三处分别是 `:323-327`（`stack 'q'`，展开 `:315` 的 `const L`）、`:831-838`（`stack 'band'`）、`:906-911`（`stack 'se'`）。逐处替换，注意三处的 `color` 都传 `C.INK100`、`dp` 按各自原有的 `toFixed` 位数传（`:325` 是 3 位、`:831` 是 4 位、`:906` 是 3 位）：

```ts
      ...bandSeries(p25, p75, { name: '各栋四分位距', color: C.INK100, stack: 'q', dp: 3, series: L }),
```

`:632` 的 `pvMeterAnaScreen.spec.ts` 里断言 `'p25'` 的那处改成 `''`（下沿哨兵统一无名）。

- [ ] **Step 8: 加一条「别再手写」的门禁**

Append to `frontend/src/components/ana/__tests__/bandSeries.spec.ts`：

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

it('❗全仓 lineStyle:{opacity:0} 只许出现在 anaTheme.ts —— 没这条,下一处带照旧手写', () => {
  const dir = join(__dirname, '../../../views/analysis')
  const hits: string[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.vue') && !f.endsWith('.ts')) continue
    const s = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    if (/lineStyle:\s*\{\s*opacity:\s*0\s*\}/.test(s)) hits.push(f)
  }
  expect(hits, `这些文件还在手写带子,改用 bandSeries(): ${hits.join(', ')}`).toEqual([])
})
```

- [ ] **Step 9: 跑相关 spec（不跑全量）**

```bash
cd frontend && npx vitest run src/components/ana/__tests__/ src/views/__tests__/pvMeterAnaScreen.spec.ts src/views/analysis/TenantEnergy.logic.spec.ts
```

Expected: 全绿。

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/ana/anaTheme.ts frontend/src/components/ana/__tests__/bandSeries.spec.ts frontend/src/views/analysis/AnomalyView.vue frontend/src/views/analysis/TenantEnergyView.vue frontend/src/views/analysis/PvMeterAnaView.vue frontend/src/views/__tests__/pvMeterAnaScreen.spec.ts
git commit -m "refactor(ana): 五处手写带收编成 bandSeries —— 并把四种 null 判法收成一种

稿说仓库里独立实现过三次,实测是五处(PvMeterAnaView 一个屏占三处:
四分位距 stack 'q'、样条带 'band'、斜率标准误 'se')。

⚠ 不是零行为变化:B9/B10 两条无名带今天没有 tooltip 抑制,而两图都是
tooltip:{trigger:'axis'},它们正漏进坐标轴 tooltip。helper 把 tooltip:{show:false}
提成默认,这两张图的 tooltip 内容会变 —— 是修好,不是回归。

带色**没有**统一:PV 三处仍是 C.INK100,另两处仍是 rgba(28,28,28,.07)。
统一配色是配色决定,不搭这趟车。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 文案 lint 门禁先红

**为什么在改文案之前**：门禁先红再逐屏改绿。反过来做就是改完没人守，下一个屏又写长。

**先定死判据口径**：`class="hint"` 实测 100 处（19 个文件，`PvMeterAnaView` 独占 18 处）。按**去掉标签与 `{{ }}` 插值后的可见字符数**判，40 处超标；按纯中文字符判只有 16 处。稿 §3.5 的旗舰例子 `AnomalyView.vue:232` 剥掉插值后中文只有 19 字（稿数成 33 是连符号一起数的）—— **照稿的字面判据，CI 抓不到它自己举的第一个例子**。所以取「可见字符数」口径。

**Files:**
- Create: `frontend/src/views/__tests__/anaCopyLint.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: 常量 `HINT_MAX = 24` / `READ_MAX = 30`；Task 4、5、6 每改一屏就跑它

- [ ] **Step 1: 写门禁**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 分析层文案门禁(FORECAST-BAND-AND-PLAIN-SENTENCE §3.4)。
 *
 * 判据口径**先定死**:「可见字符数」= 剥掉 HTML 标签、{{ }} 插值、v-* 指令后剩下的字符数。
 * 不用「纯中文字符数」—— 按那个判,稿自己举的旗舰例子 AnomalyView 那条(剥插值后中文 19 字)
 * 根本抓不到,门禁形同虚设。
 *
 * 起点写死在断言里:立档当天 hint 超标 40 处。往下降,不许往上涨。
 */
const HINT_MAX = 24
const READ_MAX = 30
const HINT_OVER_BASELINE = 40   // ⚠ 只许改小

const DIR = join(__dirname, '../analysis')
const strip = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\s+/g, '').trim()

function scan(re: RegExp): { file: string; text: string; len: number }[] {
  const out: { file: string; text: string; len: number }[] = []
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.vue')) continue
    const src = readFileSync(join(DIR, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const m of src.matchAll(re)) {
      const t = strip(m[1] ?? '')
      if (t) out.push({ file: f, text: t, len: [...t].length })
    }
  }
  return out
}

describe('分析层文案门禁', () => {
  it(`❗卡头 hint ≤ ${HINT_MAX} 可见字 —— 超标处只许减少`, () => {
    const over = scan(/class="hint"[^>]*>([\s\S]*?)<\/span>/g).filter((x) => x.len > HINT_MAX)
    expect(
      over.length,
      `超标 ${over.length} 处(基线 ${HINT_OVER_BASELINE}):\n` +
        over.map((x) => `  ${x.file} ${x.len}字 ${x.text.slice(0, 30)}`).join('\n'),
    ).toBeLessThanOrEqual(HINT_OVER_BASELINE)
  })

  it(`❗读数句 .ana-read ≤ ${READ_MAX} 可见字`, () => {
    const over = scan(/class="ana-read"[^>]*>([\s\S]*?)<\/p>/g).filter((x) => x.len > READ_MAX)
    expect(over.map((x) => `${x.file}:${x.len}字`)).toEqual([])
  })

  it('❗带 % 的读数句,同一个文件里必须找得到样本量 —— 否则就是把「样本 5」包装成一个小数点', () => {
    const bad: string[] = []
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.vue')) continue
      const src = readFileSync(join(DIR, f), 'utf8')
      const reads = [...src.matchAll(/class="ana-read"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1])
      if (!reads.some((r) => r.includes('%'))) continue
      if (!/class="ana-ref"/.test(src)) bad.push(f)
    }
    expect(bad, `这些屏印了百分数却没有参照系小字: ${bad.join(', ')}`).toEqual([])
  })
})
```

- [ ] **Step 2: 跑，确认三条的状态**

```bash
cd frontend && npx vitest run src/views/__tests__/anaCopyLint.spec.ts
```

Expected: 三条**全绿**（第一条 40 ≤ 40 卡在基线上，后两条因为今天全仓 `.ana-read` 零命中而空过）。如果第一条报的数不是 40，**把断言里的 `HINT_OVER_BASELINE` 改成实测值并在 commit message 里写明**，不要改判据去凑 40。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/__tests__/anaCopyLint.spec.ts
git commit -m "test(ana): 分析层文案门禁 —— hint ≤24 字 / 读数句 ≤30 字 / 有 % 必有样本量

判据口径取「可见字符数」(剥标签与插值后)不取「纯中文字符数」:
按后者判,稿自己举的旗舰例子 AnomalyView 那条(剥插值后中文 19 字)抓不到。

hint 超标基线写死 40 处,只许往下降。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: P1 未闭月护栏

**Files:**
- Modify: `frontend/src/analysis/anaData.ts`（新增导出，挨着 `:87-94` 的 `PnlSummary`）
- Modify: `frontend/src/views/analysis/breakeven.logic.ts:32-42`
- Modify: `frontend/src/views/analysis/cockpit.logic.ts:49-60, 194-201`
- Modify: `frontend/src/views/analysis/CockpitView.vue`（KPI 副标题 + banner）
- Test: `frontend/src/analysis/anaData.spec.ts`、`frontend/src/views/analysis/cockpit.logic.spec.ts`、`breakeven.logic.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `usableMonths(months: number[], revenue: (number|null)[]): number[]` 与 `isOutlierMonth(revenue: (number|null)[], m: number): boolean`，Task 4 的 KPI 副标题消费 `usableMonths` 的长度

**别写第三个谓词**：`breakeven.logic.ts:34-41` 的 `anchorMonth` 里 `:38` 已经是 `(revenue[months[i] - 1] ?? 0) > 0`，注释 `:32-33` 明说原退「最新覆盖月」会落负收入月导致 CVP 收入线倒挂。把这个谓词提上去，三处共用。

- [ ] **Step 1: 写失败的测试**

Append to `frontend/src/analysis/anaData.spec.ts`:

```ts
import { usableMonths, isOutlierMonth } from './anaData'

describe('未闭月护栏(FORECAST §2.7 —— 逐格判,不整期丢)', () => {
  const rev = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, -636000]

  it('❗收入为负的月被判离群', () => {
    expect(isOutlierMonth(rev, 12)).toBe(true)
    expect(isOutlierMonth(rev, 11)).toBe(false)
  })

  it('❗可用月剔掉离群月,顺序不变', () => {
    expect(usableMonths([1, 2, 11, 12], rev)).toEqual([1, 2, 11])
  })

  it('❗全负时不返回空 —— 空数组会让分母为 0,屏上出 NaN%', () => {
    expect(usableMonths([1, 2], [-1, -2])).toEqual([1, 2])
  })

  it('❗null 不算离群 —— 缺数据月与被污染月是两件事', () => {
    expect(isOutlierMonth([null, 5], 1)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑，确认红**

```bash
cd frontend && npx vitest run src/analysis/anaData.spec.ts
```

Expected: FAIL，`usableMonths is not exported`。

- [ ] **Step 3: 实现**

在 `frontend/src/analysis/anaData.ts` 的 `PnlSummary`（`:87-94`）之后追加：

```ts
/**
 * 未闭月(离群月)判定 —— **全站唯一一处**(FORECAST-BAND §2.7)。
 *
 * 判据只看损益侧收入是否为负:2025-12 的年末冲回把 pnl_row s1 打到 −341.3 万,
 * 距点预测 42.7 个残差标准差。**逐格判,不整期丢** —— 同一个 12 月,
 * buildEnergyMonths(:283-320) 那条能耗序列完全干净(电量 811,100 度正常入账),
 * 整期丢等于白扔四条与损益无关的序列的最后一个点。
 *
 * 谓词本体来自 breakeven.logic.ts:38(那里为了 CVP 收入线不倒挂已经这么判过一次),
 * 提上来三处共用:CVP 口径月锚、驾驶舱趋势轴、预算达成率分母。
 *
 * ⚠ null ≠ 离群。缺数据月是「没录」,离群月是「录了但被污染」,两者画法不同。
 */
export function isOutlierMonth(revenue: (number | null)[], m: number): boolean {
  const v = revenue[m - 1]
  return v != null && v < 0
}

/** 可用月 = 覆盖月剔掉离群月;**全离群时原样返回** —— 返回空数组会让下游分母为 0,屏上出 NaN%。 */
export function usableMonths(months: number[], revenue: (number | null)[]): number[] {
  const ok = months.filter((m) => !isOutlierMonth(revenue, m))
  return ok.length ? ok : months
}
```

- [ ] **Step 4: 跑，确认绿**

```bash
cd frontend && npx vitest run src/analysis/anaData.spec.ts
```

- [ ] **Step 5: 三处改调共享谓词**

`breakeven.logic.ts:37-39` 的循环体改成调 `isOutlierMonth`：

```ts
  for (let i = months.length - 1; i >= 0; i--) {
    if (!isOutlierMonth(revenue, months[i]) && (revenue[months[i] - 1] ?? 0) > 0) {
      return { month: months[i], allNegative: false }
    }
  }
```

`cockpit.logic.ts:194-201` 的 `budgetAch` 改成（多回一个 `usedMonths` 供 KPI 副标题用）：

```ts
export function budgetAch(budgetRows: BudgetRowDTO[], pnl: PnlSummary | null, year: number): BudgetAch | null {
  const b = budgetRows.find((r) => r.year === year && matchBudgetKey(r.label, r.sub) === 'revenue')?.budget
  if (!b) return null
  const rev = pnl?.revenue ?? []
  // 达成率分母排除离群月:2025-12 的年末冲回(收入 −63.6 万)被无条件加进来,
  // 会把 2025 年达成率从 105.6% 压成 94.6% —— 差 11 个点且方向相反。
  const used = rev.map((_, i) => i + 1).filter((m) => rev[m - 1] != null && !isOutlierMonth(rev, m))
  if (!used.length) return null
  const actual = used.reduce((s, m) => s + (rev[m - 1] as number), 0)
  return { budget: b, actual, rate: (actual / b) * 100, gap: b - actual, usedMonths: used }
}
```

`BudgetAch` 接口加 `usedMonths: number[]`。`cockpit.logic.ts:49-60` 的 `mainChart` 用 `usableMonths` 决定 y 轴量程，离群月的数据点仍画但标记为带外红点。

同步改 `cockpit.logic.ts:3` 那句写死 94.6% 的锚点注释，否则下一个人拿它当回归基准。

- [ ] **Step 6: 屏上措辞**

`CockpitView.vue:280` 的利润率 note 加上限守卫（`margin > 300` 时显示 `—` + 「基数过小」，普查稿 §2.5「数值失真门」）；预算达成 KPI 副标题按 `usedMonths` 印「1–11 月」；主图卡挂 `AnaPeriodBanner`（`CockpitView.vue:299` 有现成用法），文案「2025-12 为年末冲回，已排除在趋势与达成率之外」。**不写「已闭月」**。

- [ ] **Step 7: 跑相关 spec（七个文件，不跑全量）**

```bash
cd frontend && npx vitest run src/analysis/anaData.spec.ts src/views/analysis/cockpit.logic.spec.ts src/views/analysis/breakeven.logic.spec.ts src/views/analysis/budgetView.logic.spec.ts src/views/__tests__/anaCopyLint.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/analysis/anaData.ts frontend/src/analysis/anaData.spec.ts frontend/src/views/analysis/breakeven.logic.ts frontend/src/views/analysis/cockpit.logic.ts frontend/src/views/analysis/CockpitView.vue frontend/src/views/analysis/cockpit.logic.spec.ts
git commit -m "fix(ana): 未闭月护栏 —— 驾驶舱 2025 达成率 94.6% 实为 105.6%

budgetAch 无条件把全部非 null 月相加(cockpit.logic.ts:197 filter + :199 reduce),
2025-12 的年末冲回(收入 −63.6 万)照收,把达成率压低 11 个点且方向相反。

判据逐格不整期:同一个 12 月能耗侧干净(电量 811,100 度正常入账),
整期丢会白扔 buildEnergyMonths 那条序列的第 12 个点。

谓词只此一处:breakeven.logic.ts:38 早为 CVP 收入线不倒挂判过一次,提上来三处共用。
屏上写「截至 11 月」不写「已闭月」—— closed-months 端点的语义是「审核项全过」,
不是会计封账,且分析层对它零引用。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 一句话结论体系的骨架

**四槽落位**（今天③④两槽在 DOM 里根本不存在）：

| 槽 | 承载 | 今天 |
|---|---|---|
| ① 量 | 图形：主线 `endLabel` | 三处带图都没有线端 label |
| ② 域 | 图形：带 + 上下沿标数 | 五处带一处都没标数 |
| ③ 概率 | 文字：`.ana-read` | **不存在** |
| ④ 参照系 | 文字：`.ana-ref` 小字 | **不存在** |

**读数句坚决不进 `AnaMethodNote`**：`AnaMethodNote.vue:48-54` 的 S 档是 pill + 浮层、默认收起，把结论藏进去等于手机上看不见结论。

**Files:**
- Modify: `frontend/src/components/ana/ana.css`（`.av2-card-h .hint` 那条旁边）
- Create: `frontend/src/components/ana/anaSentence.ts`
- Create: `frontend/src/components/ana/__tests__/anaSentence.spec.ts`

**Interfaces:**
- Consumes: `usableMonths` from Task 3
- Produces: 七个 `s*()` 函数，签名见 Step 2；Task 5、6、7 全部消费

- [ ] **Step 1: 两条 CSS**

在 `frontend/src/components/ana/ana.css` 的 `.av2-card-h .hint` 之后追加：

```css
/* 读数句(FORECAST §3.4):≤30 字,全档常显 —— 不许收进 ⓘ 浮层,
   那是口径的位置;结论收起来等于手机上看不见结论。
   ⚠ 写法照本文件既有的 .ak-sub(:39)/.ak-bar-name(:53):font-size + color 分开写,
   不用 font: var(--type-*) 简写 —— ana.css 全文没有那种写法。 */
.ana-read { margin: 8px 0 0; font-size: var(--fs-label); color: var(--text-primary); }
/* 参照系小字:≤28 字,必带三件 —— 样本量 n · 口径列 · 单位。
   砍了就是把「样本 5」包装成一个 71.3% 的小数点。 */
.ana-ref { margin: 2px 0 0; font-size: var(--fs-micro); color: var(--text-muted); }
```

- [ ] **Step 2: 写失败的测试**

Create `frontend/src/components/ana/__tests__/anaSentence.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sPeer, sAchieve, sShare, sRisk, sThin, sFreq } from '../anaSentence'

const len = (s: string | null) => (s == null ? 0 : [...s].length)

describe('一句话结论模板(FORECAST §3.3/§3.4)', () => {
  it('❗同类对标:n < 20 不给区间,只报样本量', () => {
    expect(sPeer({ name: '金纳', value: 7712, pct: 0.9, lo: 3000, hi: 9000, n: 19 }))
      .toBe('金纳 ¥7,712，同类样本 19 户，不给区间')
  })

  it('❗同类对标:20 ≤ n < 100 画带但不出百分数(D3 三档)', () => {
    const s = sPeer({ name: '金纳', value: 7712, pct: 0.9, lo: 3000, hi: 9000, n: 50 })
    expect(s).not.toMatch(/%/)
    expect(s).toContain('高于同类中位数')
  })

  it('❗同类对标:n ≥ 100 才准写百分数,且句子里写「中间一半」不写「80%」', () => {
    const s = sPeer({ name: '金纳', value: 7712, pct: 0.9, lo: 3000, hi: 9000, n: 251 })
    expect(s).toContain('比 90% 的同类高')
    expect(s).toContain('中间一半')
    expect(s).not.toContain('80%')
    expect(len(s)).toBeLessThanOrEqual(34)
  })

  it('❗达成偏离:在阈值内 → 闭嘴(返回 null),不是返回「无偏离」', () => {
    expect(sAchieve({ label: '预算达成', value: 100.4, target: '预算', gapPct: 0.4, th: 1 })).toBeNull()
  })

  it('❗结构占比:最大项 < 30% → 闭嘴', () => {
    expect(sShare({ n: 3, pct: 62, maxPct: 22 })).toBeNull()
  })

  it('❗风险:无命中 → 闭嘴,且不许写「无异常」', () => {
    expect(sRisk({ n: 0, amount: 0, k: 3, pct: 0 })).toBeNull()
  })

  it('❗数据不足:永不省略', () => {
    expect(sThin({ label: '资产负债', n: 2, cannot: '画不了趋势' }))
      .toBe('资产负债只有 2 期，画不了趋势')
  })

  it('❗频次句(D4):回测 < 5 次 → 闭嘴,不画带只出点', () => {
    expect(sFreq({ label: '园区收入', lo: 700, hi: 780, backtests: 4, hits: 2 })).toBeNull()
  })

  it('❗频次句:够 5 次时写原话不写百分比 —— 月度序列一律不许标概率', () => {
    const s = sFreq({ label: '园区收入', lo: 700, hi: 780, backtests: 5, hits: 2 })
    expect(s).toBe('园区收入拟合区间 700~780，过去 5 次中 2 次')
    expect(s).not.toMatch(/%/)
    expect(len(s)).toBeLessThanOrEqual(30)
  })
})
```

- [ ] **Step 3: 跑，确认红**

```bash
cd frontend && npx vitest run src/components/ana/__tests__/anaSentence.spec.ts
```

- [ ] **Step 4: 实现七条模板**

Create `frontend/src/components/ana/anaSentence.ts`：

```ts
/**
 * 一句话结论的七条模板(FORECAST-BAND-AND-PLAIN-SENTENCE §3.3/§3.4)。
 *
 * 三条规矩,写在这里免得每条函数各写一遍:
 *  ① 句子只负责读数,不负责解释画法。画法能自己说的,句子闭嘴。
 *  ② 能直接读出来的写事实;要过模型的写事实 + 样本量。样本量印不出来的,不许写百分比。
 *  ③ 该闭嘴时返回 null,**不是**返回「无异常」「暂无偏离」这类占位句 ——
 *    那等于用一句废话占住屏上最贵的一行。
 *
 * 为什么是七条不是稿里的六条:模板①「预测区间」的闭嘴出口写着「换频次句」,
 * 而六行里没有这条;又因为 §0/§2.1 判定月度外推一律不许写百分比,
 * 模板①对本项目**所有**月度序列都不可用,唯一出口恰好是这条没定义的模板。
 * 补为 sFreq(D4 待拍板)。sForecast 因此只在有真实样本外回测覆盖率时才出句。
 */

/** 全角逗号统一,金额千分位,与 anaFmt 的 fint 同形但不引它(避免 logic 层反向依赖)。 */
const money = (n: number): string => '¥' + Math.round(n).toLocaleString('en-US')
const pct1 = (n: number): string => n.toFixed(1).replace(/\.0$/, '') + '%'

/** ① 预测区间 —— ≤30 字。只在有样本外回测覆盖率时才出句;否则调用方改用 sFreq。 */
export function sForecast(a: {
  period: string; label: string; value: number; p: number; lo: number; hi: number; backtests: number
}): string | null {
  if (a.backtests < 5) return null
  return `${a.period}${a.label}预计 ${money(a.value)}，${pct1(a.p)} 落在 ${money(a.lo)} ~ ${money(a.hi)}`
}

/** ② 同类对标 —— ≤34 字。三档(D3):<20 只报样本量 / 20-99 不出百分数 / ≥100 才准写百分数。 */
export function sPeer(a: {
  name: string; value: number; pct: number; lo: number; hi: number; n: number
}): string {
  if (a.n < 20) return `${a.name} ${money(a.value)}，同类样本 ${a.n} 户，不给区间`
  if (a.n < 100) return `${a.name} ${money(a.value)}，高于同类中位数`
  // ⚠「中间一半」不是「80%」:带画的是 P25~P75。写 80% 就是把 50% 说成 80%。
  return `${a.name} ${money(a.value)}，比 ${pct1(a.pct * 100)} 的同类高；中间一半的同类在 ${money(a.lo)} ~ ${money(a.hi)}`
}

/** ③ 达成偏离 —— ≤22 字。偏离在阈值内 → 闭嘴。 */
export function sAchieve(a: {
  label: string; value: number; target: string; gapPct: number; th: number
}): string | null {
  if (Math.abs(a.gapPct) < a.th) return null
  return `${a.label} ${pct1(a.value)}，离${a.target} ${pct1(a.gapPct)}`
}

/** ④ 结构占比 —— ≤16 字。最大项 < 30% → 闭嘴。 */
export function sShare(a: { n: number; pct: number; maxPct: number }): string | null {
  if (a.maxPct < 30) return null
  return `前 ${a.n} 项占 ${pct1(a.pct)}`
}

/** ⑤ 风险 —— ≤24 字。无命中 → 闭嘴,且**不许**写「无异常」。 */
export function sRisk(a: { n: number; amount: number; k: number; pct: number }): string | null {
  if (!a.n) return null
  return `${a.n} 户欠 ${money(a.amount)}，前 ${a.k} 户占 ${pct1(a.pct)}`
}

/** ⑥ 数据不足 —— ≤20 字。**永不省略**。 */
export function sThin(a: { label: string; n: number; cannot: string }): string {
  return `${a.label}只有 ${a.n} 期，${a.cannot}`
}

/** ⑦ 频次句(D4) —— ≤30 字。回测 < 5 次 → 闭嘴,不画带只出点。**不写百分比**。 */
export function sFreq(a: {
  label: string; lo: number; hi: number; backtests: number; hits: number
}): string | null {
  if (a.backtests < 5) return null
  return `${a.label}拟合区间 ${a.lo}~${a.hi}，过去 ${a.backtests} 次中 ${a.hits} 次`
}
```

Step 2 的测试里 import 六个即可（`sForecast` 另在同文件补两条：`backtests < 5` 返回 `null`、`≥ 5` 时字数 ≤30）。

- [ ] **Step 5: 跑，确认绿**

```bash
cd frontend && npx vitest run src/components/ana/__tests__/anaSentence.spec.ts src/views/__tests__/anaCopyLint.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ana/ana.css frontend/src/components/ana/anaSentence.ts frontend/src/components/ana/__tests__/anaSentence.spec.ts
git commit -m "feat(ana): 一句话结论体系 —— 七条模板 + .ana-read/.ana-ref 两条 CSS

四槽分工:量与域交给图形,概率与参照系交给文字。③④两槽今天 DOM 里不存在,
本次补上。读数句不进 AnaMethodNote —— 那是口径的位置,S 档默认收起,
把结论藏进去等于手机上看不见结论。

七条而不是稿里的六条:模板①的闭嘴出口写着「换频次句」,而六行里没有这条,
且按 §0/§2.1 月度序列一律不许写百分比,模板①对本项目所有月序列都不可用 ——
唯一出口恰好是这条没定义的模板。补为模板⑦(D4 待拍板)。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 六处文案改写 + `AnaMethodNote` 桌面档

⚠ 需 **D2**（σ 禁令作用域）与 **D5**（桌面档改 pill）拍板。

**稿 §3.5 六条今天的位置**（行号全部漂了，见下）。其中 **2/6 `ParkView.vue:252` 已作废** —— 稿说那条空态「与库内不符」，但 `ParkView.vue:5-8` 的代码注释显示 2026-09-06 已按同口径改过。**从清单划掉，别改。**

`§3.5` 里 `TenantEnergy` / `FinCashflow` / `PvRoi` 三处写的「其余收进 ⓘ」**今天已经做完了**（三段都已在 `<AnaMethodNote>` 里）。真问题是 `AnaMethodNote.vue:42` 桌面档把 ⓘ 整段平铺 —— 三处「收进 ⓘ」全都卡在这一行 `v-if` 上。

- [ ] **Step 1: 逐屏改写**（每改一屏跑一次 `anaCopyLint.spec.ts`，看超标处数下降）

| # | 位置 | 改成 | 注意 |
|---|---|---|---|
| 1 | `AnomalyView.vue:232` | 读数句 + 参照系小字 | 阈值今天是 `anaSettings.spikeTh` 绑定，**不是稿抄的硬编码 40**，改写句里不要写死 40。句子必须显式带「电费」二字：`monitor.logic.ts:119` 只收 `v.elec > 0` 入样，但 `:90-93` 画了电费+水费两条线共用同一条灰带，写「本户落在第 p 百分位」对水费就是错的 |
| 2 | ~~`ParkView.vue:252`~~ | **划掉** | 已于 2026-09-06 改过 |
| 3 | `TenantEnergyView.vue:358`（hint）/ `:362`（55 字长句） | hint 换读数句，长句留在 ⓘ | 需 D2：若 σ 禁令跨屏生效，`:358` 的「灰带 = 跨户均值±σ」当场违规 |
| 4 | `FinCashflowView.vue:284` **与 `:312`** | 两处同文一起改 | 稿只点了一处，只改一处会留下另一处 72 字长文 |
| 5 | `PvRoiView.vue:212-213` **与 `:134`** | 一并统一 | `:134` 的 `note="按各期活跃月折算"` 与 `:212` 的「按各期已记账月份折算」是同一件事的两种说法 |
| 6 | `ElecAnalysisView.vue:306` | **不在本计划内**（D6） | 那是图改不是文案改 |

- [ ] **Step 2: `AnaMethodNote` 桌面档**（需 D5）

`AnaMethodNote.vue:42` 的 `<p v-if="tier !== 's'" class="ana-note">` 整块删掉，让桌面也走 `:48-54` 的 pill + 浮层。**先只改一屏给用户看，同意了再全推。**

- [ ] **Step 3: 验收**

```bash
cd frontend && npx vitest run src/views/__tests__/anaCopyLint.spec.ts src/components/ana/__tests__/
```

Expected: `hint` 超标处数从 40 明显下降。把断言里的 `HINT_OVER_BASELINE` 改成新的实测值。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/analysis/AnomalyView.vue frontend/src/views/analysis/TenantEnergyView.vue frontend/src/views/analysis/FinCashflowView.vue frontend/src/views/analysis/PvRoiView.vue frontend/src/components/ana/AnaMethodNote.vue frontend/src/views/__tests__/anaCopyLint.spec.ts
git commit -m "refactor(ana): 五处长文案改写成读数句 + 口径全部收进 ⓘ

稿 §3.5 六条里有两条要更正:
· ParkView.vue:252 那条已作废 —— 2026-09-06 已按同口径改过(见该文件 :5-8 注释),从清单划掉
· FinCashflowView 是两处同文(:284 与 :312),稿只点了一处,只改一处会留下另一处 72 字长文

AnomalyView 的读数句显式带「电费」二字:monitor.logic.ts:119 只收 v.elec>0 入样,
而 :90-93 画了电费+水费两条线共用同一条灰带,写「本户落在第 p 百分位」对水费是错的。

AnaMethodNote 桌面档改走 pill 浮层(去掉 :42 的 tier 判断)—— 一行 v-if,
但同时改 18 个屏的观感,已按 D5 先给用户看过一屏。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: P2 同类对标带 —— 补样本量与三档样本门

⚠ 百分数句需 **D1** + **D3**。未拍板则只做「补 n」与「<20 断带」，句子不出百分数。

**今天两处都无样本门**：`monitor.logic.ts:120` 是 `if (vals.length)`（n ≥ 1 就画一条零宽灰带），`TenantEnergy.logic.ts:87` 是 `if (!vs.length)` 才 null。**而且 n 根本传不出来**：`monitor.logic.ts:41` 的 `band` 类型只有 `{ p25, p75 }`，`TenantEnergy.logic.ts:80` 的 `ParkBand` 只有 `{ mean, lo, hi }`。

- [ ] **Step 1: 写失败的测试**

在 `TenantEnergy.logic.spec.ts` 加：

```ts
it('❗n = 19 不返回带(D3 三档:<20 不画)', () => {
  const rows = mkRows(19)
  expect(buildParkBand(rows, ['2025-01']).lo[0]).toBeNull()
  expect(buildParkBand(rows, ['2025-01']).n[0]).toBe(19)
})

it('❗n = 20 返回带,且 n 一并传出供参照系小字印', () => {
  const rows = mkRows(20)
  expect(buildParkBand(rows, ['2025-01']).lo[0]).not.toBeNull()
  expect(buildParkBand(rows, ['2025-01']).n[0]).toBe(20)
})
```

- [ ] **Step 2: 跑，确认红**

```bash
cd frontend && npx vitest run src/views/analysis/TenantEnergy.logic.spec.ts
```

Expected: FAIL，`Property 'n' does not exist on type 'ParkBand'`。

- [ ] **Step 3: 两处 band 结构各加 `n`**

`TenantEnergy.logic.ts:80` 的接口改成：

```ts
export interface ParkBand { mean: (number | null)[]; lo: (number | null)[]; hi: (number | null)[]; n: number[] }
```

`buildParkBand`（`:83-94`）里 `if (!vs.length) { … }` 改成：

```ts
    n.push(vs.length)
    // D3 三档:同类 < 20 不画带。今天是 n ≥ 1 就画,一户也画出一条零宽灰带。
    if (vs.length < 20) { mean.push(null); lo.push(null); hi.push(null); continue }
```

`monitor.logic.ts:41` 的 `band` 值类型改成 `{ p25: number; p75: number; n: number }`；`:116-121` 的 `if (vals.length)` 改成：

```ts
    if (vals.length >= 20) {
      band[m] = { p25: quantile(vals, 0.25), p75: quantile(vals, 0.75), n: vals.length }
    }
```

- [ ] **Step 4: 带宽门写进 `bandSeries` 入口**

不要写进各屏（今天五处各判各的，迟早不一致）。在 `bandSeries` 里加：区间半宽 / 序列中位数 > 0.20 → 返回空数组（只出点不画带）。依据：月度实收 `naiveLast` 覆盖率 100% 但宽度 177%，`ma3` 224%，办公楼附表14 `ma3` 620% —— **覆盖率必须和相对宽度成对读**，只看覆盖率会把一条宽过均值一倍的带判成「很准」。

同步在 `bandSeries.spec.ts` 加一条：半宽/中位 = 0.25 时返回 `[]`，= 0.15 时返回两条。

- [ ] **Step 5: 跑，确认绿**

```bash
cd frontend && npx vitest run src/views/analysis/TenantEnergy.logic.spec.ts src/components/ana/__tests__/bandSeries.spec.ts
```

- [ ] **Step 6: 屏上落句**

`n` 印进 `.ana-ref`（三件齐：样本量 · 口径列 `acct_month`/`belong_month` · 单位）；按三档决定句子能不能出百分数（`sPeer` 已内建三档，屏侧只管把 `n` 传进去）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/analysis/monitor.logic.ts frontend/src/views/analysis/TenantEnergy.logic.ts frontend/src/views/analysis/TenantEnergy.logic.spec.ts frontend/src/views/analysis/AnomalyView.vue frontend/src/views/analysis/TenantEnergyView.vue frontend/src/components/ana/anaTheme.ts frontend/src/components/ana/__tests__/bandSeries.spec.ts
git commit -m "feat(ana): 同类对标带补样本量与三档样本门

两处 band 今天都无门也传不出 n:monitor.logic.ts:120 是 n≥1 就画(一户也画出
一条零宽灰带),TenantEnergy.logic.ts:87 是空才 null;两个结构里都没有 n,
所以参照系小字根本印不出样本量。

三档按 D3:<20 不画带 / 20-99 画带但句子不出百分数 / ≥100 才准写百分数。
稿 §2.2 要 ≥100 才可写百分比、§3.3 要 <20 不给区间,中间这一档稿里无解,是补的。

带宽门(半宽/中位 > 20% 只出点不画带)写在 bandSeries 入口不写在各屏 ——
今天五处各判各的,迟早不一致。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: P2 合约租金预测带

⚠ **三个前置全齐才开工**：① **D1** 已拍板；② 分母已重新查库确认（见 Step 1）；③ Task 5 的文字减法已落地、`size-check` 合计已回落（今天余量只有 11.3KB，顶不住一个新 logic 文件 + 新卡片）。

**Files:**
- Modify: `frontend/src/views/analysis/expiry.logic.ts`
- Modify: `frontend/src/views/analysis/ExpiryView.vue`（新增一张 `av2-s12` 卡，插在 `:111-121` 那张到期墙之后）
- Test: `frontend/src/views/analysis/expiry.logic.spec.ts`

**ExpiryView 今天只有 3 张图**（`:118` 到期墙 8 季柱、`:145` 金额 Pareto、`:151` 集中度环），**没有任何以月为 x 轴的图**，所以必须新开一张卡。

**不矛盾说明**（PR 描述里要写这句，防止评审读反把整件事否掉）：稿 §5 禁做清单里的「到期墙加带」指的是 `expiry.logic.ts:145-162` 的 `wallOption` —— 一条 bar、x 是 8 个季度标签、无时间轴无预测语义，**那张一行不动**。本任务做的是另一张图。

- [ ] **Step 1: 先查库定分母**

`expiry.logic.ts:3` 的锚点注释写「合同 282 份、有租金 235」，与稿的 386 份对不上。实测（2026-09-10）：

```sql
SELECT status, COUNT(*) FROM contract GROUP BY status;   -- active 386 / renewed 45，合计 431
```

它同时是锁定部分和到期表的基数，开工前必须确认取哪个。

- [ ] **Step 2: 写失败的测试** —— 三个方差项各一条断言

```ts
describe('合约租金带(FORECAST §1.1)', () => {
  it('❗锚点必须显式传入 —— 用真实时钟会算出完全不同的带', () => {
    const a = buildRentRoll(CONTRACTS, '2025-12-01', 12)
    const b = buildRentRoll(CONTRACTS, '2026-09-10', 12)
    expect(a.locked).not.toEqual(b.locked)
  })

  it('❗锁定部分零随机量 —— 画实线,不许套带', () => {
    const r = buildRentRoll(CONTRACTS, '2025-12-01', 12)
    expect(r.lockedBand).toBeUndefined()
  })

  it('❗续签方差两项分开算:逐户金额平方和 + p 本身不准', () => {
    const v = renewalVariance([100, 100, 100], 0.2, 90)
    // 第一项 p(1−p)Σr² = .16 × 30000 = 4800;第二项 Var(p̂)(Σr)² = .001778 × 90000 = 160
    expect(v.byWhichTenants).toBeCloseTo(4800, 0)
    expect(v.byRateUncertainty).toBeCloseTo(160, 0)
  })

  it('❗只用 Wilson 会把带画到三分之一宽 —— 这条断言就是「不能只用 Wilson」的可执行形式', () => {
    const v = renewalVariance([100, 100, 100], 0.2, 90)
    const wilsonOnly = Math.sqrt(v.byRateUncertainty)
    const full = Math.sqrt(v.byWhichTenants + v.byRateUncertainty)
    expect(wilsonOnly / full).toBeLessThan(0.4)
  })
})
```

- [ ] **Step 3: 实现**

`lockedRentByMonth(cs, asOf, n)`：第 m 月 `L(m) = Σ monthlyRent`，条件 `status ∈ {active, expiring}` 且 `endDate ≥ 该月末` 且 `startDate ≤ 该月末`，且该月不整月落在 `rentFree` 区间内。字段今天齐备（`types/contract.ts:17 monthlyRent`、`:29 rentFree`、`:30 startDate/endDate`、`:34 status`、`:37 kind`）。`kind === 'master_lease'` 单列一条并在卡头标出（它不计出租率/KPI，混进租金流水会与别屏对不上）。

续签部分：`R = Σ r_i·X_i`，`X_i ~ Bernoulli(p)`，`p̂ = 18/90 = 0.2`。
`E[R] = p̂·Σr_i`；`Var[R] = p̂(1−p̂)·Σr_i² + Var(p̂)·(Σr_i)²`，其中 `Var(p̂) = p̂(1−p̂)/n = 0.001778`。

**收口方式不要用 ±1.2816σ**：按稿内数反解 `(Σr)²/Σr² = 217.9²/3249 ≈ 14.6`，即 85 份到期在金额上等效只有约 15 份等额赌注，这个规模下 `Σr_i·X_i` 是块状多峰分布不是正态，名义 80% 在尾部不成立。改用**种子固定的蒙特卡洛** 10k 次（`p ~ Beta(18.5, 72.5)`、`X_i ~ Bernoulli(p)`、求和取 10/90 分位），约 15 行零依赖 —— 与仓库既有「确定性无随机」写法一致（参照 `TenantPortfolio.logic.ts:29-35` 用黄金分割序列代替随机抖动）。

- [ ] **Step 4: DOM 断言 —— 屏上必须同时印 n 与回测命中数**

照 `pvMeterAnaScreen.spec.ts` 的 `bodyText` 扫描写法加一条。这是 D1 那条对称规矩的可执行形式。

- [ ] **Step 5: 跑相关 spec + `size-check`**

```bash
cd frontend && npx vitest run src/views/analysis/expiry.logic.spec.ts src/views/__tests__/anaCopyLint.spec.ts
npm run build   # 末尾看 size-check 那行原文
```

PR 里贴 `size-check` 那行原文。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/analysis/expiry.logic.ts frontend/src/views/analysis/expiry.logic.spec.ts frontend/src/views/analysis/ExpiryView.vue
git commit -m "feat(ana): 到期与续签屏新增合约租金带 —— 锁定实线 + 续签区间

新开一张卡,不是加在现有图上:该屏今天三张图(到期墙 8 季柱 / 金额 Pareto /
集中度环)都不以月为 x 轴。

⚠ 与 §5 禁做条「到期墙加带」不矛盾:那条指的是 expiry.logic.ts:145-162 的
wallOption(一条 bar、x 是 8 个季度标签、无时间轴无预测语义),那张一行没动。

锚点显式传入,不用系统时钟:同一套算法在 2025-12-01 下是 18/90=20.0%(与稿吻合),
在 2026-09-10 下是 39/136=28.7%,到期合同数差一半多。

续签方差两项分开算:p(1−p)Σr²(哪几户续签,占 86%)与 Var(p̂)(Σr)²(p 本身不准,占 14%)。
只用 Wilson 只产出后一项,会把带画到三分之一宽 —— 这就是稿里「不能只用 Wilson」的
可执行形式,已写成断言。

收口用固定种子蒙特卡洛不用 ±1.2816σ:(Σr)²/Σr² ≈ 14.6,85 份到期在金额上
等效只有约 15 份等额赌注,这个规模下总额是块状多峰分布,名义 80% 在尾部不成立。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: 对抗复查（在最终验收**之前**）

带着敌意找「有没有该有、而我根本没写的判断」。至少覆盖四条：

- [ ] helper 收编后 `PvMeterAnaView` 三处的灰阶有没有被拉平（应仍是 `C.INK100`，不是 `rgba(28,28,28,.07)`）
- [ ] 样本门加了 `n` 之后，`n` 从哪几条路径可能是 `undefined` 而句子照印百分数
- [ ] 未闭月谓词提成共享后，`breakeven` 的 `allNegative` 分支行为有没有变
- [ ] lint 判据「可见字符数」在含 `<b>` / `RouterLink` 的 hint 上会不会误判（`ParkView.vue:278` / `:298` 就是这种）

这一步比跑一遍全量便宜，产出高一个数量级。返工的根源几乎都是省掉了它。

---

## Task 9: 收口（整件事结束时只跑这一次全量）

- [ ] **Step 1: 全量**

```bash
cd frontend && npx vitest run --reporter=json --outputFile=/tmp/final.json && npm run build
```

- [ ] **Step 2: 判绿看产物，不看退出码**

```bash
node -e "const j=require('/tmp/final.json');let p=0,f=0;for(const r of j.testResults)for(const a of r.assertionResults){a.status==='passed'?p++:f++}console.log('passed',p,'failed',f)"
```

Expected: `failed 0`。`npm run build` 末尾看 `size-check: 合计 X / 3950KB` 那一行原文 —— `scripts/size-check.mjs` 自己 `process.exit(1)`，但退出码可能被管道吃掉。

- [ ] **Step 3: 把两份设计稿一并提交**（开工时若已做，跳过）

---

## 稿里已漂移的引用（照稿里的行号去找会找错地方）

| 稿写 | 今天 |
|---|---|
| `AnomalyView.vue:87-88`（带） | `:88-89`（宽度 `bandW` 就地算在 `:69`） |
| `AnomalyView.vue:222`（§3.5 旗舰例） | `:232`，且阈值已改成 `anaSettings.spikeTh` 绑定，不再是硬编码 ±40% |
| `TenantEnergyView.vue:155-156`（带） | `:163-164`（宽度 `diff` 算在 `:154`） |
| `TenantEnergyView.vue:354` | hint 在 `:358`、55 字长句在 `:362`，且**已在** `<AnaMethodNote>`（`:361-366`）内 |
| `PvMeterAnaView.vue:829-831`（带） | `:831-838`（`areaStyle: C.INK100` 在 `:836`） |
| 「带子已独立实现三次」 | **五处**，漏的两处是 `PvMeterAnaView.vue:323-327`（`stack 'q'`）与 `:906-911`（`stack 'se'`） |
| `anaFmt.ts:74-77` 归在 `analysis/` | 实际是 `components/ana/anaFmt.ts:74-77`（行号仍对；`quantile` 在 `:78-85`） |
| `AnaMethodNote.vue:47-55` | `:48-54` 是 S 档 pill+浮层；要去掉的 tier 判断在 `:42` |
| `anaData.ts:311` / `:262` | 今天 `:315` / `:266`（稿自标「属另一个 bug，不在此处修」，只更正行号） |
| `FinCashflowView.vue:306` | **两处同文**：`:284`（`AnaMethodNote` 内）与 `:312`（欠费弹窗），只改一处会留下 72 字长文 |
| `ParkView.vue:252` | **已作废**，2026-09-06 已按同口径改过（见 `ParkView.vue:5-8` 注释），从 §3.5 清单划掉 |

---

## 本轮已复核 / 未复核的数

**已复核（2026-09-10，`park_demo3` 实查）：**

| 稿里的说法 | 实测 |
|---|---|
| `pv_reading` 全部 `simulated` | 3171 行，**全部** `simulated` ✅ |
| `elec_cost_entry` 全部 `simulated` | 235 行，**全部** `simulated` ✅ |
| `cp_reading` 全部 `simulated` | 33 行，**全部** `simulated` ✅ |
| 在租合同 386 份 | `status='active'` 386 ✅（另有 `renewed` 45，合计 431） |
| 续签率 18/90 = 20.0% | 锚点 2025-12-01 下**完全吻合** ✅ |
| 2025-12 年末冲回，全年只命中一行 | `pnl_row s1 园区总租金收入 = -3,412,533.97` ✅ |
| 期区一 168 份合同（有单价） | 169 份，差 1，可忽略 ✅ |
| 未来 12 月 85 份到期、217.9 万 | 同锚点下实测 **83 份 / 209.2 万** ⚠ 以重算为准 |
| 前端体积余量 | `合计 3938.7KB / 3950KB`，`index 187.4KB / 191KB` ✅ |

**未复核（要回测脚本，脚本在 scratchpad 不在仓库，且要连库重跑）：**
滚动回测 5 中 2、斜率 +257,903、拟合优度 0.9344、残差 2.98%、Durbin–Watson 1.013；§2.3 各时点 run-rate；§2.5 办公楼两年形状相关 0.894；§2.6 三行覆盖率与宽度；§0 的字数统计（分析层 11,933 字 / 判断句 531 字 = 4.2%）；驾驶舱 94.6% → 105.6% 与 −63.6 万（成因已在代码侧坐实，具体数字未验）。

**「−63.6 万」与「−341.3 万」不是一个口径**：后者是 `pnl_row` 台账原始行（已实测），前者应是分析层聚合后的收入。Task 3 开工前要先确认护栏判的是哪一个。
