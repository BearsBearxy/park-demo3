-- V84__split_loss_rows.sql — 刀I §I1/§I5(ROW-IDENTITY-SPEC)。
-- 结构依据:直读原册 `一期2024年2月水电费.xlsx` sheet「公共电分摊明细」r5–r10(2026-08-01 复核)。

-- ══ §I1 拆开「园区公共电」池:原册 r5/r6/r7/r9 本就是 4 个独立行,不是一个分摊池 ══
-- 原册实测(data_only 缓存值):
--   r5 A座·负一层·地下车库东侧照明 G=220605000150 S5=29.51  AC5=AD5=32.88
--   r6 A座·负一层·地下车库西侧照明 G=220605000131 S6=18.55  AC6=AD6=20.67
--   r7 A座·一楼  ·大堂           G=220605000125 S7=101.51 AC7=AD7=113.10
--   r8 招商中心·四楼·招商中心      G=220605000017 S8=152.06 AC8=AD8=169.42   ← 现有 rule(book_key=招商中心电1)
--   r9 A座·负一层·生活加压泵       G=220605000130 S9=219.19 AC9=AD9=244.21
-- AC/AD **逐行独立**,五行之间没有任何纵向合并;唯一合并的是 AG5:AG9 的备注「计入园区损耗分摊」——
-- 那是**去向标记**,不是分摊池。而 `一期园区损耗!G4/G6..G10 = ROUND(SUM(公共电分摊明细!S5:S9)/6,2)`
-- 取的正是这 5 行的 Σ,不是某个池的量。
-- 系统原把 r5/r6/r7/r9 折成一条 method='loss' 的池(取池级楼层/名称 → 屏上 4 行身份错 3 行),
-- 又用 fold_qty 把 r8 的净量折进这个池(→ 块1 合计把 152.06/169.42 计两遍)。本刀按原册还原成 5 个独立行。

-- ① 先删旧池(book_key='地下车库东侧照明' 且 method='loss' 唯一命中原 rule 24)。
--    alloc_rule_link(fold_qty 招商中心→本池)/alloc_rule_meter/alloc_pool_meter_result 三张表 FK 均 ON DELETE CASCADE,
--    随删而去;alloc_pool_result 是 NO ACTION,必须先手删历史快照行(重生成时按新规则重新落)。
DELETE l FROM alloc_rule_link l JOIN alloc_rule d ON d.id = l.dst_rule_id
WHERE d.zone = 'p1' AND d.book_key = '地下车库东侧照明' AND d.method = 'loss';
DELETE p FROM alloc_pool_result p JOIN alloc_rule r ON r.id = p.rule_id
WHERE r.zone = 'p1' AND r.book_key = '地下车库东侧照明' AND r.method = 'loss';
DELETE c FROM alloc_cfg c JOIN alloc_rule r ON c.scope = CONCAT('rule:', r.id)
WHERE r.zone = 'p1' AND r.book_key = '地下车库东侧照明' AND r.method = 'loss';
DELETE FROM alloc_rule WHERE zone = 'p1' AND book_key = '地下车库东侧照明' AND method = 'loss';

-- ② 4 条独立规则:method='direct'(原册 AC=AD=整额,direct 的 std 恒等于 cost);
--    B/C/D 三列逐行取原册原文 → building_id=A座、floor_label=原册 C 列、name 按 V70 位置化命名。
--    ⚠sort_no:一期屏序 V80 起 = 块序(book_block)→ 块内行序(book_row)→ side → sort_no(AllocService.pools 比较器),
--      sort_no 只是最后的同序兜底;全量重排 p1 的 sort_no 会打断一批按 sort_no 定位的种子断言与配置,
--      故这里只追加在末尾(现 p1 max=94)并保持 r5<r6<r7<r9 的相对原册行序。
INSERT INTO alloc_rule (zone, name, book_block, book_key, book_row, building_id, method,
                        extra_qty, fee_key, note, sort_no, round_scale, floor_label) VALUES
('p1', '一期 A座·负一层·地下车库东侧照明', 'A座及园区公共表合计：', '地下车库东侧照明', 5,
 (SELECT id FROM building WHERE name = '一期 A座'), 'direct', 0.00, 'park_loss_pool',
 '计入园区损耗分摊', 95, 2, '负一层'),
('p1', '一期 A座·负一层·地下车库西侧照明', 'A座及园区公共表合计：', '地下车库西侧照明', 6,
 (SELECT id FROM building WHERE name = '一期 A座'), 'direct', 0.00, 'park_loss_pool',
 '计入园区损耗分摊', 96, 2, '负一层'),
('p1', '一期 A座·一楼·大堂', 'A座及园区公共表合计：', 'A1大堂', 7,
 (SELECT id FROM building WHERE name = '一期 A座'), 'direct', 0.00, 'park_loss_pool',
 '计入园区损耗分摊', 97, 2, '一楼'),
('p1', '一期 A座·负一层·生活加压泵', 'A座及园区公共表合计：', '生活加压泵', 9,
 (SELECT id FROM building WHERE name = '一期 A座'), 'direct', 0.00, 'park_loss_pool',
 '计入园区损耗分摊', 98, 2, '负一层');

-- ③ 各绑 1 块表(与原池那 4 条绑定逐条同一块表,只是从一池 4 表变成四池各 1 表)。
--    按表名绑,与 V65 建这 4 条绑定时同一把键 —— 迁移种子建的表只有 name,code 是后来真实导入才填的,
--    按 code 绑在全新库上一条也命不中。dev 库已核对 名↔编码↔原册 G 列三者一致(2026-08-01 只读 SQL):
--      地下车库东侧照明=220605000150(#182) / 地下车库西侧照明=220605000131(#183)
--      A1大堂=220605000125(#188)         / 生活加压泵=220605000130(#184)
INSERT INTO alloc_rule_meter (rule_id, meter_id, sign)
SELECT r.id, m.id, 1
FROM alloc_rule r
JOIN meter m ON m.kind = 'elec' AND m.zone = 'p1' AND m.name = r.book_key
WHERE r.zone = 'p1' AND r.fee_key = 'park_loss_pool'
  AND r.book_key IN ('地下车库东侧照明', '地下车库西侧照明', 'A1大堂', '生活加压泵');

-- ④ 招商中心(r8)并入同一去向:fee_key 从 share_elec_floor 改 park_loss_pool。
--    它是 5 行里唯一的净额行(两块 80 倍总表 − 5 块子表 − 670 度自用 = S8 = 一期园区电!X50−670),
--    净量口径一格不动;改的只是「这一行的钱去哪」——原册 AG5:AG9 合并备注说得很清楚:计入园区损耗分摊。
--    method 仍是 direct 且无受益人 → 户级不出行(与刀前完全相同,不产生任何新账单)。
UPDATE alloc_rule SET fee_key = 'park_loss_pool',
    note = '计入园区损耗分摊;招商中心两块80倍总表-5子表-670度自用(S8=X50-670)'
WHERE zone = 'p1' AND book_key = '招商中心电1';

-- ⑤ 损耗侧取数不改代码:AllocService.shareQtyOf 本就是「Σ(zone=p1 且 fee_key='park_loss_pool' 的规则当月净量)」,
--    刀前该费键只挂 1 条池(量里含 fold_qty 折入的招商中心),刀后挂 5 条独立行,Σ 逐格相等:
--      29.51 + 18.55 + 101.51 + 219.19 + 152.06 = 520.82
--      G = ROUND(520.82 / park_share_div(6), 2) = 86.80;A座另 loss_g_adj = −1500 → g_qty = −1413.20
--    六座 g_qty 一格不变。

-- ══ §I5【临时回退】meter 1421『永龙反向有功』ownership 改回 tenant ══
-- V79 已把它从 tenant 改成 register(非计费计度寄存器)。用户尚未在三个选项里拍板,本刀先回退到拍板前状态,
-- 使 §I1 的验证能在「损耗数字一格不变」的前提下进行。三个选项与各自后果原样记录如下:
--   A 不剔除(=本回退):二/三/四车间合并组 d_qty 81158.44、e_qty −4511.56、租户损耗率 0.0255 —— 与账册一致;
--   B 剔除(V79 口径):d_qty 65631.44、e_qty −20038.56、损耗率 0.2067 —— 涨 8.1 倍,账册对不上;
--   C 剔除 + 把三车间 loss_adj_qty 从 −2500 调到约 −18027:损耗率回到 0.0255,但调整量成了一个无出处的补数。
-- 一旦用户拍 B 或 C,再开新迁移改回来;在此之前不要把这一行当成结论。
UPDATE meter SET ownership = 'tenant'
WHERE kind = 'elec' AND zone = 'p2' AND name = '永龙反向有功';
