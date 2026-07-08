# Plan:预算对比(2026-07-07)

依据 spec:[2026-07-07-demo3-budget-compare-design.md](../specs/2026-07-07-demo3-budget-compare-design.md)。

## WP-A 后端(可与 B 并行,契约在 spec)
- Flyway V-next budget_row + BudgetController(POST /api/budget/import 整年替换、GET /api/budget/all)+ BudgetService + DTO;BudgetApiIT 3 例(导入回读/整年替换/双年 payload)。

## WP-B 前端(按 spec 契约先行,mock api 单测)
- api/budget.ts;importRegistry 'budget' 类型(parseWorkbook + sheetMatch,列识别 /^(\d{4})年(发生额|预算)$/,2025 发生额跳过+差异校验提示,按年分段确认);导入中心磁贴自动出现(registry 驱动)。
- fpNav 专题分析 +'budget' 页;router;views/analysis/BudgetView.vue(五年带/达成 bullets/总表明细/2026 前瞻;空态引导);CockpitView 追加「预算达成」卡(空态引导 /import);anaData 追加 fetchBudgetAll + 契约注释。
- 单测:解析器(实测表头样例)/关键行匹配/全量门禁。

## 复审(1 agent)
- 数值:导入真实两份预算文件(经真实解析器)对 spec 验收锚点;达成率 94.6% 回算;确认屏 2025 校验提示逻辑。
- 回归:全量 test+typecheck;registry 其他 17 类型无扰动;nav/router/KeepAlive 无回归。

## 主会话收尾
复审确认项修复 → 复测 → 告知用户:重启后端(新表+端点)→ 导入两份预算文件 → 验收锚点。
