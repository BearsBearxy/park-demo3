-- pool-fee-key-fix-20260730.sql — 池费项键错挂 + 池名漏空格(2026-07-30)
--
-- ① 池 13「二期园区·绿化水泵」fee_key='share_elec_fire' → 1328.49 元绿化水泵电费按**消防**费项开到户账。
--    依据:POOL-FORMULA-AUDIT-2024-02.md「户表消耗侧…绿化水=V65×面积」与「园区绿化水泵(r65-70)…
--    经户表『绿化水公摊』行按面积计收」;P2-UTILITY-FEE-STRUCTURE.md「园区级:…绿化水泵(→0.008/㎡ 随水费)」
--    → 该池户侧费项=绿化水公摊,与 dorm 池 91「宿舍区·绿化水」同键 share_green_water。
--    (不用 share_water:PB-ALLOCATION-SPEC §49 的占位键,AllocService 对 share_water 明确「占位不生成」,
--     挂上去这 1328 元会整笔消失;share_green_water 不在任何排除分支,正常出户账。)
-- ② 池 33 name='一期A座·四楼西侧·走廊灯' 漏了楼栋名里的空格(building.name='一期 A座'),
--    与 poolName() 自动名不一致 → 对齐。改完 name<>autoName 只剩 41/42/51 三个 fee_name IS NULL 的【待人工】池。
--
-- 幂等:按 id + 旧值 WHERE,重跑影响 0 行。执行后须重新生成受影响月份(POST /api/alloc/generate?ym=…)。

UPDATE alloc_rule SET fee_key = 'share_green_water'
 WHERE id = 13 AND fee_key = 'share_elec_fire';

UPDATE alloc_rule SET name = '一期 A座·四楼西侧·走廊灯'
 WHERE id = 33 AND name = '一期A座·四楼西侧·走廊灯';

-- 核对
SELECT id, zone, name, fee_name, fee_key FROM alloc_rule WHERE id IN (13, 33, 91);
