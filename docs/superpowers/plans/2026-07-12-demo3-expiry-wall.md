# 到期墙实装（审计建议#2 后半程：数据就绪后点亮时间轴）

日期：2026-07-12 ｜ 背景：ExpiryView 的「到期墙·未来8季」自 P3 起为无条件空态占位
（开发时真实合同日期全 NULL，无数据可依）。云上现有 263 份带日期合同（45 份 90 天内到期），
数据前置条件首次满足。

## 交付物

1. **纯函数**（expiry.logic.ts，铁律⑦配单测）：
   - `buildExpiryWall(cs, today)`：从 today 所在季度起未来 8 季，逐季聚合
     到期合同数与到期月租合计。只计 status ∈ {active, expiring} 且 endDate ≥ today
     的合同（已过期不进墙，按日期为准不信 status）；无日期合同跳过。
     返回 `{ quarters: [{label:'2026Q3', rentSum, count}...], totalCount }`。
   - `buildExpiringSoon(cs, today, days=90)`：临期清单，endDate 在 [today, today+90d]，
     status 同上，按 endDate 升序；行含 tenantName/contractNo/monthlyRent/endDate/剩余天数。
   - `wallOption(wall)`：ECharts 柱图 option（柱=到期月租折万，tooltip 含户数），
     样式对齐屏内既有 paretoOption。
2. **视图**（ExpiryView.vue）：
   - 到期墙卡：`totalCount > 0` → 图 + 摘要；否则保留现有 AnaEmpty 降级空态
     （本机真实数据日期仍空，降级路径必须原样可达）。
   - 新增「临期 90 天」清单卡（沿用屏内清单表样式），行点击跳 /contracts。
   - 头部「合同日期缺失·降级视图」Pill 与副标题改为条件渲染（有日期数据时不再显示）。
3. **today 注入**：纯函数收 `today: Date` 参数（测试可控）；视图层 `new Date()`。

## 验证

- 新增单测：季度分桶边界（跨年、当季末日、today 当天到期）、过期剔除、
  无日期跳过、90 天窗口闭区间、空输入返回空。
- 既有 expiry.logic.spec / 全量 vitest / `npm run typecheck`（勿裸跑 vue-tsc）全绿。
- 云上部署后目视：8 季柱图有数、临期清单 45 份量级、本机降级空态不回归。

## 明确不做

- 续约概率/预测留存（原型里的概率模型需要历史续约数据，现在没有）
- 合同屏深链带参定位（先整屏跳转，用户要精确定位再加）
