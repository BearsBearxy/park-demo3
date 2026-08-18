# 指标口径单一事实源规范（METRIC-SOURCE-SPEC）

2026-08-18 立档。来源：第六次全面审计。三条门禁全绿（前端 1268、后端 625、typecheck 0 错）
却在页面上抓到 4 处指标互相矛盾——**测试全绿抓不到，因为没有任何断言校验"两个屏说的是不是同一件事"**。

本规范只管一件事：**同一个业务判定，在系统里只能有一个实现。**
`API-CONTRACT-SPEC.md` 管接口形状，本文管接口里那个数**算得对不对、两处算得一样不一样**。

## 0. 立档证据（四条，全部实测）

| 概念 | 权威实现 | 漂移实现 | 后果 |
|---|---|---|---|
| 合同是否在租 / 将到期 | `ContractService.effectiveStatus()` 按起止日与今天派生 | `TenantService.summary()` 直读库里 `status` 字段 | 月租金 795万 vs 309万（2.57×）；"将到期"恒 0 vs 30 份 |
| 出租率 | 单栋：分母为 0 → 返回 0% | 全园：分母为 0 → 被 `Math.min(100.0,…)` 钳成 **100%** | 同屏并存"全园 100%"与"每栋 0%"与"空置 173/373" |
| 某月"有损益覆盖" | 分析层消费：只认 `groupLabel===''` 的园区底带总计行 | `AnalysisService.months()`：**任一行**该月非 null | 9 行 s2 光伏明细让 2026-01 被判为覆盖月 → 驾驶舱默认落空月、主区全 `—` |
| 当前账期 | year：snap 到最新有数据年（2024） | month：`new Date().getMonth()+1`（8月） | 拼出 2024-08 这个**任何数据源里都不存在**的账期 |

四条的形状完全一样：**同一个概念被复制成两份实现，然后各自演化。**

---

## 1. 规则一：一个判定只能有一个实现

- 凡是**从原始字段推导出业务结论**的逻辑（在租/到期/覆盖/占用/异常…），必须收敛到**唯一一个具名函数**。
- 该函数是**权威**；任何其他地方需要这个结论，一律调它，**不得重新实现、不得直接读它所依赖的原始字段**。
- ❌ 禁止：`"expiring".equals(c.getStatus())`、`RENT.contains(c.getStatus())` —— 直接读 `status` 就是绕过 `effectiveStatus()`。
  - `status` 列自 2026-07-28 起**只存人工态**（draft/terminated/renewed），时间态（future/expiring/expired）一律派生。读原始列 = 读到一个已经不存在的语义。
- 权威函数必须挂 javadoc 写清「本函数是 X 的唯一判据」，方便 grep 到。

### 1.1 权威判定登记册（新增判定必须登记到这张表）

| 概念 | 权威函数 | 位置 |
|---|---|---|
| 合同展示态（在租/将到期/已到期/未起租） | `ContractService.effectiveStatus(stored, startDate, endDate)` | backend service |
| 计租口径（哪些态计入月租金/在租户数） | `BuildingService.RENT`（仅配合 `effectiveStatus` 的**返回值**使用） | backend service |
| 月租金合计 / 将到期（合同屏与租户屏共用） | `ContractService.rentRollMetrics(contracts)` | backend service |
| 出租率（单栋与全园同一公式，可空） | `BuildingService.occRateOf(leased, rentable)` | backend service |
| 单元占用态 | `BuildingService.unitStatus(unitId, contracts, links)` | backend service |
| 某月有损益覆盖 | `AnalysisService.isPnlBandRow(row)`（`groupLabel==='' && kind∈{total,pnl}`） | backend service |
| 损益底带取值 | `extractPnlBand(schedule, dto)` | frontend `analysis/anaData.ts` |
| 默认期间 | `providePeriodMonths(list, financeMonths)` | frontend `analysis/usePeriod.ts` |

---

## 2. 规则二：跨屏同名指标必须同源，并由一致性测试锁死

- **同一个中文标签在两个及以上屏出现，其数值必须来自同一个函数。**
  - 例：「月租金合计」出现在租户管理 KPI 与合同管理口径 → 必须同源。
  - 例：「出租率」出现在楼栋管理 KPI、楼栋卡、楼栋抽屉、租户管理 KPI → 必须同源。
- **必须写一致性测试**，断言两个接口返回的同名指标严格相等。没有这条测试，规则一迟早被绕过。

```java
@Test void 租户屏与合同屏的月租金必须同源() {
    assertThat(tenantService.summary().monthlyRent())
        .isEqualByComparingTo(contractService.summary().monthlyRent());
}
```

- 一致性测试统一放 `backend/src/test/java/com/park/demo3/service/MetricConsistencyIT.java`，新增跨屏指标就往里加一条。

---

## 3. 规则三：算不出来必须能表达"算不出来"

- **禁止用 `0` 兼表「真的是 0」与「没法算」。** 两者对用户的含义完全相反。
- **禁止用钳位（`Math.min`/`Math.max`）把非法结果修饰成合法值。** 钳位掩盖的是分母错误，输出的是一个看起来很正常的假数——比报错危险得多。
- 比率型指标（出租率、收缴率、达成率、利润率…）的返回类型必须**可空**：
  - 分母 ≤ 0、分母缺失、或分子 > 分母（数据自相矛盾）→ 返回 `null`。
  - 前端 `null` 一律渲染 `—`，并在副标或 tooltip 说明**为什么**算不出来（"缺可租面积数据"），不得静默留白。
- 排序：`null` 一律排在末尾，不参与大小比较。
- 若存在**不依赖缺失字段**的替代口径，应作为副标一并给出（例：出租率主口径按面积，副标给"按单元 200/373"）。主副口径必须都标明口径名，禁止混用。

---

## 4. 规则四：默认期间必须整体数据驱动

- **任何屏的默认年月都不得来自 `new Date()`**，必须落在"实际有数据的最后一个账期"。
- **year 与 month 必须一起 snap，禁止分别决定。** 只 snap year、month 留系统当月，会拼出数据源里根本不存在的账期（2024-08 即此）。
  - 落地形态：先取该屏数据源的 `ym` 全集 → 取最大者 → 同时决定 year 和 month。
- **判定"某期有数据"的判据，必须与该屏实际消费的判据是同一个。**
  - 反例即立档证据第 3 条：覆盖判据是"任一行非 null"，消费判据是"底带总计行"，两把尺子 → 默认落到一个"有行但没数"的月。
- 用户手动选择的期间用 localStorage 持久化；持久值非法（该期已无数据）时按上述规则回落，不得保留非法值。

---

## 5. 规则五：Excel 读写统一走适配层

（与口径无关，但同属"一件事只做一次"，一并立此）

- 前端**生产代码**的 Excel 读写一律走 `utils/sheet.ts` 适配层，底层实现为 **exceljs**。
- ❌ 禁止在 `src/`（`tools/` 与 `*.spec.ts` 除外）直接 `import('xlsx')`。
  - `xlsx@0.18.5` 有两条 high 级公告（原型污染 GHSA-4r6h-8v6p-xvw6、ReDoS GHSA-5pgg-2g8v-p4x9），SheetJS 已停止发布到 npm，**该版本永不修复**。
  - `xlsx` 降级为 `devDependencies`，仅供 `tools/` 本地迁移脚本读原始册子（含 `.xls` 旧格式）使用。
- 页面导入只接受 `.xlsx` / `.csv`。上传 `.xls` 时给出明确指引（"请用 Excel 另存为 .xlsx 后重传"），不得静默失败。
  - **此项已由用户于 2026-08-18 明确拍板"保持现状"，不要再改回去。** 背景：真实数据目录里确有 3 个 `.xls`
    （`2024年10月文件（拼）.xls`、`2025年10月文件（拼）.xls`、`新材料保障房房屋信息-260套.xls`），对 161 个 `.xlsx`。
    权衡结论：让用户在 Excel 里"另存为"两次点击，好过为 3 个旧文件把带两条 high 漏洞的 xlsx 拉回生产依赖。
    `tools/` 的本地迁移脚本仍能读 `.xls`，能力没丢，只是不从页面走。
- 门禁：`npm audit --omit=dev` 必须无 high 及以上。

---

## 6. 新增指标自检清单

- [ ] 这个数是"派生结论"吗？是 → 权威函数存在吗？存在就调它，不存在就新建并登记进 §1.1
- [ ] 这个中文标签在别的屏出现过吗？出现过 → 已加 `MetricConsistencyIT` 断言了吗
- [ ] 是比率吗？→ 返回类型可空了吗？分母非法时返回 `null` 而不是 0 或钳位值了吗
- [ ] 前端拿到 `null` 会渲染 `—` 并说明原因吗？排序把 `null` 放末尾了吗
- [ ] 涉及期间吗？→ 默认值来自数据而非 `new Date()` 吗？year 和 month 是一起决定的吗
- [ ] "有数据"的判据 == 本屏实际消费的判据吗
