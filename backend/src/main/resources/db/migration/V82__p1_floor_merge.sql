-- V82__p1_floor_merge.sql — 刀H §H4.2a / H4c:一期定位归一(楼层+方位合成一格,去 side)。
-- 结构依据:BOOK-STRUCTURE-2024-02.md §1.1 C 列 + 直读『一期2024年2月水电费.xlsx』sheet「公共电分摊明细」
-- C5:C96 逐行(2026-07-31,openpyxl data_only=True)。
--
-- 原册事实(最硬的一条):`B3:C4` 是**一个合并单元格**,表头只有「区域」两个字,C 列没有独立表头 ——
-- B、C 合起来才是一个「两格宽的位置字段」。C 列 85 行零缺失,只有 17 个取值:
--   天面26 / 四楼西侧7 / 二楼东侧6 / 四楼东侧6 / 一楼东侧5 / 二楼西侧5 / 三楼西侧5 / 三楼东侧5 /
--   一楼西侧4 / 负一层3 / 一楼3 / 四楼3 / 六楼东侧2 / 二楼2 / 五楼东侧1 / 五楼西侧1 / 六楼西侧1。
-- **`side` 这个字段在原册根本不存在**:C 列 26 行「天面」**全部不带方位**,东西之分写在 D 列(电表名称)
-- =`东侧货梯`/`西侧货梯`。系统却造出了 `天面东侧`/`天面西侧`(rule 59/60、69/70、78/79、88/89),
-- 把 D 列的语义搬进了位置字段;而 B 座同类池 rule 49/50 又不带 side —— 同一份数据两种编码。
--
-- 改法:一期 71 条规则的 floor_label 一律改成原册 C 列**一格原文**,side 一律置 NULL。
-- 配对键取 `book_row`(V80 回填的原册行号)而不是 book_key:V81 补回的 4 个无表行原册 A 列本就是空的,
-- book_key 只能是 NULL,行号是唯一能覆盖 85 行全集的锚点。
--
-- ⚠ 红线自查:引擎全程不读 floor_label/side ——
--   computePool/poolSegQty/computeLossUnits/poolMeterLines 四个方法体里没有一处 getFloorLabel()/getSide()
--   (全库引用只在 pools() 展示、poolName 拼名、atLocation 表候选过滤、memberDiff 侧向抑制四处)。
--   故既有 67 池的 cost_amount/std_value/base_snap/qty_* 无从改变;alloc_loss_result 由 meter 驱动,更不受影响。
-- ⚠ `name` 列**不动**(§H4.2d「name 保留现状,不破坏既有引用」):`一期 C座·天面东侧·货梯` 与
--   `一期 C座·天面西侧·货梯` 若按新定位重生成会**撞成同名**(原册靠 D 列区分,位置字段区分不了)。
--   屏上池名称列改优先显 book_key,由并行的前端刀处理。

-- ── 1) floor_label ← 原册 C 列原文(85 行 → 71 条规则,折叠池取首行,与 V80 book_row 同源)──
UPDATE alloc_rule r JOIN (
            SELECT  5 book_row, '负一层'  fl      -- 地下车库东侧照明(r5/6/7/9 四行折一池,取首行)
  UNION ALL SELECT  8, '四楼'        -- 招商中心电1
  UNION ALL SELECT 10, '一楼'        -- 园区路灯
  UNION ALL SELECT 12, '一楼'        -- 联塑精铟(V81 无表行)
  UNION ALL SELECT 13, '一楼东侧'
  UNION ALL SELECT 14, '二楼东侧'
  UNION ALL SELECT 15, '二楼西侧'
  UNION ALL SELECT 16, '三楼西侧'
  UNION ALL SELECT 17, '四楼'        -- 中大4楼公共
  UNION ALL SELECT 18, '四楼'        -- 4楼空调外机电
  UNION ALL SELECT 19, '四楼东侧'
  UNION ALL SELECT 20, '四楼西侧'
  UNION ALL SELECT 21, '四楼西侧'
  UNION ALL SELECT 22, '五楼东侧'
  UNION ALL SELECT 23, '五楼西侧'
  UNION ALL SELECT 24, '六楼东侧'
  UNION ALL SELECT 25, '六楼东侧'
  UNION ALL SELECT 26, '六楼西侧'
  UNION ALL SELECT 27, '天面'        -- A座四梯(r27-30 折一池)
  UNION ALL SELECT 33, '一楼东侧'    -- 戎合B101公共电:库内原为 NULL,按原册补
  UNION ALL SELECT 34, '一楼西侧'
  UNION ALL SELECT 35, '二楼东侧'
  UNION ALL SELECT 36, '二楼西侧'
  UNION ALL SELECT 37, '三楼东侧'
  UNION ALL SELECT 38, '三楼西侧'
  UNION ALL SELECT 39, '四楼东侧'
  UNION ALL SELECT 40, '四楼西侧'
  UNION ALL SELECT 41, '天面'        -- B东西侧楼梯间(r41/42 折一池)
  UNION ALL SELECT 43, '天面'        -- B东西侧货梯(r43/44 折一池)
  UNION ALL SELECT 46, '一楼东侧'    -- 高建军C公共:库内原为 NULL,按原册补
  UNION ALL SELECT 47, '一楼西侧'    -- 杨道扬(V81 无表行)
  UNION ALL SELECT 48, '一楼西侧'    -- 卢志华(V81 无表行)
  UNION ALL SELECT 49, '一楼西侧'    -- 诺玲  (V81 无表行)
  UNION ALL SELECT 50, '二楼东侧'
  UNION ALL SELECT 51, '二楼'        -- C2消防
  UNION ALL SELECT 52, '二楼'        -- C2走廊
  UNION ALL SELECT 53, '三楼东侧'
  UNION ALL SELECT 54, '四楼东侧'
  UNION ALL SELECT 55, '四楼西侧'
  UNION ALL SELECT 56, '天面'        -- C东西侧楼梯间(r56/57 折一池)
  UNION ALL SELECT 58, '天面'        -- C东侧货梯(r58/59/60 三表折一池)
  UNION ALL SELECT 61, '天面'        -- C西侧货梯
  UNION ALL SELECT 63, '一楼东侧'
  UNION ALL SELECT 64, '二楼东侧'
  UNION ALL SELECT 65, '二楼西侧'
  UNION ALL SELECT 66, '三楼东侧'
  UNION ALL SELECT 67, '三楼西侧'
  UNION ALL SELECT 68, '四楼东侧'
  UNION ALL SELECT 69, '四楼西侧'
  UNION ALL SELECT 70, '天面'        -- D东西侧楼梯间(r70/71 折一池)
  UNION ALL SELECT 72, '天面'        -- D东侧货梯
  UNION ALL SELECT 73, '天面'        -- D西侧货梯
  UNION ALL SELECT 75, '二楼东侧'
  UNION ALL SELECT 76, '二楼西侧'
  UNION ALL SELECT 77, '三楼东侧'
  UNION ALL SELECT 78, '三楼西侧'
  UNION ALL SELECT 79, '四楼东侧'
  UNION ALL SELECT 80, '四楼西侧'
  UNION ALL SELECT 81, '天面'        -- E东西侧楼梯间(r81/82 折一池)
  UNION ALL SELECT 83, '天面'        -- E东侧货梯
  UNION ALL SELECT 84, '天面'        -- E西侧货梯
  UNION ALL SELECT 86, '一楼东侧'
  UNION ALL SELECT 87, '二楼东侧'
  UNION ALL SELECT 88, '二楼西侧'
  UNION ALL SELECT 89, '三楼东侧'
  UNION ALL SELECT 90, '三楼西侧'
  UNION ALL SELECT 91, '四楼东侧'
  UNION ALL SELECT 92, '四楼西侧'
  UNION ALL SELECT 93, '天面'        -- F东西侧楼梯间(r93/94 折一池)
  UNION ALL SELECT 95, '天面'        -- F东侧货梯
  UNION ALL SELECT 96, '天面'        -- F西侧货梯
) c ON c.book_row = r.book_row AND r.zone = 'p1'
SET r.floor_label = c.fl;

-- ── 2) 一期不再带 side(原册没有这个字段;二期/宿舍不动)──
UPDATE alloc_rule SET side = NULL WHERE zone = 'p1' AND side IS NOT NULL;

-- ── 3) §H4.2c 招商中心不是物理楼栋 ────────────────────────────────────────
-- 原册 B 列「招商中心」与 A座/B座…并列,是**区域**的一个取值(3 行:r8 总电表、r17/r18 四楼公共)。
-- 系统把它建成了 building,一期屏因此被它抽出第七条带 —— 本次报障的结构症状之一。
-- 分带已由 V80 的 book_block 接管,building_id 只剩「损耗归组 + 抄表定位」两个用途,
-- 而招商中心的表已由 V77 归到 A 座损耗组。此处只改备注文案,不删楼栋(表档案与单元还挂着它)。
UPDATE building SET remark = '抄表区域,非损耗楼栋:原册「公共电分摊明细」B 列的一个区域取值(与 A~F 座并列),不是物理楼栋;损耗已由 V77 归入一期 A 座,一期池分带走 alloc_rule.book_block 不再依赖本栋'
WHERE name = '一期 招商中心';
