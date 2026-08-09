-- ════════════════════════════════════════════════════════════════════════════
-- 2024-02 租户/合同数据修缮总刀   (v2 草稿 2026-08-09,**未执行**,待主会话审核)
--
-- v2 按用户拍板重写:力灏(tid 48)从「模拟合同」升级为「真实合同补录」,其余 24 户维持模拟。
-- 合并并取代:feb2024-four-tenants-20260809.sql
-- 源册: 一期2024年2月水电费.xlsx(一期各段,下称 zh 表=「一期租户分摊公共用电金额」)
--       二期2024年2月水电费.xlsx(力灏容量费取证,sheet「力灏」)
--
-- 六段:
--   §1A  10 户 / 12 份「非草稿但缺日期」→ 模拟合同 2023-01-01 ~ 2024-02-29(remark 合同模拟)
--        §1A-2 火炬园合同135 只缺止租日,单列(⚠台账证明仍在租,见段内警告)
--   §1LH 力灏(tid 48)合同192 → **真实合同补录**(纸质合同,起止推定 2023-01-01~2025-12-31)
--        计费行 6 条**库里已全等,不再 INSERT**;补挂单元 368(首层101室);容量费按源册 22.6 不建例外
--   §1B  12 户「无任何合同」→ 新建不带计费行的模拟合同
--   §2   张执盛(伪档 390)并入博浩(162):水表改挂 + 别名 + 删伪档与其 0.00 空单
--   §3   周应佳:新建档案 + 合同 + 挂表 1424(2024-03 起自动消失)
--   §4   优硕达(163):补 2024-01-01 ~ 2025-12-31 + §4-B 四条计费行(对账口径 2,204.28,已拍板)
--   §5   黄路生(392):合同460 draft→active + 补日期(已拍板保留)
--
-- ⚠ 执行前置:先 mysqldump 备份(先例 backup-before-s7-alloc-20260808.sql)。
-- ⚠ 执行后重生成 2024-02:POST /api/bill-notices/generate?ym=2024-02
--    重生成前**必须**先导出基线:
--      SELECT tenant_id, notice_kind, total_amount FROM bill_notice WHERE ym='2024-02' ORDER BY 1,2;
--    期望公式见文末 §期望值总表。**不是「只增不改」**——见 §重生成对账 R1/R2。
--
-- ── 力灏容量费取证(2026-08-09,二期2024年2月水电费.xlsx sheet「力灏」)──────────
--   R5 原格逐录:D5='基本用电费' | I5='400千伏安' | J5=22.6 | K5=9040
--   → 源册按 **22.6 元/kVA 实收 9,040.00**,不是纸约的 23 元/kVA(23×400=9,200)。
--   拍板:**不建 tenant:48 capacity_fee 户级例外**(可莱恩 tenant:107=23 的先例不适用),
--   纸约 23 与实收 22.6 不一致仅记录在 remark 与本注释,待向物业核实是否历史调价。
--   同 sheet 佐证:R16 路灯公摊 14105.63×0.005=70.53、R22 绿化水公摊 14105.63×0.008=112.85
--   (与引擎二期园区级 area 池口径逐格全等)。
-- ════════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- ══════════════════════════════════════════════════════════════════════════
-- §0 前置断言(任一不成立就别往下跑)
--    期望依次:25 / 12 / 1 / 6 / 2 / 0 / 0 / 12 / 1 / 0 / 2 / 0 / 1 / 1 / 1 / 289 / 3558407.47 / 5|5|469.75|313.64
--    (2026-08-09 已对现库逐条实测通过)
-- ══════════════════════════════════════════════════════════════════════════
SELECT '断言01 2024-02 有单但无在租合同的户数(期望 25)' k, COUNT(DISTINCT n.tenant_id) v
  FROM bill_notice n WHERE n.ym='2024-02'
   AND NOT EXISTS (SELECT 1 FROM contract c WHERE c.tenant_id=n.tenant_id AND c.status<>'draft'
        AND c.start_date IS NOT NULL AND c.end_date IS NOT NULL
        AND c.start_date<='2024-02-29' AND c.end_date>='2024-02-01')
UNION ALL SELECT '断言02 §1A 12 份合同起止全空(期望 12;力灏192 已移出本批)',
       COUNT(*) FROM contract
       WHERE id IN (8,32,113,114,116,134,165,207,219,236,240,278)
         AND status<>'draft' AND start_date IS NULL AND end_date IS NULL
UNION ALL SELECT '断言03 力灏合同192 缺日期、kva=400、面积 14105.63、building 34 二期五车间(期望 1)',
       COUNT(*) FROM contract WHERE id=192 AND tenant_id=48 AND status='active'
         AND start_date IS NULL AND end_date IS NULL AND kva=400.00
         AND rent_area=14105.63 AND building_id=34
UNION ALL SELECT '断言04 力灏 6 条计费行已在库且与纸约逐格全等(期望 6,**不再 INSERT**)',
       COUNT(*) FROM contract_billing_term WHERE contract_id=192 AND (
            (fee_key='rent_factory' AND unit_price=16.9200 AND area=14105.63)
         OR (fee_key='mgmt'         AND unit_price=5.8300  AND area=14105.63)
         OR (fee_key='infra'        AND unit_price=1.9300  AND area=14105.63)
         OR (fee_key='elevator'     AND amount_override=1605.00)
         OR (fee_key='transformer'  AND amount_override=428.00)
         OR (fee_key='land_tax'     AND unit_price=0.8000  AND area=14105.63))
UNION ALL SELECT '断言05 力灏合同192 只挂 556(2F-201)/557(3F-301),368(1F-101)未挂(期望 2)',
       COUNT(*) FROM contract_unit WHERE contract_id=192 AND unit_id IN (368,556,557)
UNION ALL SELECT '断言06 tenant:48 无 capacity_fee 户级例外(期望 0;拍板不建)',
       COUNT(*) FROM tenant_price_cfg WHERE scope='tenant:48' AND cfg_key='capacity_fee'
UNION ALL SELECT '断言07 火炬园合同135 有起租日 2023-05-01、缺止租日(期望 1... 见下)',
       COUNT(*) FROM contract WHERE id=135 AND kind='master_lease'
         AND start_date='2023-05-01' AND end_date IS NULL
UNION ALL SELECT '断言08 §1B 12 户当前无任何合同(期望 12)',
       COUNT(*) FROM tenant t WHERE t.id IN (260,379,380,381,382,383,384,385,386,387,388,389)
         AND NOT EXISTS(SELECT 1 FROM contract c WHERE c.tenant_id=t.id)
UNION ALL SELECT '断言09 张执盛伪档 390 在、parent=162、无合同(期望 1)',
       COUNT(*) FROM tenant WHERE id=390 AND company_name='张执盛' AND parent_id=162
         AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=390)
UNION ALL SELECT '断言10 无任何档案挂在 390 名下(期望 0)',
       COUNT(*) FROM tenant WHERE parent_id=390
UNION ALL SELECT '断言11 两只水表 498/499 挂在伪档 390(期望 2)',
       COUNT(*) FROM meter WHERE id IN (498,499) AND tenant_id=390
UNION ALL SELECT '断言12 周应佳档案尚不存在(期望 0)',
       COUNT(*) FROM tenant WHERE company_name='周应佳'
UNION ALL SELECT '断言13 周应佳电表 1424 未挂户且 2024-03 退场(期望 1)',
       COUNT(*) FROM meter WHERE id=1424 AND tenant_id IS NULL
         AND removed_ym='2024-03' AND retired_ym='2024-03'
UNION ALL SELECT '断言14 优硕达合同30 缺日期、kva=10、面积 91.43、计费行仅 1 条(期望 1)',
       COUNT(*) FROM contract c WHERE c.id=30 AND c.tenant_id=163
         AND c.start_date IS NULL AND c.end_date IS NULL AND c.kva=10.00 AND c.rent_area=91.43
         AND 1=(SELECT COUNT(*) FROM contract_billing_term WHERE contract_id=30)
UNION ALL SELECT '断言15 黄路生合同460 是 draft 且起止全空(期望 1)',
       COUNT(*) FROM contract WHERE id=460 AND tenant_id=392 AND status='draft'
         AND start_date IS NULL AND end_date IS NULL
UNION ALL SELECT '断言16 基线单数(期望 289)', COUNT(*) FROM bill_notice WHERE ym='2024-02'
UNION ALL SELECT '断言17 基线总额(期望 3558407.47)',
       ROUND(SUM(total_amount),2) FROM bill_notice WHERE ym='2024-02';
-- 断言18 包干口径已入库(重生成会一并生效,期望值必须算它):电 5 行Σ469.75 / 水 5 行Σ313.64
SELECT '断言18 包干 cfg(期望 5|5|469.75|313.64)' k,
       SUM(cfg_key='share_elec_fixed') e_cnt, SUM(cfg_key='share_water_fixed') w_cnt,
       ROUND(SUM(CASE WHEN cfg_key='share_elec_fixed'  THEN cfg_value END),2) e_sum,
       ROUND(SUM(CASE WHEN cfg_key='share_water_fixed' THEN cfg_value END),2) w_sum
  FROM tenant_price_cfg WHERE cfg_key IN ('share_elec_fixed','share_water_fixed');

START TRANSACTION;

-- ══════════════════════════════════════════════════════════════════════════
-- §1A  10 户 / 12 份「非草稿但起止日期全空」的合同 → 模拟 2023-01-01 ~ 2024-02-29
-- ──────────────────────────────────────────────────────────────────────────
-- 拍板:其余 24 户模拟合同,时间覆盖 2024-02 即可。判据同 ContractService.inForceOn。
-- 逐户影响(重生成后 2024-02 新增额,公式=引擎实现):
--   14  中科华贸  +1,589.70 ⚠ 用户已知情放行,单列对账
--       = 租金 1,024.70(基础设施 320×1.96=627.20 / 变压器 159.00 / 电梯 238.50;
--         rent_factory 与 mgmt 两行缺面积单价 → 引擎判「待录」跳行并落 warn)
--       + 容量费 25 kVA × 22.60 = 565.00 (分摊面积=0 → 不进任何 area 池)
--   其余 9 户   +0.00 (rent_area=0 且无计费行 → 面积 0;kva 空 → 无容量费)
UPDATE contract SET
    start_date = '2023-01-01',
    end_date   = '2024-02-29',
    term_type  = COALESCE(term_type,'explicit'),
    term_text  = LEFT(CONCAT(COALESCE(term_text,''),
                 CASE WHEN term_text IS NULL OR term_text='' THEN '' ELSE ' | ' END,
                 '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)'), 255),
    remark     = LEFT(CONCAT(COALESCE(remark,''),
                 CASE WHEN remark IS NULL OR remark='' THEN '' ELSE ' | ' END,
                 '合同模拟(2026-08-09 补:2024-02 有单无在租合同,补 2023-01~2024-02 模拟区间,起止均非纸约)'), 255)
  WHERE id IN (8,32,113,114,116,134,165,207,219,236,240,278)
    AND status<>'draft' AND start_date IS NULL AND end_date IS NULL;
-- 明细:  8/134=雷莱   32/113=优嘉蓓  114=南盛物流  116=暨南医美  165=许旭锐
--       207=蚁润发   219=中科华贸 ⚠ 236=苏海苗   240=侯炳成   278=万众
--       (力灏 192 已移出本批 → §1LH 真实合同补录)

-- §1A-2  火炬创新创业园(tid 1)合同135:整租(master_lease),只缺止租日。
-- ⚠⚠⚠ 强烈提示:该户台账 2024-10~2025-10 共 11 期、实收 7,644,104.25 —— 确凿仍在租。
--      截到 2024-02-29 会让整租链在 2024-03 起断掉。金额影响 2024-02 = 0.00
--      (master_lease 不派生租金不收容量费,楼栋15 无 zone 不进名册)。
--      按「模拟合同覆盖 2024-02 即可」拍板照做,但建议单独拍板是否跳过本段。
UPDATE contract SET
    end_date  = '2024-02-29',
    term_text = LEFT(CONCAT(COALESCE(term_text,''),
                CASE WHEN term_text IS NULL OR term_text='' THEN '' ELSE ' | ' END,
                '合同模拟:止租日 2024-02-29 为模拟值(原为空)'), 255),
    remark    = LEFT(CONCAT(COALESCE(remark,''),
                ' | 合同模拟(2026-08-09 补止租日;⚠台账 2024-10~2025-10 显示仍在租,本值与证据冲突)'), 255)
  WHERE id=135 AND kind='master_lease' AND end_date IS NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- §1LH 力灏(tid 48)合同192 —— **真实合同补录**(非模拟)
-- ──────────────────────────────────────────────────────────────────────────
-- 纸质合同(用户逐格提供):
--   位置「二期五号楼首层101室、二楼201室、三楼301室」
--   → 楼栋核实:力灏名下唯一电表 64「力灏电」code 211031000141 挂 building 34「二期 五车间」,
--     合同192.building_id=34 已一致 →「二期五号楼」=「二期 五车间」,**不造新楼栋**。
--   计费行(首年至第三年档,合计 361,444.45):
--     厂房租金        14105.63 × 16.92 = 238,667.26
--     企业管理服务费   14105.63 × 5.83  =  82,235.82
--     厂房基础设施维护费 14105.63 × 1.93 =  27,223.87
--     电梯维护费       per_month 1,605.00
--     变压器维护费     per_month   428.00
--     土地使用税、房产税 14105.63 × 0.80 =  11,284.50
--   kva=400(库里已有,断言03 核过);租期九年自验收日起,验收日未知。
-- 库中现状(断言03/04/05):日期 NULL;**6 条计费行已在库(source=import)且与纸约逐格全等**
--   → 计费行一条不动;单元只挂 556(2F-201)/557(3F-301),缺 368(1F-101)。
-- 术语字段:term_type='relative'、term_text=纸约九年条款原文,均已在库,保留不动。
UPDATE contract SET
    start_date = '2023-01-01',   -- 推定:覆盖 2024-02 的推定区间下界(验收日待核)
    end_date   = '2025-12-31',   -- 推定:台账实收至 2025-10,上界取 2025-12-31
    remark     = LEFT(CONCAT(
                 '真实合同补录(2026-08-09):起止为推定,验收日待核;',
                 '第四~六年档(262,533.99/90,459.40/29,946.26)未录,换档时间待验收日确定;',
                 '纸约容量费 23 元/kVA 与 2024-02 源册实收 22.6(400×22.6=9,040,力灏!J5/K5)不一致,',
                 '按实收口径不建户级例外,待向物业核实'), 255)
  WHERE id=192 AND tenant_id=48 AND start_date IS NULL AND end_date IS NULL;

-- 补挂首层101室(纸约位置三室,库里缺 1F;源册佐证:力灏 sheet 消防用电「每层114.13,共3层」
-- =1F/2F/3F 三层,电梯「每层217.33,共2层」=2F/3F —— 首层在消防名册里)。
-- ⚠ 会改变 rule 14(消防)/16(电梯) 的楼层桶归属,见 §重生成对账 R2。主会话若否决,删本条即可。
INSERT INTO contract_unit (contract_id, unit_id)
SELECT 192, 368 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM contract_unit WHERE contract_id=192 AND unit_id=368);

-- 容量费:**不加 tenant:48 例外**(取证结论 22.6,见文件头「力灏容量费取证」)。
-- 全局价 capacity_fee=22.60 直接生效:400 × 22.60 = 9,040.00,与源册 K5=9040 全等。

-- ══════════════════════════════════════════════════════════════════════════
-- §1B  12 户「无任何合同」→ 新建模拟合同(宿舍散户 / 工程队 / 物业自用 / 待完善档案)
-- ──────────────────────────────────────────────────────────────────────────
-- building_id 取该户户内表所在楼栋(多栋取表数最多的一栋);
-- rent_area 一律留 0.00(NOT NULL DEFAULT 0.00,不可为 NULL)、**不建任何计费行**
--   → AllocService.allocArea 得 0 → 所有 area 池按「无租赁面积」跳过
--   → 12 户 2024-02 **新增合计 0.00**,只补上「在租」这个事实,不动一分钱。
-- ⚠ 不要顺手给它们填面积:填了就会进 宿舍区·路灯(0.06)与 宿舍区·绿化水(0.02)两个
--   园区级 area 池,凭空多收。真要收,先拿到房间面积依据再单开一刀。
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit,
                      start_date, end_date, status, kind, link_type, term_type, term_text, remark)
VALUES
 ('SIM-2402-260', 260, 26, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)',
  '合同模拟:2024-02 有单无合同,补模拟区间让其进当月在租名册;楼栋取户内表主栋(宿舍一栋,另有 2 只在宿舍四栋);面积留空不参与分摊'),
 ('SIM-2402-379', 379, 26, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)',
  '合同模拟:同上;⚠本户 parent_id=16(陈曼娜),建合同后家族在租合同 1→2,表→合同归属改走楼栋对位,重生成后核对绑定'),
 ('SIM-2402-380', 380, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上'),
 ('SIM-2402-381', 381, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上'),
 ('SIM-2402-382', 382, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上(账外户 offbook=1)'),
 ('SIM-2402-383', 383, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上'),
 ('SIM-2402-384', 384, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上'),
 ('SIM-2402-385', 385, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上(工程队,offbook=1)'),
 ('SIM-2402-386', 386, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上(宿舍二栋商铺4104,正名待核)'),
 ('SIM-2402-387', 387, 26, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上(物业自用 1-202/1-302/1-402)'),
 ('SIM-2402-388', 388, 29, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上(4-235 工程队朱锐,offbook=1)'),
 ('SIM-2402-389', 389, 21, 0.00, 0.00, 0.00, '2023-01-01','2024-02-29','active','normal','new','explicit',
  '合同模拟 2023-01-01~2024-02-29(推定区间,非纸约)', '合同模拟:同上(一期C座401,仅一只水表)');

-- ══════════════════════════════════════════════════════════════════════════
-- §2 张执盛(伪档 390)并入博浩(162)——**不建合同**,他不是一个租户
-- ──────────────────────────────────────────────────────────────────────────
-- 证据链:
--   ① sheet「博浩」= 2024-02 缴费通知单,抬头「佛山市博浩生物科技有限公司」、位置「一期F座四楼401室」,
--      单内每条电费行的表名却是「张执盛电表1/2」,公摊行叫「张执盛公共」。
--   ② zh 表 R82「张执盛公共 | F座 | 四楼401室 | 面积 3200 | F 14.71 | H 202.69」
--      —— 面积 3200 与库中博浩合同 334(building 24 F座, rent_area 3200, kva 625)全等,
--      F/H 两数与「博浩」sheet 第 50/51 行逐格全等。
--   ③ 水费总表 R99「张执盛 | F座四楼401室 | 绿化水公摊 28.8」= 博浩 sheet 第 58 行 28.8。
--   ④ 电表 385/386(名「张执盛电表1/2」)早已挂 tid 162,只有两只水表 498/499 掉在伪档上;
--      且 tenant 390.parent_id 已经是 162 —— 库里本就当它是博浩的子档。
--   → 与「李富全=鑫皇老板」「欧培仪=雷莱」同一模式:worksheet 用老板名。
UPDATE tenant SET aliases = TRIM(BOTH ',' FROM CONCAT(COALESCE(aliases,''),
       CASE WHEN aliases IS NULL OR aliases='' THEN '' ELSE ',' END, '张执盛,张执盛东侧,张执盛西侧'))
  WHERE id=162 AND (aliases IS NULL OR aliases NOT LIKE '%张执盛%');
UPDATE meter SET tenant_id=162, tenant_name='博浩' WHERE id IN (498,499) AND tenant_id=390;
-- 其余可能挂在 390 上的引用一并迁移(断言10/11 实测均为 0 行,防御性保留)
UPDATE monthly_ledger    SET tenant_id=162 WHERE tenant_id=390;
UPDATE s10_record        SET tenant_id=162 WHERE tenant_id=390;
UPDATE alloc_rule_member SET tenant_id=162 WHERE tenant_id=390;
UPDATE tenant            SET parent_id=162 WHERE parent_id=390;   -- 实测 0 行(断言10),守卫子档
DELETE FROM bill_pay_company  WHERE tenant_id=390;                -- 实测 0 行
DELETE FROM tenant_price_cfg  WHERE scope='tenant:390';           -- 实测 0 行
DELETE FROM bill_notice       WHERE tenant_id=390;                -- 那张 0.00 空单;行由 FK CASCADE 连删
-- 子档守卫不写成 NOT EXISTS(SELECT ... FROM tenant):MySQL 1093 不许 DELETE 的子查询引用同一张表。
-- 上面那条 UPDATE tenant SET parent_id=162 WHERE parent_id=390 已经把子档(实测 0 行)搬走,
-- 加上 §0 断言10 兜底,足够。
DELETE FROM tenant WHERE id=390
  AND NOT EXISTS(SELECT 1 FROM contract       WHERE tenant_id=390)
  AND NOT EXISTS(SELECT 1 FROM meter          WHERE tenant_id=390)
  AND NOT EXISTS(SELECT 1 FROM monthly_ledger WHERE tenant_id=390);

-- ══════════════════════════════════════════════════════════════════════════
-- §3 周应佳——新建档案 + 合同 + 挂表;2024-03 起自动消失
-- ──────────────────────────────────────────────────────────────────────────
-- 源册证据:
--   zh 表 R33「周应佳公共 | A座 | 四楼428、435室 | 面积 158.66 | F 11.11 | H 12.69」→ 分摊应收 23.80
--   一期园区电 R68:电表 220605000033,倍率 60,上 15.83 → 下 16.82 → 用量 (16.82−15.83)×60 = 59.4 度
--   一期园区水 R45:「东佛水 A座 四楼428、435室 周应佳 水表①」上=下=16 → 用量 0(库中无此表,不建)
--   电费/水费总表 无「周应佳」行(该户只在抄表册+分摊册,未进户侧实收表)
-- 库中现状:meter 1424 = 'A座-四楼428室-电表①' code 220605000033,tenant_id 空,
--   retired_ym=removed_ym='2024-03' → 挂户后 2024-02 出行,2024-03 起 MeterService.outOfService 自动挡掉。
-- ⚠ tenant.business_type NOT NULL 且无 DEFAULT,STRICT_TRANS_TABLES 下漏列报 1364,必须给值。
INSERT INTO tenant (company_name, business_type, status, offbook, phase, remark)
VALUES ('周应佳', '配套服务', 2, 0, 1,       -- status=2 停用(2024-03 起退租);phase tinyint:1=一期
        '2026-08-09 补建:2024-02 在租(A座四楼428、435室,面积158.66),2024-03 起退租。'
        '来源=一期2024年2月水电费.xlsx「一期租户分摊公共用电金额」R33 +「一期园区电」R68');
SET @tid_zyj = LAST_INSERT_ID();

INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit,
                      start_date, end_date, status, kind, link_type, term_type, term_text, remark)
VALUES ('HIST-ZYJ-01', @tid_zyj, 13, 158.66, 0.00, 0.00,
        '2023-10-01',    -- 推定值:取 meter 1424 最早读数月(2023-10)作起点,待核
        '2024-02-29',    -- 硬证据侧:meter 1424 removed_ym='2024-03'
        'active', 'normal', 'new', 'explicit',
        '推定 2023-10-01 至 2024-02-29(起点=最早抄表月;止点=电表 2024-03 退场)',
        '合同模拟 | 2026-08-09 补建。租金要素源册无载(不在电费/水费总表,也无纸质通知单),'
        '故不建计费行——只让他成为「2024-02 的在租户」,水电按表派生');
SET @cid_zyj = LAST_INSERT_ID();

-- 挂表:1424 → 周应佳(仅此一只;水表源册用量 0 且库中无对应记录,不建)
UPDATE meter SET tenant_id=@tid_zyj, tenant_name='周应佳', contract_id=@cid_zyj
  WHERE id=1424 AND tenant_id IS NULL;

-- 收款方映射:户内电费→一泽(4),电维护费→创燊高(6)。口径抄自同册 优硕达/博浩 两张纸质通知单落款
INSERT INTO bill_pay_company (tenant_id, fee_key, company_id) VALUES
  (@tid_zyj,'elecStd',4), (@tid_zyj,'elecMaint',6)
  ON DUPLICATE KEY UPDATE company_id=VALUES(company_id);

-- ══════════════════════════════════════════════════════════════════════════
-- §4 优硕达(tid 163)——补 2024-01-01 ~ 2025-12-31(拍板;对账口径 2,204.28)
-- ──────────────────────────────────────────────────────────────────────────
-- **不能截到 2024-02**:monthly_ledger 有 2024-10 与 2025-01~2025-07 共 20 行
--   (租金 1015.99/月、管理 457.15、基础设施 182.86、电梯 159、变压器 159、基本电费 226 逐月)
--   → 至少在租到 2025-07。两端均为推定:下界须 ≤2024-02(源册当月在租),上界须 ≥2025-07(台账末月)。
-- 源册证据(sheet「优硕达」= 两张 2024-02 纸质通知单,合计 249.84):
--   一泽单 228.88 = 基本用电费 226(10 kVA × 22.6) + 水费 2.88
--   创燊高单 20.96 = 电维护费 19.78(楼层公共 3.34 + 电梯 12.48 + 线路损耗 0.30 + 路灯公摊 3.66)
--                  + 水维护费 1.18(0.18+0.18+绿化水公摊 0.82)
--   面积 91.43㎡,一期C座202室 —— 与合同30(building 21, unit 432=2F-202, rent_area 91.43, kva 10)全等。
--   zh 表 R55 登记在老板名「张勇」名下(面积/F/H 与纸单全等)→ 补别名。
UPDATE tenant SET aliases = TRIM(BOTH ',' FROM CONCAT(COALESCE(aliases,''),
       CASE WHEN aliases IS NULL OR aliases='' THEN '' ELSE ',' END, '张勇,佛山市优硕达自动化有限公司'))
  WHERE id=163 AND (aliases IS NULL OR aliases NOT LIKE '%张勇%');
UPDATE contract SET
    start_date = '2024-01-01',
    end_date   = '2025-12-31',
    term_type  = COALESCE(term_type,'explicit'),
    term_text  = '推定 2024-01-01 至 2025-12-31(下界=2024-02 源册在租,上界=台账末月 2025-07),两端均待核',
    remark     = LEFT(CONCAT(COALESCE(remark,''),
                 CASE WHEN remark IS NULL OR remark='' THEN '' ELSE ' | ' END,
                 '合同模拟 | 2026-08-09 补日期:据 一期2024年2月水电费.xlsx sheet「优硕达」两张纸单'
                 '(一泽 228.88 + 创燊高 20.96);起止均为推定值,须向物业核实真实租期'), 255)
  WHERE id=30 AND tenant_id=163 AND start_date IS NULL;

-- ── §4-B 补 4 条计费行(拍板保留,对账口径 2,204.28)────────────────────────
-- 2,204.28 = 租金 1015.79(91.43×11.11) + 管理 457.15 + 基础设施 182.86 + 电梯 159
--          + 变压器 159 + 容量 226(10×22.60) + 路灯 3.66 + 绿化水 0.82。
-- 库里只有 rent_factory 一条(断言14),这 4 条的依据是 **2025 台账逐月同额**
-- (monthly_ledger 2025-01~2025-05 每月 457.15/182.86/159/159),不是 2024-02 纸单。
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, amount_override, seq, source, note)
VALUES
 (30,'一期C座202室','factory','mgmt',       '厂房企业管理服务费','per_sqm_month', 5.0000, 91.43, NULL, 1,'manual','依据=台账 2025-01~05 逐月 457.15(91.43×5.00);2024-02 纸单无此项,推定回填'),
 (30,'一期C座202室','factory','infra',      '厂房基础设施维护费','per_sqm_month', 2.0000, 91.43, NULL, 2,'manual','依据=台账 2025-01~05 逐月 182.86(91.43×2.00);同上'),
 (30,'一期C座202室','factory','elevator',   '电梯维护费',       'per_month',     0.0000, NULL, 159.00, 3,'manual','依据=台账 2025-01~05 逐月 159.00;同上'),
 (30,'一期C座202室','factory','transformer','变压器维护费',     'per_month',     0.0000, NULL, 159.00, 4,'manual','依据=台账 2025-01~05 逐月 159.00;同上');
-- ⚠ 这 4 条不改分摊面积:AllocService 的分摊面积只认 BUILDING_RENT_KEYS
--   (rent_factory/office/dorm/shop),mgmt/infra/elevator/transformer 不入 → 面积仍 91.43,
--   路灯 3.66 / 绿化水 0.82 不变。
-- ⚠ contract.monthly_rent / rent_area 是 syncScalarCache 缓存列,直写 SQL 不会同步。
--   本刀不改缓存列(分摊/派生都不读它);要屏上数字一致,执行后在合同详情页保存一次即可。

-- ══════════════════════════════════════════════════════════════════════════
-- §5 黄路生(tid 392)——合同460 draft→active + 补日期(拍板保留)
-- ──────────────────────────────────────────────────────────────────────────
-- 注:黄路生 **不在 §1 那 25 户里**(他 2024-02 根本没出单),是「新增一张单」不是「补一张单」。
-- 源册证据:
--   zh 表 R28「黄路生公共 | A座 | 四楼420室 | 面积 330.28 | F 楼层公共 23.12 | H 电梯 26.42
--            | I 孵化协议固定收取 100 | J 盈亏 50.46」→ J = 100 − (23.12+26.42) = 50.46 全等。
--   一期园区电 R64:电表 220605000146(库中 meter 239)2024-02 上=下=9625.40 → 用量 0;
--   电费/水费总表均无「黄路生」行 → 当月户内电费/水费皆 0。
--   meter 239 已改名「暨南医美电」并改挂 tid 172(后手接 420 室)→ 本刀不给他派生任何水电行。
-- 补日期后新增(2024-02 新开一张单,合计 42.60):
--   一期 A座·天面·电梯(rule 40,area 0.08 元/㎡,显式受益人):0.08 × 330.28 = 26.42
--     ← 与源册 zh!H28 = 26.42 **逐格全等**,这是补日期正确性的硬校验点
--   一期园区·路灯(rule 25,area 0.04):13.21    一期园区·绿化水(rule 100,area 0.009):2.97
--   源册 F 楼层公共 23.12 派生不出来(他不是 A座四楼任何楼层池的显式受益人)——缺口另记。
--   100 元「孵化协议固定收取」不在本刀,归口 incubator-package-20260809.sql。
UPDATE contract SET
    status      = 'active',
    start_date  = '2023-01-01',   -- 推定值:取自 460.remark 的历史占位区间起点,待核
    end_date    = '2024-02-29',   -- 硬证据侧:2024-03 起 420 室由暨南医美接手,zh 表 3 月无此户
    building_id = 13,             -- 一期 A座
    rent_area   = 330.28,         -- zh 表 E 列(**这一步是 26.42 的来源,改了这个数电梯分摊就对不上**)
    term_type   = 'explicit',     -- 枚举只收 explicit|multiple|relative|none(ContractCreateReq @Pattern)
    term_text   = '推定 2023-01-01 至 2024-02-29(依 460.remark 占位区间 + 2024-03 暨南医美接手)',
    remark      = LEFT(CONCAT(COALESCE(remark,''),
                  ' | 合同模拟 2026-08-09 补日期:据 一期2024年2月水电费.xlsx zh 表 R28。'
                  '起租日推定待核;止租日 2024-02-29 有 2024-03 交接硬证。'), 255)
  WHERE id=460 AND tenant_id=392 AND start_date IS NULL;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- §验证段(逐条对期望值;v2 全部重写)
-- ══════════════════════════════════════════════════════════════════════════
SELECT '验01 §1A 12 份合同已补起止 2023-01-01~2024-02-29(期望 12)' k, COUNT(*) v FROM contract
 WHERE id IN (8,32,113,114,116,134,165,207,219,236,240,278)
   AND start_date='2023-01-01' AND end_date='2024-02-29'
UNION ALL SELECT '验02 火炬园合同135 止租日已补(期望 1)', COUNT(*) FROM contract
 WHERE id=135 AND end_date='2024-02-29'
UNION ALL SELECT '验03 力灏合同192 = 2023-01-01~2025-12-31、remark 含「真实合同补录」(期望 1)',
 COUNT(*) FROM contract WHERE id=192 AND start_date='2023-01-01' AND end_date='2025-12-31'
   AND remark LIKE '%真实合同补录%'
UNION ALL SELECT '验04 力灏合同192 挂满 3 个单元 368/556/557(期望 3)',
 COUNT(*) FROM contract_unit WHERE contract_id=192 AND unit_id IN (368,556,557)
UNION ALL SELECT '验05 力灏计费行仍是 6 条、一条未动(期望 6)',
 COUNT(*) FROM contract_billing_term WHERE contract_id=192
UNION ALL SELECT '验06 tenant:48 仍无 capacity_fee 例外(期望 0;按源册 22.6 走全局价)',
 COUNT(*) FROM tenant_price_cfg WHERE scope='tenant:48' AND cfg_key='capacity_fee'
UNION ALL SELECT '验07 §1B 12 份模拟合同已建(期望 12)', COUNT(*) FROM contract
 WHERE contract_no LIKE 'SIM-2402-%'
UNION ALL SELECT '验08 张执盛伪档已删(期望 0)', COUNT(*) FROM tenant WHERE id=390
UNION ALL SELECT '验09 水表 498/499 已归博浩(期望 2)', COUNT(*) FROM meter
 WHERE id IN (498,499) AND tenant_id=162
UNION ALL SELECT '验10 博浩别名含张执盛(期望 1)', COUNT(*) FROM tenant
 WHERE id=162 AND aliases LIKE '%张执盛%'
UNION ALL SELECT '验11 张执盛 0.00 空单已消(期望 0)', COUNT(*) FROM bill_notice
 WHERE ym='2024-02' AND tenant_id=390
UNION ALL SELECT '验12 周应佳 档案(期望 1)', COUNT(*) FROM tenant WHERE company_name='周应佳'
UNION ALL SELECT '验13 周应佳 合同覆盖 2024-02 且止于 2024-02-29(期望 1)', COUNT(*) FROM contract
 WHERE contract_no='HIST-ZYJ-01' AND start_date<='2024-02-29' AND end_date='2024-02-29'
UNION ALL SELECT '验14 周应佳 电表 1424 已挂户(期望 1)', COUNT(*) FROM meter
 WHERE id=1424 AND tenant_id IS NOT NULL
UNION ALL SELECT '验15 优硕达合同30 覆盖 2024-02(期望 1)', COUNT(*) FROM contract
 WHERE id=30 AND start_date<='2024-02-29' AND end_date>='2024-02-01'
UNION ALL SELECT '验16 优硕达合同30 仍覆盖 2025-07(期望 1,**不可为 0**)', COUNT(*) FROM contract
 WHERE id=30 AND start_date<='2025-07-31' AND end_date>='2025-07-01'
UNION ALL SELECT '验17 优硕达计费行 5 条(期望 5)', COUNT(*)
 FROM contract_billing_term WHERE contract_id=30
UNION ALL SELECT '验18 黄路生合同460 active 且覆盖 2024-02(期望 1)', COUNT(*) FROM contract
 WHERE id=460 AND status='active' AND start_date<='2024-02-29' AND end_date>='2024-02-01'
UNION ALL SELECT '验19 黄路生合同460 2024-03 已失效(期望 0)', COUNT(*) FROM contract
 WHERE id=460 AND start_date<='2024-03-31' AND end_date>='2024-03-01'
UNION ALL SELECT '验20 力灏合同192 仍覆盖 2025-10(台账末月,期望 1)', COUNT(*) FROM contract
 WHERE id=192 AND start_date<='2025-10-31' AND end_date>='2025-10-01';

-- 验21:2024-02「有单但当月无在租合同」的户数
--   本脚本全跑完 → 期望 **0**(25 户 = 24 户补/建合同 + 张执盛 1 户并档消单)。
SELECT '验21 无在租合同仍出单的户数(全跑完期望 0)' k,
       COUNT(DISTINCT n.tenant_id) v, ROUND(SUM(n.total_amount),2) amt
  FROM bill_notice n WHERE n.ym='2024-02'
   AND NOT EXISTS (SELECT 1 FROM contract c WHERE c.tenant_id=n.tenant_id AND c.status<>'draft'
        AND c.start_date IS NOT NULL AND c.end_date IS NOT NULL
        AND c.start_date<='2024-02-29' AND c.end_date>='2024-02-01');

-- ══════════════════════════════════════════════════════════════════════════
-- §期望值总表(执行本脚本 + POST /api/bill-notices/generate?ym=2024-02 之后)
-- ──────────────────────────────────────────────────────────────────────────
-- 引擎口径(已逐条读代码核对):
--   ① 租金 = Σ ContractService.lineMonthly(计费行);无计费行 → 0
--   ② 容量费 = kva × capacity_fee(全局 22.60);kva 空 → 无此行
--   ③ area 池 = 池 std × 该户分摊面积;面积 0/空 → AllocService.memberAmounts 跳过
--
--   项目                       金额          构成 / 依据
--   ─────────────────────── ────────────  ─────────────────────────────────────────
--   基线(2026-08-09 实测)   3,558,407.47  289 单(断言16/17)
--   + 力灏(tid 48)          + 370,879.41  真实合同生效:
--                                          租金 361,444.45
--                                            = 厂房 14105.63×16.92 = 238,667.26
--                                            + 管理 ×5.83          =  82,235.82
--                                            + 基础设施 ×1.93      =  27,223.87
--                                            + 电梯 1,605.00 + 变压器 428.00
--                                            + 土地税 ×0.80        =  11,284.50
--                                          容量费 400×22.60 = 9,040.00
--                                            (源册力灏!K5=9040 全等;**不是** 23×400=9,200)
--                                          二期园区级 area 池 394.96
--                                            = 消防设施 0.015×14105.63 = 211.58
--                                            + 绿化水泵 0.008× = 112.85(源册 K22 全等)
--                                            + 路灯 0.005× = 70.53(源册 K16 全等)
--                                            + 消防水稳压泵 0.00
--   + 中科华贸(tid 14)      +   1,589.70  租金 1,024.70 + 容量 25×22.60=565.00(单列,已放行)
--   + 优硕达(tid 163)       +   2,204.28  租金 1015.79+457.15+182.86+159+159
--                                          + 容量 226.00 + 路灯 3.66 + 绿化水 0.82
--   + 黄路生(tid 392)       +      42.60  电梯 26.42(zh!H28 全等) + 路灯 13.21 + 绿化水 2.97
--   + 周应佳(新档)          +     ~73.96  电 59.4 度×0.79416875(商业价)=47.17 + 电管理 59.4×0.32=19.01
--                                          + 路灯 0.04×158.66=6.35 + 绿化水 0.009×158.66=1.43
--                                          ⚠ 判定树若判居民价(0.63586875):电费 37.77,合计 64.56
--   + 包干净额               +     588.61  5 户 share_elec/water_fixed 新固定值Σ 783.39
--                                          (电 469.75 + 水 313.64,断言18)。口径(复核实测):
--                                          吞掉的原派生行Σ 217.97 + 损耗基数含包干额后的
--                                          损耗增量Σ 23.19(Δ基数×0.0616) → 783.39−217.97+23.19=588.61
--                                          ⚠ 损耗增量按五户同桶率 0.0616 估,实跑可能差几分,以重生成为准
--   − 张执盛(tid 390)       −       0.00  0.00 空单消失(总额不动,**单数 −1**)
--   §1A/§1B 其余 21 户      +       0.00  面积 0 无计费行 kva 空 → 引擎全跳过
--   ─────────────────────── ────────────
--   期望总额                ≈ 3,933,786.03  (周应佳按商业价 73.96)
--                           ≈ 3,933,776.63  (周应佳按居民价 64.56)
--   期望单数                = 289 − 1(张执盛) + 3(周应佳/黄路生/优硕达新单) = 291
--                            ± 力灏/中科华贸/优硕达租金行若拆独立 rent 单则再 +N,以实际为准
--
--   金额 > 1000 的三户 **力灏 370,879.41 / 中科华贸 1,589.70 / 优硕达 2,204.28** 都要人工过目。
--   残差解释责任:除上表外的逐单位移必须能被下面 R1/R2 解释,解释不了就回滚。
--
-- ══════════════════════════════════════════════════════════════════════════
-- §重生成对账(必读四条)
-- ──────────────────────────────────────────────────────────────────────────
-- R1 当前 2024-02 的单是**陈旧快照**,不改任何数据重生成也会变:
--    二期五车间 消防池(rule 14)/电梯池(rule 16)现存单里,力灏与蚁润发同在「未定层」桶各分
--    1/2(21.80/108.67)。今天库里蚁润发户内表已有楼层 → 重生成本来就会位移。
--    建议:先在**不改数据**的前提下重生成一次存「真基线」,再跑本脚本重生成,两次相减=本刀净效果。
-- R2 floor 池会**重分布**:力灏补日期+挂单元 368 后,楼层来源从「户内表(无楼层)」变成
--    合同单元 1F/2F/3F 三桶,且分摊面积 0→14,105.63,同桶其他户会被挤压。
--    源册期望(力灏 sheet):电梯「每层217.33,共2层」=434.66、消防「每层114.13,共3层」=342.39。
--    ⚠ 两锚点效力不同(复核实测):rule 16 电梯 std=217.33/层与源册同,434.66 可当硬锚;
--    rule 14 消防池 2024-02 全池 cost 仅 283.40(每层 43.60),力灏 3 层顶格 ≈130.80——
--    源册 342.39 是物业固定单价口径,引擎按池成本分摊**到不了**这个数。消防锚改为
--    「力灏落点向 ≤130.80 的层桶值收敛」,按 342.39 字面卡会误杀回滚。
--    要看的池:rule 14/16(五车间)、rule 2/3(一车间,中科华贸)、rule 10/11(四车间)、rule 50(B座货梯)。
--    (area 方法的池不会重分布:std×户面积逐户独立,base 取价目簿常数,不被名册稀释。)
-- R3 一期园区级 area 池已超收:p1 名册Σ 92,778.05 > base 80,000(路灯/绿化水),引擎反向防线
--    warning 本来就在报;本刀再加 黄路生 330.28 + 优硕达 91.43 + 周应佳 158.66 会更超。
--    (二期:名册Σ 103,875.19 + 力灏 14,105.63 仍 < base 148,918.01,安全。)
-- R4 表→合同归属可能翻面:§1B 建合同后「有表未归属」warn 消失(好事);温小蓉(379)家族根
--    陈曼娜(16)当月在租合同 1→2,走楼栋对位应各自落位,重生成后看绑定屏有无新 ambiguous。
--
-- ══════════════════════════════════════════════════════════════════════════
-- §与 v1 草稿的差异(供主会话 diff 审核)
-- ──────────────────────────────────────────────────────────────────────────
--  1. 力灏(192)从 §1A 批量移出 → 新增 §1LH:起止 2023-01-01~2025-12-31(不再截到 2 月),
--     remark 改「真实合同补录」措辞(含四~六年档未录、容量费纸约/实收不一致两条待核)。
--     §1A 批量从 13 份缩到 12 份,断言/验证同步改。
--  2. 计费行:纸约 6 条**已在库全等**(source=import,断言04)→ 不 INSERT,只断言。
--  3. 新增:补挂单元 368(首层101室),NOT EXISTS 守卫;源册消防「共3层」佐证。主会话可单独否决。
--  4. 容量费取证落案:源册按 22.6 实收 9,040 → 不建 tenant:48 例外(与可莱恩 23 例外先例相反方向)。
--  5. 优硕达 §4-B 从「可选」改「已拍板保留」,验证按 5 条计费行/2,204.28 固定。
--  6. 黄路生 §5 从「可整段注释」改「已拍板保留」。
--  7. 验证段全部重写(验01~验21),新增力灏 5 条专项(验03~06/验20)。
--  8. 期望值总表重算:含包干 +588.61(v1 漏算)与力灏真实合同口径,给出 291 单/两档总额。
--
-- ══════════════════════════════════════════════════════════════════════════
-- §回滚(未提交前直接 ROLLBACK;已提交则用备份恢复。以下仅作定位参考)
-- ──────────────────────────────────────────────────────────────────────────
-- DELETE FROM contract WHERE contract_no LIKE 'SIM-2402-%';
-- DELETE FROM contract WHERE contract_no='HIST-ZYJ-01';
-- DELETE FROM contract_billing_term WHERE contract_id=30 AND fee_key<>'rent_factory';
-- DELETE FROM contract_unit WHERE contract_id=192 AND unit_id=368;
-- UPDATE contract SET start_date=NULL, end_date=NULL
--   WHERE id IN (8,32,113,114,116,134,165,207,219,236,240,278,30,192);
-- UPDATE contract SET end_date=NULL WHERE id=135;
-- UPDATE contract SET status='draft', start_date=NULL, end_date=NULL, rent_area=0.00 WHERE id=460;
-- 张执盛并档不可逆(伪档已删)——必须靠备份。
