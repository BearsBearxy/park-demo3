# demo3 P1 附表10 导入「按表头名字匹配」— 设计规范（简短）

- 状态：已批准（2026-06-30 brainstorming），待用户复审
- 背景：P-Import-1 的附表10 导入用纯位置映射，扛不住用户真实 Excel（`2025年1月二期园区费用明细表`）：① 多行表头（标题+分组+叶子 3 行，`skipHeader` 只跳 1）② 前置「车间」分类列（一至四车间/5,6车间，整体右移一位）③ 尾部「合计/备注」列（按位置落到最后一个叶子，如宿舍 office 版面误落「一栋保障房租金」）。
- 关键事实：demo3 附表10 `layout.ts` 的叶子标签/顺序与用户真实 Excel **一致**（附表10 本就 1:1 移植自该真实表），故按叶子名字匹配可靠。

## 1. 目标与范围

让附表10 导入扛住用户真实 Excel 的多行表头 + 前置车间列 + 尾部合计/备注列。**仅改附表10 导入**（台账本轮不动，仍位置映射，可后续同法升级）。**固定模板**前提（用户确认）。

## 2. 方案：按表头名字匹配（替换附表10 的位置 parseRow）

`FpImportModal` 增加 **`columnMap` 模式**（与既有 `parseRow` 二选一；台账继续用 parseRow）：

- **Props 新增**：`columnMap?: { label: string; key: string }[]`（列标签→字段 key）、`nameLabels?: string[]`（租户列候选表头名，默认 `['租户','租户名称']`）。给了 `columnMap` 即走名字匹配，忽略 `parseRow`。
- **解析工具** `utils/importHeaderMatch.ts`：`matchByHeader(matrix, columnMap, nameLabels) => Rec[]`：
  1. `normalize(s)`：去空格 + 去 `、，·（）()／/。.` 等标点（不改字符）。
  2. **定位表头行**：逐行统计「normalize 后命中 columnMap 标签」的单元格数，取最多的一行为表头行（命中 < 2 → 抛「无法识别表头，请确认列与本期版面一致」）。
  3. **列→key 映射**：表头行里每个命中标签的列 → 对应 key；**租户列** = 表头里 normalize 命中 `nameLabels` 的列（无则取「第一个非数字、非命中-fee 的文本列」兜底）。
  4. **数据行** = 表头行之后所有行；逐行：`tenantName = row[租户列].trim()`，空则跳过；命中列 → `cleanNum(值)`；**未命中列（车间/合计/备注/纯分组行）一律忽略**。
  5. 产出 `{ tenantName, ...fields, __preview }`（`__preview` 按 `templateCols` 顺序对齐：租户名 + 各叶子值或空）。
- **顺序无关**：列顺序变了也按名字对；多出/缺少的列自动忽略/留空。

## 3. 附表10 接线（S10View）

- 传 `columnMap = leaves.map(l => ({ label: l.label, key: l.colId }))`（当前 phase 版面，取自 `layout.ts leavesOf`）、`nameLabels=['租户名称','租户']`。
- `onImport(recs)` 不变：每条加 `profile:'factory'` + 当前 phase/acctMonth → `POST /api/s10/import`。
- 粘到对应期的版面 tab（二期=factory / 宿舍=office）；版面不符 → 命中过少 → 报错提示换对版面。

## 4. 明确不做（OUT）

台账导入改名字匹配（后续）、跨版面自动识别期、列别名表（当前 demo3 标签=用户标签，normalize 足够；若真出现差异再补别名）、合并单元格语义还原（仅忽略车间列即可）。

## 5. 测试 + 验证

- 单测 `importHeaderMatch.spec.ts`：① 多行表头（标题+分组+叶子）正确定位叶子行 ② 前置车间列被忽略、租户列正确定位 ③ 尾部合计/备注列被忽略（不落末叶子）④ 列乱序仍按名字对 ⑤ 表头命中过少抛错。
- 起真后端 + preview：用**二期真实格式**（含车间列+三行表头+合计备注列）粘贴 → 正确导入 N 户、合计列未落「保障房租金」、首个租户不丢、未匹配列忽略；0 console error。前端 build+vitest 绿、后端不变（端点未动）。
