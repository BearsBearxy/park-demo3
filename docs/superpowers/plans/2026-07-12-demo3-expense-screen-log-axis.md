# demo3 费用与报销分析屏 + 散点对数轴 spec(2026-07-12)

用户拍板:①新屏=附表5 **全域费用分析**(员工报销/办公类设专区);②导航入**管理公司维度**;
③重偏斜散点=**对数默认+一键切线性**。

## §T1 新屏「费用与报销」(fin-expense)

### 数据(全部既有,零后端)
- `fetchPnlYear('s5', year)`(anaData 已有缓存):行={groupLabel(销售费用/管理费用/财务费用/''),
  label 科目, kind detail/subtotal/total, m[12] null=未录}。
- 组带(groupLabel='' kind total):`管理费用总计：`/`销售费用合计：`/`财务费用合计：`/`修缮、改造费用`/
  `运营费用总计`(标签以库内实际为准,agent 先 SQL 抽查核对,勿写死错标签)。
- 费用占收入比:`fetchPnlSummary(year)` 的 revenue。
- **员工报销与办公类圈定**:label 关键词 `餐补|差旅|办公|用品|饮用水|药品|接待|通信`(圈定规则在
  AnaMethodNote 原文披露,agent 用 SQL 核对命中清单写进 summary)。

### 布局(仿现有 av2 屏;AnaShell periodMode='full',compare=['mom'])
- KPI 条 6 瓦:运营费用总计(期间取值同 atPeriod 口径:月=当月,年=Σ)/管理费用/销售费用/
  财务费用+修缮合计/报销办公类合计/费用占收入比(revenue 为 0 或 null → '—')。
- 主图 s8「月度费用构成」:四组堆叠柱(销售/管理/财务/修缮,四色同驾驶舱 COMPO 策略)+
  运营费用总计折线;环比开=总计上月灰虚线(CMP_BASELINE)。
- s4「本期费用结构」:四组环(图例带占比,同驾驶舱环样式)。
- 第二排三张 s4:①「科目 Top10」横条(本期金额降序,条色随组);②「环比异动」榜(科目环比增幅
  Top8,金额+%,增=红/降=蓝,invert 语义:费用降是好事);③「员工报销与办公」专区(圈定科目
  合计+逐科目小条+占运营费用%)。
- s12 AnaMethodNote:口径=附表5;组带取自带总计行不重算;报销圈定关键词;缺月 null 不补 0。
- 人话原则沿用:主标签无术语;比率分母为 0 就地 '—'。

### 接线
- `nav/fpNav.ts` 管理公司维度组追加 `{ value: 'fin-expense', label: '费用与报销', icon: 'receipt', kind: 'ana' }`
  (放 fin-cashflow 之后);**nav/__tests__/fpNav.spec.ts 的 40 计数断言改 41(两处)**,头注释 40屏→41屏。
- `router/index.ts` ANA_VIEWS 加 `'fin-expense': () => import('@/views/analysis/ExpenseView.vue')`。
- 新文件:`views/analysis/ExpenseView.vue` + `expense.logic.ts` + `expense.logic.spec.ts`
  (纯函数:组月度矩阵/结构/TopN/环比异动/报销圈定;单测用库内真实标签锚点,含:组带识别/
  关键词圈定/环比含 null 月/Top 排序)。

## §T2 散点对数轴(对数默认+一键切线性)

- **tenant-energy 散点**(TenantEnergyView ~209):x 轴(月租金,万)默认 `type:'log'`;
  log 下 x≤0 的点**过滤**并在 hint 计数披露(`0租金户 N 户未显示`);卡头加 mini seg「对数|线性」
  (同 famOn 开关样式,默认对数),hint 加「对数刻度:小户与大户同图可读」。y 轴保持线性(电费跨度小)。
- **park 楼栋×租户散点**(ParkView ~102):y 轴(月租,万)同规则对数默认+切换;x(租户数)线性不动。
  楼栋月租无 0(有 0 则同过滤披露)。
- churn 散点**不适用** log(x=环比% 有负值),维持既有 clamp 方案,不动。
- 轴刻度 log 模式 axisLabel 保持金额格式;minorSplitLine 可开可不开(简洁优先)。

## 验收
1. vue-tsc 0 错;vitest 全绿(fpNav 41 断言/expense.logic 新用例/散点切换若抽纯函数配用例)
2. 目视:导航管理公司维度出现「费用与报销」;屏 KPI 与主图数值与附表5 底稿一致
   (运营费用总计 2025 全年 ≈ 792.6万,SQL 锚点);tenant-energy 散点默认对数、点分布可读、切线性回原样
