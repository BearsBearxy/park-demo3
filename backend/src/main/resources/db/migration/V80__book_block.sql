-- V80__book_block.sql — 刀H §H4.2 b/d/f:原册块与自然键回填(BOOK-REBUILD-SPEC)。
-- 结构依据:BOOK-STRUCTURE-2024-02.md §1 + 直读『一期2024年2月水电费.xlsx』sheet「公共电分摊明细」A/B/C 列。
-- 本迁移**只加定位与排序字段**,不动 method/coefficient/extra_qty/base_key/fee_key ——
-- 既有 67 个一期池的 cost_amount/std_value/base_snap/qty_* 逐格不变。

-- ── 三个新字段 ────────────────────────────────────────────────────────────
-- ⚠ 为什么原册行序另开 book_row 而不是覆盖 sort_no:
--   sort_no(一期 22..88)已被 PoolSeedIT 当作规则定位键逐条断言(如 sort_no=39/49/89、links「22->23」),
--   改值等于改契约。且 sort_no 与原册行序**不是同序**:池23(招商中心电1,原册 r8)排在
--   池24(园区损耗池,首行 r5)之前 —— 屏上要复刻原册就必须有独立的原册行号。
ALTER TABLE alloc_rule
  ADD COLUMN book_block VARCHAR(32) NULL COMMENT '原册块名=「公共电分摊明细」7 个合计行标签原文(B11/B31/B45/B62/B74/B85/B97);二期/宿舍无块=NULL' AFTER name,
  ADD COLUMN book_key   VARCHAR(64) NULL COMMENT '原册自然键=「公共电分摊明细」A 列原文(下游 VLOOKUP 查找键);多行折一池的取首行' AFTER book_block,
  ADD COLUMN book_row   SMALLINT    NULL COMMENT '原册行号(book_key 所在行,5..96)=块内排序依据;多行折一池的取首行' AFTER book_key;

-- ── 回填:原册 85 数据行 ↔ 库内 67 条一期规则 ───────────────────────────────
-- 配对以 V65 种子名为证:67 条里 65 条的 name 与原册 A 列**逐字相同**(种子本就是照 A 列建的),
-- 另 2 条是折叠/改名行:
--   sort_no=22「招商中心净电」= 原册 r8 A='招商中心电1';
--   sort_no=23「园区公共电」(损耗池)= 原册 r5/r6/r7/r9 四行折一池(AG5:AG9 合并「计入园区损耗分摊」),取首行 r5。
-- 其余折叠池同样取首行:39=r27(A座四梯 AC27 合并)、48=r41、49=r43、57=r56、58=r58(C东三表)、
--   67=r70、76=r81、86=r93。
-- 原册 4 个无表行(r12 联塑精铟、r47/48/49 C座一楼西侧三户)库内**没有对应规则**,是 H4b 要补的,本刀不建。
UPDATE alloc_rule r JOIN (
  SELECT 22 sort_no,  8 book_row, '招商中心电1' book_key, 'A座及园区公共表合计：' book_block
  UNION ALL SELECT 23,  5, '地下车库东侧照明', 'A座及园区公共表合计：'
  UNION ALL SELECT 24, 10, '园区路灯', 'A座及园区公共表合计：'
  UNION ALL SELECT 25, 13, '旭化成1东公', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 26, 14, '旭化成2东公', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 27, 15, 'A2西侧公共', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 28, 16, 'A3西侧公共', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 29, 17, '中大4楼公共', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 30, 18, '4楼空调外机电', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 31, 19, 'A4东侧公共', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 32, 20, 'A4西侧走廊灯', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 33, 21, 'A4西侧消防灯', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 34, 22, '戎合A501公共', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 35, 23, '鑫皇公共', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 36, 24, 'A6东侧走廊灯', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 37, 25, 'A6东侧消防灯', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 38, 26, '可莱恩A602公共电', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 39, 27, 'A东侧货梯', 'A座电梯及楼层公共电合计'
  UNION ALL SELECT 40, 33, '戎合B101公共电', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 41, 34, '杨文正公共电', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 42, 35, '可莱恩B201东侧公共电', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 43, 36, '可莱恩B201西侧公共电', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 44, 37, '欧培仪东侧公共', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 45, 38, '欧培仪西侧公共', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 46, 39, '碧沃丰B401东侧公共电', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 47, 40, '碧沃丰B401西侧公共电', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 48, 41, 'B东侧楼梯间', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 49, 43, 'B东侧货梯', 'B座电梯及楼层公共电合计'
  UNION ALL SELECT 50, 46, '高建军C公共', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 51, 50, '力美C201东侧公共电', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 52, 51, 'C2消防', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 53, 52, 'C2走廊', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 54, 53, '力美C301东侧公共电', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 55, 54, '道磁C401东侧公共电', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 56, 55, '可莱恩C402西侧公共电', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 57, 56, 'C东侧楼梯间', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 58, 58, 'C东侧货梯电表1', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 59, 61, 'C西侧货梯', 'C座电梯及楼层公共电合计'
  UNION ALL SELECT 60, 63, '邱彩云东侧公共电', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 61, 64, 'D201东侧电', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 62, 65, 'D201西侧电', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 63, 66, '金纳D301东侧公共电', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 64, 67, '金纳D301西侧公共电', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 65, 68, '飞度东侧公共电', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 66, 69, '一元兰欣西侧公共电', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 67, 70, 'D东侧楼梯间', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 68, 72, 'D东侧货梯', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 69, 73, 'D西侧货梯', 'D座电梯及楼层公共电合计'
  UNION ALL SELECT 70, 75, 'E二楼东侧公共电', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 71, 76, '天玛E201西侧公共电', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 72, 77, '翔海E301东侧公共电', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 73, 78, '翔海E301西侧公共电', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 74, 79, '翔海E401东侧公共电', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 75, 80, '翔海E401西侧公共电', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 76, 81, 'E东侧楼梯间', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 77, 83, 'E东侧货梯', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 78, 84, 'E西侧货梯', 'E座电梯及楼层公共电合计'
  UNION ALL SELECT 79, 86, '思汗F101东侧公共电', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 80, 87, '优凯F201东侧公共电', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 81, 88, '优凯F201西侧公共电', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 82, 89, '优凯F301东侧公共电', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 83, 90, '优凯F301西侧公共电', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 84, 91, 'F401东侧公共电', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 85, 92, 'F401西侧公共电', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 86, 93, 'F东侧楼梯间', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 87, 95, 'F东侧货梯', 'F座电梯及楼层公共电合计'
  UNION ALL SELECT 88, 96, 'F西侧货梯', 'F座电梯及楼层公共电合计'
) b ON b.sort_no = r.sort_no AND r.zone = 'p1'
SET r.book_block = b.book_block, r.book_key = b.book_key, r.book_row = b.book_row;

-- ── §H4.2f 「净电」不是原册用语 ───────────────────────────────────────────
-- 全簿(一期 33 sheet + 二期 68 sheet)搜不到「净电」二字。原册 r8 原文:
--   A8='招商中心电1'、B8='招商中心'、C8='四楼'、D8(企业名称)='招商中心'、E8='总电表'。
-- 费项列(fee_name)对应原册 D 列,故改回 D8 原文。
-- name 保留现状(V70 起的「一期 招商中心·净电」)不动 —— 既有引用/备份脚本按名字找它;
-- 屏上池名称列改优先显 book_key,由并行刀 H4 前端处理。
-- ⚠按 sort_no 定位,不按 id,也不加 fee_name='净电' 的前置条件:V70 那批改名是**按 id** 写的,
--   而 alloc_rule 的自增起点在 dev 库与全新迁移链上差 1(dev 最小 id=2),于是同一条规则在两处
--   拿到的是**错位一行**的 V70 载荷 —— 全新库里 sort_no=22 的费项是「电梯+低压电房照明」而非「净电」。
--   本刀按原册把它一律钉成 D8 原文,两边库因此收敛到同一真值。(V70 的错位不在本刀独占范围,已在交付说明里报备。)
UPDATE alloc_rule SET fee_name = '招商中心' WHERE zone = 'p1' AND sort_no = 22;
