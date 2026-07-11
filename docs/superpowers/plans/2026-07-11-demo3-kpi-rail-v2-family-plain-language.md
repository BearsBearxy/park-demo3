# demo3 KPI栏呼吸感 + 家族汇总(方案A) + 分析层人话化 spec(2026-07-11)

来源:用户反馈三件事。①三屏 KPI 左栏与表格太贴、间距太小显得挤乱 → 重设计;
②租户关联采用**方案A**:底层不动,分析层加「按家族汇总」;③分析层专业术语太多太杂看不懂,
部分图表晦涩 → 人话化重设计。

---

## §A KPI 左栏呼吸感重设计(W1,三屏同款)

现状病灶:rail 200px 贴 16px gap 就到表格卡;卡片 padding 14px 16px 过紧;tint 色卡直贴白色表格卡,视觉粘连。

统一改法(三屏 .mx-* CSS 同步替换,一字同款):

```css
.mx-body { display:grid; grid-template-columns:224px minmax(0,1fr); gap:28px; align-items:start; }
.mx-kpirail { display:flex; flex-direction:column; gap:16px; position:sticky; top:16px; }
.mx-main { min-width:0; display:flex; flex-direction:column; gap:16px; }
@media (max-width:1100px) {
  .mx-body { grid-template-columns:1fr; gap:16px; }
  .mx-kpirail { flex-direction:row; flex-wrap:wrap; position:static; }
  .mx-kpirail > * { flex:1 1 160px; }
}
```

卡片 padding `'14px 16px'` → `'20px'`(KpiCard style prop)。KPI 数值/顺序/tint 零变化。
sticky top 由 0→16px(留出呼吸)。其余结构不动。

## §B 家族汇总 — 方案A(W2/W3)

地基(已由本人预置):`src/analysis/anaFamily.ts` — `buildFamilyMap(tenants)` 名称→根名(V31 已拍平链,
parentName 即根),`familyRootOf(map, name)` 不在主数据的名称自成一族。anaFamily.spec.ts 2 用例绿。

**口径(在两屏 AnaMethodNote 里原文披露)**:家族=租户管理中的关联关系(parent_id);按家族汇总时,
家族成员的流水合并后计算——**家族内某成员的预收/多收会抵减其他成员的欠费**(同一实际客户口径),
故家族合计可能小于逐户合计。

### W2 fin-cashflow(欠费清单 + 账龄 按家族)
- 屏内加开关(卡头右侧 mini seg,样式仿 AnaShell .anx-seg):`按户 | 按家族`,默认按户,ref 状态即可(不持久化)。
- 实现=**最小改法**:开关开时把 ledger rows 先做 `tenantName → familyRootOf(map, tenantName)` 映射,
  再走**现有** `arrearsOf`/`agingBuckets`(FIFO 在家族合并流水上跑,天然实现「预收抵欠费」净额口径,
  零新聚合逻辑)。familyMap 由 fetchTenants()(anaData 已有缓存)构建。
- 作用范围:欠费租户清单 + 欠费账龄卡(两处同一开关);其余卡不动。
- 家族行显示根名 + 小徽标「含 N 户」(N=该家族本期有流水的成员数,>1 才显)。
- finCashflow.logic 若加纯函数(如 rows 家族映射器)则配单测:广联三兄弟合并/预收抵欠/单户家族不变。

### W3 tenant-energy(租户榜单 按家族)
- 同款开关,作用于左侧租户列表(电/水费排行):开时按家族根名聚合金额重排,行显示根名+「含 N 户」;
  点击家族行 → 右侧趋势/对比取家族合并序列(若改动过大,允许降级:点击仍看根租户本人,
  在 hint 注明「趋势为主租户本户」,summary 说明取舍)。
- KPI「本期覆盖租户」等计数口径不动(仍按户,榜单是唯一家族化的地方,method note 说明)。

## §C 分析层人话化(W3~W6,四条硬规则)

1. **主标签必须人话**,专业术语退括号或 AnaMethodNote;
2. **失真比率就地标注原因**(分母极小等),不许裸奔;
3. **图表轴不被离群值撑坏**:限幅+超界点钉边+tooltip 真值+hint 披露;
4. **稀疏序列不连线蒙混**:断点呈现,hint 注明「断点=该月无记录」。

逐屏清单(标签文案为定稿,照抄):

### C1 tenant-energy(并入 W3 agent)
- KPI `用能异常户 / |z|≥1.3` → label `用量异常户`,note `较自身常态明显偏离`;
  AnaMethodNote 补一句:`异常=该户本期用量偏离其12个月均值超1.3倍标准差(z分数)`。
- 该屏趋势折线若 connectNulls/缺月连线 → 改断点(connectNulls:false),hint 加「断点=该月无记录」。

### C2 tenant-portfolio(W4)
- KPI `HHI 指数 1565 / 中等集中` → label `集中度指数(HHI)`,value 不变,
  note → `中等集中 · >2500为高度集中`(给刻度,数字才可读)。

### C3 fin-balance(W4)
- ROE 卡 / 杜邦区:权益基数失真必须**就地醒目**——在杜邦卡头加 AnaPill(tone warn)
  `权益仅 ¥244万 · 杠杆放大,比率失真仅供参考`(金额从 R 里取实值,勿写死);
- `杜邦分析 · ROE 拆解` 标题 → `净资产收益率拆解:利润率 × 周转 × 杠杆(杜邦)`;
  三因子加人话副标:净利率`(赚钱能力)`、总资产周转率`(资产效率)`、权益乘数`(杠杆倍数)`。

### C4 breakeven(W5)
- **口径月锚修正**:现退「最新覆盖月」,而 2025-12 收入为负 → CVP 收入线倒挂无保本点。
  改为退**最近一个收入>0 的覆盖月**(纯函数,配单测:末月负→取上一个正;全负→维持最新+空态提示);
  回退时既有横幅照常显式。
- `本量利 (CVP) 曲线` → `保本点测算`(副注 `本量利 CVP`);
- `边际贡献率` KPI → label `收入留存率`,note `扣除随收入变动的成本后剩余(边际贡献率)`;
- `敏感性(龙卷风)` → `哪个因素对利润影响最大`(副注 `各驱动 ±10% · 龙卷风图`);
- 卡头下加一行人话结论(数据模板,仿驾驶舱结论条):
  `按当前成本结构,月收入 ≥ ¥X万 即保本;口径月(YYYY-MM)收入 ¥Y万,达成 Z%`(保本无解时:
  `当前口径月收入为负,保本点不适用——见期间横幅`)。

### C5 churn(W6)
- 散点 x 轴限幅:`clampPts(pts, lo=-100, hi=300)` 纯函数(配单测)——超界点钉在边界,
  记 `clamped:true`,散点 symbol 改三角/描边区分,tooltip 显示真值;
  hint 加 `超±范围的点钉在边缘(悬停看真值)`;轴名 `s10收入环比(%)` → `收入变化(环比%)`。

### C6 park-energy(W6)
- 桑基卡「守恒/轧差/毛差记流入侧」注 → 生成式人话一句(数据模板):
  `本期园区买电 ¥X万,光伏自用 ¥Y万;向租户售电 ¥Z万,办公/充电自用 ¥W万;差额 ¥D万 为转供加价收益`
  (residual>0 时结尾改 `为线损与未计口径`);原守恒口径句退 AnaMethodNote 保留。

## 验收

1. vue-tsc 0 错;vitest 全绿(新增:breakeven 锚月/churn clamp/家族映射器 各配用例)
2. 目视:三屏 KPI 栏与表格间距明显放开;fin-cashflow 开「按家族」后广联合并为一行「广联 · 含3户」
   且账龄合计变化(净额口径);tenant-energy 榜单家族聚合;breakeven 口径月不再落负收入月、
   人话结论行出现;churn 散点无离群点撑轴;各屏主标签无裸术语
