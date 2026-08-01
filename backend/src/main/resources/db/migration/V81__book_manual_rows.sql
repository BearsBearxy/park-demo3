-- V81__book_manual_rows.sql — 刀H §H4.2e:补回原册 4 个「有分摊关系但没有电表」的行。
-- 结构依据:BOOK-STRUCTURE-2024-02.md §1.2「特殊行」+ 直读『一期2024年2月水电费.xlsx』sheet「公共电分摊明细」
-- r12 / r47 / r48 / r49 逐格核对(2026-07-31):
--   r12  B='A座' C='一楼' Z='联塑精铟';无 A/D/E/F/G/H/S/AC/AD,只有 AE12=232、AF12=232 两个手输常数;
--        落在 r12–r30 区间 → 块2『A座电梯及楼层公共电合计』(合计行 r31)。
--   r47/48/49  B='C座' C='一楼西侧';D='公共用电/杨道扬'|'公共用电/卢志华'|'公共用电/诺玲';
--        E='公共用电/已分摊';G=文本『无公共电表』;I/N/S 均为文本『/』;AC/AD 字面 0;
--        AE 从总表拉回 3.5 / 3.5 / 2.75;Z='杨道扬104室'|'卢志华105室'|'诺玲106室';
--        落在 r46–r61 区间 → 块4『C座电梯及楼层公共电合计』(合计行 r62)。
-- 四行共同点:**A 列(自然键)为空** → book_key 只能留 NULL(不许编一个原册没有的键)。
--
-- ⚠ 红线:本迁移只**新增**行,一格既有数据都不 UPDATE ——
--   既有 67 个一期池的 cost_amount/std_value/base_snap/qty_* 无从改变;
--   alloc_loss_result 由 meter 驱动(lossGroups 只遍历 meter,不看 rule),新增无表规则同样无从改变。

-- ── 新 method=manual ──────────────────────────────────────────────────────
-- 语义:无绑定表 → 不参与用量与应分摊计算,qty/cost/std 恒 NULL,不进屏上合计,也不报「缺读数」
-- (它们本就没有表可抄,报缺抄是假警报)。金额由人工录入或从总表回勾(回勾链属账单模块,本刀不做)。
ALTER TABLE alloc_rule MODIFY COLUMN method VARCHAR(10) NOT NULL
  COMMENT 'direct/area/floor/loss/none(不分摊,全额挂亏)/ref(纯标准行:只出std不出应分摊,不入合计)/carrier(冲减载体:表已在别池以sign=-1冲减,本行只陈列用量不出应分摊、不入金额合计)/manual(无电表:有分摊关系但没表,qty/cost恒NULL,金额人工录入或从总表回勾)';

-- ── 4 条无表规则 ──────────────────────────────────────────────────────────
-- sort_no 取 91–94(接在 dorm 的 89/90 之后)而**不是**原册行序:
--   原册 r12 该插在 sort_no=24 与 25 之间、r47–49 该在 50 与 51 之间,中间没有空号;
--   要对齐就得整体重编 sort_no,而 sort_no 已被 PoolSeedIT 当规则定位键逐条断言(39/49/89)。
--   原册行序由 V80 的 book_row 表达(屏序也走它),sort_no 只是内部次序,故不强求同序。
-- floor_label 直接写原册 C 列一格原文(『一楼』/『一楼西侧』),side 留 NULL —— 与 §H4.2a/H4c「一期定位归一」同向。
-- fee_name = 原册 D 列原文(与 V80 口径一致);r12 无 D 列 → NULL,池名末段改用 Z12『联塑精铟』(该行唯一的标识文字)。
-- coefficient/base_key 留 NULL:无表也无分摊基数,不给引擎任何可算的东西。
INSERT INTO alloc_rule
  (zone, name, book_block, book_key, book_row, building_id, method, coefficient, extra_qty,
   floor_label, side, fee_name, fee_key, note, sort_no, round_scale, std_kind, base_key)
VALUES
  ('p1', '一期 A座·一楼·联塑精铟', 'A座电梯及楼层公共电合计', NULL, 12,
   (SELECT id FROM building WHERE name='一期 A座'), 'manual', NULL, 0,
   '一楼', NULL, NULL, 'share_elec_floor',
   '原册 r12 无表行:A/D/E/F/G/H/S/AC/AD 全空,只有 AE12=AF12=232 两个手输常数(AF 未按公式算);Z12=联塑精铟。金额人工录入/从总表回勾',
   91, 2, NULL, NULL),
  ('p1', '一期 C座·一楼西侧·公共用电/杨道扬', 'C座电梯及楼层公共电合计', NULL, 47,
   (SELECT id FROM building WHERE name='一期 C座'), 'manual', NULL, 0,
   '一楼西侧', NULL, '公共用电/杨道扬', 'share_elec_floor',
   '原册 r47 无表行:G=无公共电表,I/N/S 为文本「/」,AC/AD 字面 0,AE47=3.5 从总表拉回;Z47=杨道扬104室',
   92, 2, NULL, NULL),
  ('p1', '一期 C座·一楼西侧·公共用电/卢志华', 'C座电梯及楼层公共电合计', NULL, 48,
   (SELECT id FROM building WHERE name='一期 C座'), 'manual', NULL, 0,
   '一楼西侧', NULL, '公共用电/卢志华', 'share_elec_floor',
   '原册 r48 无表行:G=无公共电表,I/N/S 为文本「/」,AC/AD 字面 0,AE48=3.5 从总表拉回;Z48=卢志华105室',
   93, 2, NULL, NULL),
  ('p1', '一期 C座·一楼西侧·公共用电/诺玲', 'C座电梯及楼层公共电合计', NULL, 49,
   (SELECT id FROM building WHERE name='一期 C座'), 'manual', NULL, 0,
   '一楼西侧', NULL, '公共用电/诺玲', 'share_elec_floor',
   '原册 r49 无表行:G=无公共电表,I/N/S 为文本「/」,AC/AD 字面 0,AE49=2.75 从总表拉回;Z49=诺玲106室',
   94, 2, NULL, NULL);
