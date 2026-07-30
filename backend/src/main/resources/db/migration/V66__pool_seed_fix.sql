-- V66__pool_seed_fix.sql — S3-B1 终验刀:损耗组结构修正 + 分表Σ成员对齐(2024-02 勾稽)。
-- 全部幂等(DELETE+INSERT / 条件 UPDATE);逐条注明依据(源=一期/二期2024年2月水电费.xlsx 抄表册段落Σ公式)。
-- dev 独有的导入新档(building_id NULL)在 CI 容器不存在 → 对应 UPDATE 命中 0 行,无副作用。

-- ── 0) 自足式补档(V65 同款,空库/CI 自足;dev 已有则全部 WHERE NOT EXISTS 跳过) ──
-- 本迁移的 cfg 行依赖以下非池表/楼栋,V65 未建档:
INSERT INTO building (name, phase, floor_count, total_area, rentable_area, status, per_floor) SELECT '一期 G座', 1, 4, 0, 0, 1, 4 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM building WHERE name='一期 G座');
INSERT INTO meter (kind, zone, name, factor, ownership) SELECT 'elec', 'p1', 'A座总电', 1, 'infra' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM meter WHERE kind='elec' AND zone='p1' AND name='A座总电');
INSERT INTO meter (kind, zone, name, factor, ownership) SELECT 'elec', 'p1', '四车间工地', 1, 'tenant' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM meter WHERE kind='elec' AND zone='p1' AND name='四车间工地');
INSERT INTO meter (kind, zone, name, factor, ownership) SELECT 'elec', 'p1', '力美C201电', 1, 'tenant' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM meter WHERE kind='elec' AND zone='p1' AND name='力美C201电');

-- ── 1) 一期A座:组C只取「A座总电」──────────────────────────────────────────
-- 依据:一期园区损耗 C4==一期园区电!S5(38550),只引 A座总电;
-- A座自装总表(S6)不在 S92=SUM(S7:S91) 起点内,A4东侧总1/2(S51/S52)、A4西侧总(S60)、A6东侧总(S77)被 S92 显式扣除
-- → 该组其余 infra 表既不进C也不进D。
DELETE c FROM alloc_cfg c JOIN building b ON c.scope=CONCAT('building:',b.id)
WHERE b.name='一期 A座' AND c.cfg_key='loss_c_meter' AND c.acct_month='';
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)
SELECT CONCAT('building:', b.id), 'loss_c_meter', m.id, '', '组C只取A座总电(损耗表C4只引S5;自装总表/A4A6分层总表不入C/D)'
FROM building b JOIN meter m ON m.kind='elec' AND m.zone='p1' AND m.name='A座总电'
WHERE b.name='一期 A座';

-- ── 2) 一期G座:loss_variant=2 陈列不出率 ─────────────────────────────────
-- 依据:一期园区损耗 r11/r12(G座247.2 / G自建专变172)两行独立供电链、D=C、无损耗核算;
-- dev 两块 infra 同挂 G座合并成一组(C=419.2/D=张执盛247.2),按变体2仅陈列,rate=null;合并陈列差异在 fixture 作 known 归档。
DELETE c FROM alloc_cfg c JOIN building b ON c.scope=CONCAT('building:',b.id)
WHERE b.name='一期 G座' AND c.cfg_key='loss_variant' AND c.acct_month='';
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)
SELECT CONCAT('building:', b.id), 'loss_variant', 2, '', 'G座/G自建专变独立供电链仅陈列不出率(Excel r11/r12 无损耗核算)'
FROM building b WHERE b.name='一期 G座';

-- ── 3) 抄表册段落Σ明确剔除的表 → meter:{id}.loss_exclude=1(不入C/D) ────────
-- 依据:B座 S112=SUM(S96:S111) 不含 r95 四车间工地;C座 S147=SUM(S114:S146)-S131(力美C201电);
-- 五车间 S84=SUM(S67:S83)-S73-S74-S68-S69(装饰灯新表/火炬园广告字电为消防分表);六车间 S101=SUM(S86:S100)-S87(广告字新表)。
DELETE FROM alloc_cfg WHERE cfg_key='loss_exclude' AND acct_month='' AND scope IN (
  SELECT CONCAT('meter:', id) FROM meter WHERE kind='elec' AND (
    (zone='p1' AND name IN ('四车间工地','力美C201电'))
    OR (zone='p2' AND name IN ('五车间装饰灯新表','火炬园广告字电','六车间广告字新表'))));
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)
SELECT CONCAT('meter:', m.id), 'loss_exclude', 1, '', CONCAT('抄表册段落Σ剔除行,不入损耗C/D:', m.name)
FROM meter m WHERE m.kind='elec' AND (
  (m.zone='p1' AND m.name IN ('四车间工地','力美C201电'))
  OR (m.zone='p2' AND m.name IN ('五车间装饰灯新表','火炬园广告字电','六车间广告字新表')));

-- ── 4) 招商中心电1/2 → 挂一期A座、ownership=share ─────────────────────────
-- 依据:S92=SUM(S7:S91)-S51-S52-S60-S77-S49-S50+X50,X50=S49+S50-SUM(S44:S48)
-- → 净效果=招商中心电1/2(1142.4)计入A座分表Σ,招商中心其余表(S44:S48)净出;
-- 移除后招商中心(41)无 infra 表,不再自成损耗组(上轮"多出招商中心组"即由此二表造成)。
UPDATE meter m JOIN building b ON b.name='一期 A座'
SET m.building_id=b.id, m.ownership='share'
WHERE m.kind='elec' AND m.zone='p1' AND m.name IN ('招商中心电1','招商中心电2');

-- ── 5) 导入新档挂栋(dev 导入建档 building_id NULL;逐条依据=抄表册段落行号) ──
-- p1 A座:幸悦电1(S57)/黄路生电(S65)/沈振电(S66)/周应佳电(S69)/林观平620电(S83) 均在 S92 范围内
UPDATE meter m JOIN building b ON b.name='一期 A座' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p1' AND m.building_id IS NULL
  AND m.name IN ('幸悦电1','黄路生电','沈振电','周应佳电','林观平620电');
-- p1 C座:李卓伦电(S130,本月0度,含于 S147 范围)
UPDATE meter m JOIN building b ON b.name='一期 C座' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p1' AND m.building_id IS NULL AND m.name='李卓伦电';
-- p1 D座:邱彩云东侧公共电(S151,0度)
UPDATE meter m JOIN building b ON b.name='一期 D座' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p1' AND m.building_id IS NULL AND m.name='邱彩云东侧公共电';
-- p1 E座:光伏工程(S172,0度)
UPDATE meter m JOIN building b ON b.name='一期 E座' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p1' AND m.building_id IS NULL AND m.name='光伏工程';
-- p1 F座:F401电2(S205,0度);EF充电车棚(S195,220度,S212=SUM(S194:S211) 含之,ops→share 计入D)
UPDATE meter m JOIN building b ON b.name='一期 F座' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p1' AND m.building_id IS NULL AND m.name='F401电2';
UPDATE meter m JOIN building b ON b.name='一期 F座' SET m.building_id=b.id, m.ownership='share'
WHERE m.kind='elec' AND m.zone='p1' AND m.name='EF充电车棚'
  AND (m.building_id IS NULL OR m.ownership<>'share');
-- p2 一车间:园区消防水稳压泵(S9,3.6度,S26=SUM(S7:S25) 含之);黎镇源临电(S23,0度)
UPDATE meter m JOIN building b ON b.name='二期 一车间' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p2' AND m.building_id IS NULL
  AND m.name IN ('园区消防水稳压泵','黎镇源临电');
-- p2 二车间:佳亿兴电(S30)/广聚运通电(S31)/欧伟杰临电(S36),均0度,S39 范围内
UPDATE meter m JOIN building b ON b.name='二期 二车间' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p2' AND m.building_id IS NULL
  AND m.name IN ('佳亿兴电','广聚运通电','欧伟杰临电');
-- p2 三车间:园区生活水泵、消防控制室(S43,2417.4度,S56 范围内);永龙反向有功(S51 无名行=永龙反向有功电能Σ15527,import 后挂栋)
UPDATE meter m JOIN building b ON b.name='二期 三车间' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p2' AND m.building_id IS NULL
  AND m.name IN ('园区生活水泵、消防控制室','永龙反向有功');
-- p2 四车间:园区绿化水泵(S60,103.8度,ops→share);广联临电(S61,0度)
UPDATE meter m JOIN building b ON b.name='二期 四车间' SET m.building_id=b.id, m.ownership='share'
WHERE m.kind='elec' AND m.zone='p2' AND m.name='园区绿化水泵'
  AND (m.building_id IS NULL OR m.ownership<>'share');
UPDATE meter m JOIN building b ON b.name='二期 四车间' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p2' AND m.building_id IS NULL AND m.name='广联临电';
-- p2 五车间:园区保安亭路灯(S71,777.4度);园区充电桩(S72,2152.4度,ops→share);S84 均含之
UPDATE meter m JOIN building b ON b.name='二期 五车间' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p2' AND m.building_id IS NULL AND m.name='园区保安亭路灯';
UPDATE meter m JOIN building b ON b.name='二期 五车间' SET m.building_id=b.id, m.ownership='share'
WHERE m.kind='elec' AND m.zone='p2' AND m.name='园区充电桩'
  AND (m.building_id IS NULL OR m.ownership<>'share');
-- p2 钢构车间:陈书谨电(S102,不在六车间 S101=SUM(S86:S100) 范围)
UPDATE meter m JOIN building b ON b.name='二期 钢构车间' SET m.building_id=b.id
WHERE m.kind='elec' AND m.zone='p2' AND m.building_id IS NULL AND m.name='陈书谨电';
