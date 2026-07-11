# demo3 分析层图表清晰化 spec(2026-07-12)

来源:用户带截图反馈四处。①分析层多图文字被图边裁切;②驾驶舱「收入与利润」虚线无名无姓看不懂;
③预算对比五年组合过载不直观;④购售电月度组合"莫名其妙"。

## 0. 截图定位的病灶

| 图 | 病灶 |
|---|---|
| churn 风险象限散点 | y 均值 markLine 标签「均(」裁在右缘;x 均值标签与轴名重叠区贴顶 |
| cockpit 收入与利润 | 预算月均 markLine 标签「预…」裁在右缘;常显紫虚线不在图例、无从知道是什么 |
| budget 五年组合 | 6 系列(3实际柱+3预算虚线菱形跨年连线)+浅色预算柱,读图要解码;缺预算年 tooltip 一排「—」 |
| park-energy 购售电组合 | 售电收入(s10 仅5期)画成断裂线段似乱线;环比开后两条 CMP_BASELINE 灰虚线不可区分;图例 4 项无从对应 |

## 1. 通用硬规则(所有任务遵守)

- **markLine/末端标签一律画在绘图区内**:label position 用 `insideEndTop`/`insideStartTop`(不用默认 end),
  必要时 grid 加 padding;任何标签不得被图边裁切。
- 虚线必须**可指认**:要么进图例(作为 series),要么标签完整画在图内,要么卡 hint 里写明——三选一,不许裸奔。
- 稀疏序列不用断裂折线冒充连续:改柱(缺月自然空)或明确断点+hint。

## 2. 任务

### T1 churn 散点标签防裁(ChurnView / churn.logic)
- y 均值线标签 position `insideEndTop`,x 均值线标签 `insideStartTop`(避开顶部轴名),字号 10;
  grid right/top 适当加 padding;截图复核「均值 +7.4%」完整可见。
- 其余不动(限幅/三角/悬停真值已上线)。

### T2 cockpit 主图虚线可指认 + 站内 markLine 标签体检(CockpitView / finPnl.logic)
- 主图常显「预算月均」markLine:label position `insideEndTop`、formatter `预算月均 X万`、色 CMP_BUDGET,
  完整画在图内;卡 hint 追加一句人话:`紫虚线=预算月均`。
- 开「环比」时的「上月收入」灰虚线已在图例(series)✓ 不动;开「预算」时预算线亦已进图例 ✓。
- 收缴率横条卡「目标 96%」markLine 标签同规则挪图内(`insideEndTop`)。
- finPnl.logic 的预算月均 markLine 标签同规则(subjectTrendOption)。

### T3 budget 五年组合重设计 → 子弹图小倍数(BudgetView)
市面通行"实际 vs 目标" = 子弹图(bullet):实际=柱,目标=横杠刻度。原 6 系列单图改 **一 option 三 grid 横排**
(收入/成本/利润 各一小图,共享 tooltip):
- 每 grid:x=年份(2022~2026),实际=柱(收入 #378ADD/成本 #85B7EB/利润 #185FA5,barMaxWidth 22);
  预算=紫色横杠刻度(scatter,symbol 'rect',symbolSize [26,3],色 CMP_BUDGET),居中叠在柱位;
- 前瞻年(仅预算无实际,如 2026):无柱只有紫杠,天然呈现"目标待达成";
- tooltip 按 grid:`实际 X万 · 预算 Y万 · 达成 Z%`(缺预算省略预算行,不显一排「—」);
- 图例两项:`实际`(柱)/`预算目标`(紫杠);grid 标题用 ECharts title 数组(收入/成本费用/利润)置于各 grid 上方;
- 卡 hint 人话:`柱=实际 · 紫杠=预算目标 · 悬停看达成率`;
- 数据源/口径零变化(仍 comboActualData/comboBudgetData 既有取数,只换呈现)。
- 若纯函数(如 bulletOption 构建)可测则抽 budget.ts 或屏内 logic 并配单测(3 grid 结构/前瞻年无柱/缺预算 tooltip)。

### T4 park-energy 购售电组合重设计(ParkEnergyView / parkEnergy.logic)
- 售电收入由断裂折线改为**深蓝柱**,与购电成本浅蓝柱并排分组(barGap 默认);稀疏月自然缺柱;
  hint 注明 `售电仅 s10 覆盖月有数`。
- 环比开:灰虚线(CMP_BASELINE)**只叠购电成本**(密集序列;售电稀疏叠环比线只会再造乱线),
  图例名 `购电成本·上月`;hint 注明 `环比线仅购电(售电稀疏不适用)`。
- 预算开:紫虚线 CMP_BUDGET 两条改一条——只画 `购电预算·月均`(与柱同域可比;售电预算基准仍在 KPI/
  别处可查,本卡不塞);若现实现里有售电预算线则移除并在 summary 说明。
- 图例最多 4 项且语义互斥可辨:购电成本(浅蓝柱)/售电收入(深蓝柱)/购电成本·上月(灰虚)/购电预算·月均(紫虚)。

## 3. 验收
1. vue-tsc 0 错;vitest 全绿(T3/T4 若抽纯函数配用例)
2. 截图逐图复核:①churn 均值标签完整;②主图紫虚线带名画在图内+hint 有「紫虚线=预算月均」;
   ③预算屏 3 小图柱+紫杠一眼可读,悬停出达成率;④购售电双柱分组,图例 4 项可一一指认
