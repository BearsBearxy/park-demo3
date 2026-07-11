# demo3 分析层 · 外部设计稿对比与采纳 spec(2026-07-11)

来源:用户提供《园区经营分析Dashboard排版设计.md》(根目录,482 行,通用园区 dashboard 模板,23+ 屏)。
任务:对比现有 15 屏实现,采纳其中优于现状且**现有数据可支撑**的部分。
边界(用户定):页面卡片/侧边栏比例等外框布局保持现有设计;只动 dashboard 内部设计;合同日期/面积缺失先不管。

---

## 1. 对比结论

### 1.1 设计稿不可取 / 不适用(不采纳)

| 设计稿内容 | 不采纳原因 |
|---|---|
| 工单、招商销售、安保保洁、维修工程、税务发票 5 大板块(§3.5/§5.2/§5.5/§5.6/§4.6) | demo3 无对应数据域(无工单表/CRM/排班/发票数据),做了就是死屏。现有「只做有数据的屏」策略更优 |
| 出租与空置分析、楼栋出租状态图(§5.1)、合同到期时间轴+续租漏斗(§3.4) | 被 面积全0 / 合同日期全缺 卡死,用户已明确先不管 |
| 现金流预测(未来30/90天、资金缺口日,§4.5) | 无银行流水与付款计划数据。现有诚实的「收款实现视图」更优 |
| 经营健康度综合评分仪表盘(§2.1) | 合成分不透明不可下钻;现有异常规则引擎(逐条可解释+深链)是更好的等价物 |
| 全局筛选栏(园区多选/楼栋级联,§1.3) | 单园区数据无意义;且属外框布局,用户说不动 |
| 通篇无稀疏数据处理设计 | 现有 月锚回退横幅/覆盖期数标注/AnaMethodNote 口径注 是真实脏数据下的必需品,设计稿没有——这一维度现状**优于**设计稿 |

### 1.2 设计稿已有等价物(不动)

瀑布图(fin-pnl/fin-cashflow 已有)、Pareto(tenant-portfolio/expiry 已有)、欠款期初→期末瀑布(fin-cashflow 收款瀑布)、
成本 Treemap(park 楼栋 TreeMap 同技法)、逾期租户排行(cockpit 欠费清单/anomaly 风险清单)、
「红色只用于真异常」(AnaKpiTile invert 已实现)、表格金额右对齐 mono(已实现)。

### 1.3 设计稿可取(采纳,5 项,全部现有数据可支撑、纯前端)

| # | 设计稿出处 | 现状缺口 | 采纳内容 |
|---|---|---|---|
| A | §2.1「经营结论 12列」 | 驾驶舱直接 KPI 开场,结论要用户自己读图 | 驾驶舱顶部**经营结论条**:数据模板生成 2~3 句(收入/利润/预算达成→收缴/欠费→异常数),分句着色 |
| B | §8.2「KPI 卡片含迷你趋势线」 | AnaKpiTile 只有 值+delta+note | 加可选 **sparkline**(12 月趋势,inline SVG,复用 smoothPath) |
| C | §4.1「迷你利润表,而不是普通卡片」 | fin-pnl KPI 是普通瓦片 | KPI 行改为**利润表链条**:收入→成本→毛利→期间费用→营业利润→净利润(snap 已有全部数值) |
| D | §3.2「逾期账龄」 | 只知欠费总额 3,185万,不知欠了多久 | fin-cashflow 加**账龄卡**:FIFO 冲抵后按 1月内/2-3月/4-6月/6月+ 分桶 |
| E | §8.1「预算=紫 #A78BFA、同期基线=灰 #94A3B8;红只给异常」 | 预算虚线与利润线**同色**(#185FA5);环比线与数据柱同蓝族难分 | 语义色常量:**预算=#A78BFA、对比基线=#94A3B8**,应用于 cockpit / park-energy 的对比开关叠加线 |

不采纳 B 的「预算差异」进瓦片(瓦片已有 delta+note 双副行,再加会挤);不采纳 §8.1 品牌色替换(外框不动)。

---

## 2. 实现细则

### 共享(已由本人预置)
`components/ana/anaFmt.ts` 增语义色常量(ECharts 纯 JSON 不能用 CSS 变量,取字面值):
```ts
export const CMP_BUDGET = '#A78BFA'   // 预算基准线(紫) — 与数据蓝族/利润深蓝区分
export const CMP_BASELINE = '#94A3B8' // 环比上月/同期基线(灰) — 「对比参照」不是数据
```

### A. 驾驶舱经营结论条(cockpit)
- 纯函数 `buildConclusion(...)` 放 `cockpit.logic.ts`,输入全部为该屏已取数据
  (PnlSummary、collects、budgetRows、anomalies.length、anaSettings、期间),输出分句数组
  `{ text: string; tone: 'good'|'watch'|'risk'|'neutral' }[]`;缺哪块数据省哪句,全缺返回 []。
- 句式(数据模板,无写死结论):
  1. 收入利润句:`2025年收入 ¥8,772万(预算达成 94.6%),园区利润 ¥2,290万(利润率 26.1%)` — tone 按利润正负/预算达成
  2. 收缴句:`收缴率 80.5% 低于目标 96%,期末欠费 ¥3,185万` — tone 按 vs 目标
  3. 异常句:`4 条异常待处理` — tone=watch,0 条则 `规则引擎无异常`(good)
- 渲染:KPI 条上方一行横幅(av2-s12),句前小圆点按 tone 取 STATUS 色;点异常句 → /anomaly。
- 单测:cockpit.logic.spec.ts 覆盖 三句齐/缺预算/缺台账/零异常。

### B. AnaKpiTile sparkline
- `AnaKpiTile.vue` 加可选 `trend?: (number|null)[]`:值行右侧渲 inline SVG 迷你线
  (宽 ~56px 高 ~20px,复用 anaFmt.smoothPath,null 断点跳过;全 null/长度<2 不渲染)。
- CockpitView 给 营业收入/成本费用/园区利润 三张瓦片传当年 12 月序列(pnl.revenue/cost/profit),
  收缴率传 collects.rate 序列;在租租户/预算达成无月度序列,不传(零变化)。
- 单测:sparkline path 生成的纯函数部分(若抽出 trendPath(values,w,h) 放 anaFmt)覆盖 null 断点/全 null。

### C. fin-pnl 迷你利润表头部
- 用现有 `snap`(rev/cost/op/net 已齐)派生链条:
  `营业收入 → 营业成本(含税金=rev−cost 口径注意:cost=v(2),税金已在 v(21) 差额里) → 毛利 → 期间费用(=毛利−营业利润) → 营业利润 → 净利润`
  每节点:名称+金额(万)+占收入%;节点间「−」连接符;负值红。
- 替换现有 6 张普通瓦片(#kpis 槽内换渲染,AnaShell 零改动);「营业外占利润总额」保留为链条尾注小字。
- 纯函数 `pnlChain(snap)` 放 finPnl.logic.ts + 单测(正常/净亏/rev=0)。

### D. fin-cashflow 账龄卡
- 纯函数 `agingBuckets(rows: AnalysisLedgerRow[], cid: string)` 放 finCashflow.logic.ts:
  - 按 租户×公司 分组,月升序;最早覆盖月的 balancePrev 作「期初旧账」入队(记账月=最早月前一月);
  - 逐月 net = receivable − collected:>0 入队(该月新欠);<0 依 FIFO 冲抵最旧欠费;
  - 期末余队按「距最新台账月的月数」分桶:≤1月 / 2~3月 / 4~6月 / >6月(期初旧账归 >6月);
  - 返回 `{ buckets: {label, amount, tenants}[], total }`。与 Σmax(balanceEnd,0) 的差异容忍浮点。
- 渲染:放「应收 vs 实收」旁 av2-s4 卡,横向堆叠单条(4 段,浅→深红渐进)+ 分桶图例(金额+户数);
  点分桶 → 复用现有欠费清单弹层(过滤该桶租户)可选,v1 先不做下钻,图例即可。
- 单测:单租户单月欠费/跨月部分冲抵/超额冲抵清零/期初旧账/多租户聚合。

### E. 对比线语义色
- CockpitView 主图:`上月收入` 线 #85B7EB→CMP_BASELINE;`预算月均` markLine+线 #185FA5→CMP_BUDGET。
- ParkEnergyView 购售电组合:环比上月虚线→CMP_BASELINE;预算月均虚线→CMP_BUDGET。
- FinPnlView 12月趋势卡的 环比/预算 叠加线 同改。
- 图例文案不变。数据系列颜色一律不动。

---

## 3. 验收

1. 各 logic spec 新用例 + 全量 `npx vitest run` 绿、`npx vue-tsc --noEmit` 0 错
2. 目视(vite 5173 + 后端 8080 在跑):
   - 驾驶舱顶部出现结论条,数字与 KPI 一致;营收/成本/利润/收缴率瓦片有迷你趋势线
   - fin-pnl 头部为利润表链条(收入 8,772万 → … → 净利润),数值与原瓦片一致
   - fin-cashflow 出现账龄卡,4 桶合计 ≈ 期末欠费 ¥3,185万
   - 驾驶舱开「预算」对比:预算线为紫色,与深蓝利润线可区分;开「环比」:上月线为灰
