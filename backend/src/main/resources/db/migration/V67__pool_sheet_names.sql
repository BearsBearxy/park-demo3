-- V67__pool_sheet_names.sql — 二期池名与分带对照「公共电数据」原册(用户裁定 2026-07-28)。
-- 原册结构:B列=所属车间(物理位置)、D列=公摊类别 → 池名=B+D 组合;
-- 分带=B列车间(消防水稳压泵挂一车间/绿化水泵挂四车间/路灯、充电桩、广告字挂五六车间),"园区"仅 消防设施 一项。
-- 全部幂等(WHERE name IN (旧,新));meter.name(抄表册A列标识)不动,cfg/绑定按 rule id 关联不受影响。

-- ── 改名(旧A列表标识名 → 原册 B+D 池名) ──
UPDATE alloc_rule SET name='一车间电梯+低压电房照明' WHERE zone='p2' AND name IN ('一车间电梯','一车间电梯+低压电房照明');
UPDATE alloc_rule SET name='二车间电梯+低压电房照明' WHERE zone='p2' AND name IN ('二车间电梯','二车间电梯+低压电房照明');
UPDATE alloc_rule SET name='三车间电梯+低压电房照明' WHERE zone='p2' AND name IN ('三车间电梯','三车间电梯+低压电房照明');
UPDATE alloc_rule SET name='四车间电梯+低压电房照明' WHERE zone='p2' AND name IN ('四车间电梯','四车间电梯+低压电房照明');
UPDATE alloc_rule SET name='五车间电梯+低压电房照明' WHERE zone='p2' AND name IN ('五车间电梯','五车间电梯+低压电房照明');
UPDATE alloc_rule SET name='六车间电梯+低压电房照明' WHERE zone='p2' AND name IN ('六车间电梯2','六车间电梯+低压电房照明');
UPDATE alloc_rule SET name='园区消防设施' WHERE zone='p2' AND name IN ('园区生活水泵、消防控制室','园区消防设施');
UPDATE alloc_rule SET name='一车间消防水稳压泵' WHERE zone='p2' AND name IN ('园区消防水稳压泵','一车间消防水稳压泵');
UPDATE alloc_rule SET name='四车间绿化水泵' WHERE zone='p2' AND name IN ('园区绿化水泵','四车间绿化水泵');
UPDATE alloc_rule SET name='五车间广告字灯（消防分表）' WHERE zone='p2' AND name IN ('五车间装饰灯新表','五车间广告字灯（消防分表）');
UPDATE alloc_rule SET name='五车间广告字灯（火炬园）' WHERE zone='p2' AND name IN ('火炬园广告字电','五车间广告字灯（火炬园）');
UPDATE alloc_rule SET name='五车间保安亭、路灯等' WHERE zone='p2' AND name IN ('园区保安亭路灯','五车间保安亭、路灯等');
UPDATE alloc_rule SET name='五车间充电桩/保安亭' WHERE zone='p2' AND name IN ('园区充电桩','五车间充电桩/保安亭');
UPDATE alloc_rule SET name='六车间广告字灯（消防分表）' WHERE zone='p2' AND name IN ('六车间广告字新表','六车间广告字灯（消防分表）');

-- ── 分带挂栋(原册 B列物理车间;园区消防设施 留 NULL=园区级) ──
UPDATE alloc_rule r JOIN building b ON b.name='二期 一车间' SET r.building_id=b.id WHERE r.zone='p2' AND r.name='一车间消防水稳压泵';
UPDATE alloc_rule r JOIN building b ON b.name='二期 四车间' SET r.building_id=b.id WHERE r.zone='p2' AND r.name='四车间绿化水泵';
UPDATE alloc_rule r JOIN building b ON b.name='二期 五车间' SET r.building_id=b.id WHERE r.zone='p2' AND r.name IN ('五车间广告字灯（消防分表）','五车间广告字灯（火炬园）','五车间保安亭、路灯等','五车间充电桩/保安亭');
UPDATE alloc_rule r JOIN building b ON b.name='二期 六车间' SET r.building_id=b.id WHERE r.zone='p2' AND r.name='六车间广告字灯（消防分表）';
