-- V77__zs_meter_owner.sql — 刀G §G1/§G2:恢复招商中心两块总表的归属,并加「人工归属」护栏让它推不翻。
--
-- 背景:V66 §4 已把 招商中心电1/2 挂到一期A座、ownership='share'(依据 S92=SUM(S7:S91)-…+X50,
-- X50=S49+S50-SUM(S44:S48) → 净效果是这两块表的 1142.40 度计入 A座分表Σ,招商中心其余表净出;
-- 移除后招商中心楼栋无 infra 表,不再自成损耗组)。V66 于 2026-07-27 应用成功,
-- 但 MeterService.applyDesc 对 ownership/building_id 是**无条件回写**:导入行 area='招商中心'→楼栋41、
-- meter_type='总电表'→infra,每导一次就把 V66 推翻一次,库里现在又是 41/infra。
-- 所以只恢复数据没用,必须同时加护栏 —— 见下面 owner_manual 列与 MeterService §G2。
--
-- 对账闭合:33734.10(shadow 护栏生效后的 A座活数据)+ 1142.40 = 34876.50 = 原册「A座总用电量」。
-- 净电池(rule 23 一期 招商中心·净电)按 alloc_rule_meter 显式绑定算量,与 ownership/building_id 无关,
-- 归属恢复不改它的任何数字(仍 152.06 度 / 169.42 元)。

-- ── 1) 归属人工标志(与 V76 loc_manual 同款范式) ──────────────────────────
-- 0=自动:导入照常回写 ownership/building_id(自动分类继续起作用);
-- 1=人工设定:导入两列一列不动,且导入判定与人工值不同时落一条 warn。
-- 由 MeterService.apply()(档案 POST/PUT)按「本次 PUT 的结果与库内旧值是否不同」派生维护,不收请求体。
-- ⚠取舍:归属的自动分类(classifyOwnership / buildingIdFor)现在住在前端 meterSplit.ts,
-- 后端复算不出「自动结果」,故无法像 loc_manual 那样拿结果与自动解析比、也就无法自动退回 0。
-- 这是单向闩:人工改过即永久保护,要恢复自动跟随需人工清标(暂无入口,YAGNI)。
ALTER TABLE meter
  ADD COLUMN owner_manual TINYINT NOT NULL DEFAULT 0
  COMMENT '归属(ownership/building_id)是否人工设定:0=自动,导入照常回写;1=人工设定,导入两列不动、判定不同只落warn';

-- ── 2) 招商中心电1/2 → 一期A座 + share,并标人工(判据与 V66 §4 同源:按 name 匹配,不硬编码 id) ──
UPDATE meter m JOIN building b ON b.name='一期 A座'
SET m.building_id=b.id, m.ownership='share', m.owner_manual=1
WHERE m.kind='elec' AND m.zone='p1' AND m.name IN ('招商中心电1','招商中心电2');
