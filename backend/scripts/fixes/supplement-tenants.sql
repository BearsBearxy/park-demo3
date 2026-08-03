-- 补充租户总手术(2026-08-04,依据:补充租户.xlsx 表格+25张纸质合同截图逐张核对+用户口径拍板)
-- 覆盖:①别名/正名矫正与档案合并 ②9户合同补日期/拆链 ③14个新档 ④挂表(精确名+别名两轮通挂+点名单)
--      ⑤设施转park/ops+伪租户清理 ⑥恋玺污染清除 ⑦退租类电表停用(retired_ym=2024-03,2月数据保留)
-- 用户拍板要点:诺玲=诺铃/吴跃平=吴耀兰/易釆=罗立剑/锂鹏→锂朋/李李=佛山协作链供应链管理有限公司(李李各档作子租户);
--   复合名共用表(嘉荣、科文=101、102/广联、氙明/吴耀兰、宏玥)不单挂,口径入档案remark,导入提示见 applyDesc(同批代码);
--   帷幄/黄路生/周应佳/大为类=worksheet无+用量0=退租,电表停用不再显待核(停用UI本就在:编辑模式→表详情→停用账期)。
-- 锚点:力美两链Σ=2476.39(=原S10-0055)/龙为两链Σ=4458.74(=原S10-0253)/保奔路段1=3772/管中旺段1=4177.96(=各自原值)。
-- 前置备份:demo3/backup-before-supplement-20260804.sql
SET NAMES utf8mb4;
START TRANSACTION;

-- ══ 1. 别名/正名矫正与档案合并 ══
UPDATE tenant SET aliases='锂鹏' WHERE id=2 AND (aliases IS NULL OR aliases='');
UPDATE tenant SET aliases='诺玲' WHERE id=158 AND (aliases IS NULL OR aliases='');
UPDATE monthly_ledger SET tenant_id=158 WHERE tenant_id=306;
UPDATE s10_record SET tenant_id=158 WHERE tenant_id=306;
UPDATE alloc_rule_member SET tenant_id=158 WHERE tenant_id=306;
DELETE FROM tenant WHERE id=306 AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=306) AND NOT EXISTS(SELECT 1 FROM meter WHERE tenant_id=306) AND NOT EXISTS(SELECT 1 FROM monthly_ledger WHERE tenant_id=306);
-- 吴跃平(335)=吴耀兰(151)同一人:台账两行与151撞唯一键(同月同公司各一行),按家族子档归户,不合并台账
UPDATE tenant SET parent_id=151, remark=CONCAT(COALESCE(remark,''),' | 吴跃平=吴耀兰(用户拍板);台账行与主档并存按家族聚合归户') WHERE id=335;
UPDATE tenant SET aliases='易釆,易采,广东易釆生物科技有限公司' WHERE id=54 AND (aliases IS NULL OR aliases='');
UPDATE meter SET tenant_id=54 WHERE tenant_id=294;
UPDATE contract SET tenant_id=54 WHERE tenant_id=294;
UPDATE monthly_ledger SET tenant_id=54 WHERE tenant_id=294;
UPDATE s10_record SET tenant_id=54 WHERE tenant_id=294;
UPDATE alloc_rule_member SET tenant_id=54 WHERE tenant_id=294;
DELETE FROM tenant WHERE id=294 AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=294) AND NOT EXISTS(SELECT 1 FROM meter WHERE tenant_id=294) AND NOT EXISTS(SELECT 1 FROM monthly_ledger WHERE tenant_id=294);
-- 澜深:281(王培培/澜深)并入170,改全称;台账31行/4块王培培表随迁
UPDATE tenant SET company_name='佛山澜深生物科技有限公司', aliases='澜深,王培培,王培培/澜深' WHERE id=170;
UPDATE monthly_ledger SET tenant_id=170 WHERE tenant_id=281;
UPDATE meter SET tenant_id=170 WHERE tenant_id=281 OR id IN (355,356,484,485);
UPDATE contract SET tenant_id=170 WHERE tenant_id=281;
DELETE FROM tenant WHERE id=281 AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=281) AND NOT EXISTS(SELECT 1 FROM meter WHERE tenant_id=281) AND NOT EXISTS(SELECT 1 FROM monthly_ledger WHERE tenant_id=281);
-- 协作链:15 改全称,李李三档作子租户
UPDATE tenant SET company_name='佛山协作链供应链管理有限公司', aliases='协作链,李李' WHERE id=15;
UPDATE tenant SET parent_id=15 WHERE id IN (145,271,311);
-- 曼克维:305并入95(清单授权);C2024M-006改挂95并补日期;S10-0254(附表10派生副本)删除防双开
UPDATE tenant SET company_name='广东曼克维通信科技有限公司佛山分公司', aliases='曼克维,曼克维宿舍' WHERE id=95;
UPDATE contract SET tenant_id=95, start_date='2023-10-20', end_date='2024-10-19',
  term_type='explicit', term_text='2023年10月20日至2024年10月19日',
  remark=CONCAT(COALESCE(remark,''),' | 补充租户核对:通知单167.09+36.53㎡;2025-05已换房至四座447/451/534/545待新约') WHERE id=301;
UPDATE meter SET tenant_id=95 WHERE tenant_id=305;
DELETE FROM contract_billing_term WHERE contract_id=254;
DELETE FROM contract_unit WHERE contract_id=254;
DELETE FROM contract WHERE id=254;
UPDATE monthly_ledger SET tenant_id=95 WHERE tenant_id=305;
UPDATE s10_record SET tenant_id=95 WHERE tenant_id=305;
UPDATE alloc_rule_member SET tenant_id=95 WHERE tenant_id=305;
DELETE FROM tenant WHERE id=305 AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=305) AND NOT EXISTS(SELECT 1 FROM meter WHERE tenant_id=305) AND NOT EXISTS(SELECT 1 FROM monthly_ledger WHERE tenant_id=305);
-- 复合名共用表口径入档案remark(表本身不单挂,tenant_id留空护栏)
UPDATE tenant SET remark=CONCAT(COALESCE(remark,''),' | 共用电表36(嘉荣=10栋101/科文=102),账单按户拆待账单功能') WHERE id IN (375,376);
UPDATE tenant SET remark=CONCAT(COALESCE(remark,''),' | 共用电表49(四车间101-701,与氙明),账单按户拆待账单功能') WHERE id IN (28,29);
UPDATE tenant SET remark=CONCAT(COALESCE(remark,''),' | 共用水表411(A座203、216,与宏玥),账单按户拆待账单功能') WHERE id=151;

-- ══ 2. 合同补日期/拆链 ══
-- 力美 S10-0055 拆两链(锚:两链Σ=2476.39=原值)
UPDATE contract SET contract_no='S10-0055#A', building_id=29, rent_area=73.06, building_area=58.45, monthly_rent=1650.93,
  start_date='2023-03-16', end_date='2026-01-31', term_type='explicit', term_text='2023年03月16日至2026年01月31日',
  remark='补充租户核对:宿舍四栋444、446室 2间', unit_price=19.0000, infra_fee_price=2.0000,
  fee_src='{"area": "manual", "rent": "manual", "infra": "manual"}' WHERE id=55;
DELETE FROM contract_billing_term WHERE contract_id=55;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (55,'宿舍四栋444、446室','dorm','rent_dorm','宿舍租金','per_sqm_month',19.0000,73.06,1.0000,'manual',NULL,0),
  (55,'宿舍四栋444、446室','dorm','infra','宿舍基础设施维护费','per_sqm_month',2.0000,73.06,1.0000,'manual',NULL,1),
  (55,'宿舍四栋444、446室','dorm','access','门禁设施维护费','per_month',0.0000,NULL,1.0000,'manual',16.67,2),
  (55,'宿舍四栋444、446室','dorm','network','网络通讯费','per_month',0.0000,NULL,1.0000,'manual',100.00,3);
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,unit_price,infra_fee_price,fee_src,link_type,kind) VALUES
  ('S10-0055#B',105,29,NULL,36.53,825.46,0.00,'2024-02-01','2027-01-31','explicit','2024年02月01日至2027年01月31日','active','补充租户核对:宿舍四栋546室',29.22,19.0000,2.0000,'{"area": "manual", "rent": "manual", "infra": "manual"}','new','normal');
SET @lm_b=LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@lm_b,'宿舍四栋546室','dorm','rent_dorm','宿舍租金','per_sqm_month',19.0000,36.53,1.0000,'manual',NULL,0),
  (@lm_b,'宿舍四栋546室','dorm','infra','宿舍基础设施维护费','per_sqm_month',2.0000,36.53,1.0000,'manual',NULL,1),
  (@lm_b,'宿舍四栋546室','dorm','access','门禁设施维护费','per_month',0.0000,NULL,1.0000,'manual',8.33,2),
  (@lm_b,'宿舍四栋546室','dorm','network','网络通讯费','per_month',0.0000,NULL,1.0000,'manual',50.00,3);
-- 龙为 S10-0253 拆两链(锚:Σ=4458.74=原值);空壳S10-0281删
UPDATE contract SET contract_no='S10-0253#A', rent_area=156.13, building_area=124.90, monthly_rent=3453.73,
  start_date='2023-12-25', end_date='2024-06-24', term_type='explicit', term_text='2023年12月25日至2024年06月24日',
  remark='补充租户核对:宿舍一栋501、504室+四栋435室 3间', unit_price=19.0000, infra_fee_price=2.0000,
  fee_src='{"area": "manual", "rent": "manual", "infra": "manual"}' WHERE id=253;
DELETE FROM contract_billing_term WHERE contract_id=253;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (253,'宿舍一栋501、504室；四栋435室','dorm','rent_dorm','宿舍租金','per_sqm_month',19.0000,156.13,1.0000,'manual',NULL,0),
  (253,'宿舍一栋501、504室；四栋435室','dorm','infra','宿舍基础设施维护费','per_sqm_month',2.0000,156.13,1.0000,'manual',NULL,1),
  (253,'宿舍一栋501、504室；四栋435室','dorm','access','门禁设施维护费','per_month',0.0000,NULL,1.0000,'manual',25.00,2),
  (253,'宿舍一栋501、504室；四栋435室','dorm','network','网络通讯费','per_month',0.0000,NULL,1.0000,'manual',150.00,3);
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,unit_price,infra_fee_price,fee_src,link_type,kind) VALUES
  ('S10-0253#B',94,26,NULL,45.08,1005.01,0.00,'2024-01-04','2024-07-03','explicit','2024年01月04日至2024年07月03日','active','补充租户核对:宿舍一栋604室',36.06,19.0000,2.0000,'{"area": "manual", "rent": "manual", "infra": "manual"}','new','normal');
SET @lw_b=LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@lw_b,'宿舍一栋604室','dorm','rent_dorm','宿舍租金','per_sqm_month',19.0000,45.08,1.0000,'manual',NULL,0),
  (@lw_b,'宿舍一栋604室','dorm','infra','宿舍基础设施维护费','per_sqm_month',2.0000,45.08,1.0000,'manual',NULL,1),
  (@lw_b,'宿舍一栋604室','dorm','access','门禁设施维护费','per_month',0.0000,NULL,1.0000,'manual',8.33,2),
  (@lw_b,'宿舍一栋604室','dorm','network','网络通讯费','per_month',0.0000,NULL,1.0000,'manual',50.00,3);
DELETE FROM contract_billing_term WHERE contract_id=281;
DELETE FROM contract_unit WHERE contract_id=281;
DELETE FROM contract WHERE id=281 AND monthly_rent=0;
-- 开利保障房 S10-0059 三段递增链(2019-11-25起;纸约14.50/1.80→15.95/1.98→17.55/2.18;面积10429.28两栋)
UPDATE contract SET contract_no='S10-0059#1', monthly_rent=169997.26, unit_price=14.5000, infra_fee_price=1.8000,
  start_date='2019-11-25', end_date='2022-11-24', term_type='explicit', term_text='2019年11月25日至2022年11月24日',
  remark='补充租户核对:保障房2号楼+3号楼各5214.64㎡,三段递增', status='active',
  fee_src='{"area": "manual", "rent": "manual", "infra": "manual"}' WHERE id=59;
DELETE FROM contract_billing_term WHERE contract_id=59;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (59,'保障房2号楼','dorm','rent_dorm','宿舍租金','per_sqm_month',14.5000,5214.64,1.0000,'manual',NULL,0),
  (59,'保障房2号楼','dorm','infra','宿舍基础设施维护费','per_sqm_month',1.8000,5214.64,1.0000,'manual',NULL,1),
  (59,'保障房3号楼','dorm','rent_dorm','宿舍租金','per_sqm_month',14.5000,5214.64,1.0000,'manual',NULL,2),
  (59,'保障房3号楼','dorm','infra','宿舍基础设施维护费','per_sqm_month',1.8000,5214.64,1.0000,'manual',NULL,3);
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,unit_price,infra_fee_price,fee_src,parent_contract_id,link_type,kind)
SELECT 'S10-0059#2',111,building_id,unit_id,rent_area,186997.02,0.00,'2022-11-25','2025-11-24','explicit','2022年11月25日至2025年11月24日','active','开利保障房段2(15.95/1.98)',building_area,15.9500,1.9800,fee_src,59,'escalation','normal' FROM contract WHERE id=59;
SET @kl2=LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, seq)
SELECT @kl2, location, property_type, fee_key, fee_name, bill_mode, CASE fee_key WHEN 'rent_dorm' THEN 15.9500 ELSE 1.9800 END, area, coeff, 'manual', seq FROM contract_billing_term WHERE contract_id=59;
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,unit_price,infra_fee_price,fee_src,parent_contract_id,link_type,kind)
SELECT 'S10-0059#3',111,building_id,unit_id,rent_area,205769.71,0.00,'2025-11-25','2025-12-31','explicit','2025年11月25日至2025年12月31日','active','开利保障房段3(17.55/2.18,至租期止)',building_area,17.5500,2.1800,fee_src,@kl2,'escalation','normal' FROM contract WHERE id=59;
SET @kl3=LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, seq)
SELECT @kl3, location, property_type, fee_key, fee_name, bill_mode, CASE fee_key WHEN 'rent_dorm' THEN 17.5500 ELSE 2.1800 END, area, coeff, 'manual', seq FROM contract_billing_term WHERE contract_id=59;
-- 易釆(54) 厂房约补remark+宿舍4链
UPDATE contract SET remark=CONCAT(COALESCE(remark,''),' | 纸约:六车间6-7层九年期,起始日以物业交付书面确定(2022-09-16签约单);首三年110679.10不含税,第四至六年+10%'),
  fee_src='{"rent": "manual"}' WHERE id=198;
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,unit_price,infra_fee_price,fee_src,link_type,kind) VALUES
  ('S10-0198A#1',54,29,NULL,146.12,3301.85,0.00,'2023-12-22','2024-06-30','explicit','2023年12月22日至2024年06月30日','active','易釆宿舍:四栋636、638、640、642 共4间',116.90,19.0000,2.0000,'{"area": "manual", "rent": "manual", "infra": "manual"}','new','normal'),
  ('S10-0198B#1',54,29,NULL,45.08,1005.01,0.00,'2024-01-06','2024-06-30','explicit','2024年01月06日至2024年06月30日','active','易釆宿舍:四栋327',36.06,19.0000,2.0000,'{"area": "manual", "rent": "manual", "infra": "manual"}','new','normal'),
  ('S10-0198C#1',54,29,NULL,73.05,1650.72,0.00,'2024-02-22','2024-08-31','explicit','2024年02月22日至2024年08月31日','active','易釆宿舍:四栋441、443 共2间',58.44,19.0000,2.0000,'{"area": "manual", "rent": "manual", "infra": "manual"}','new','normal'),
  ('S10-0198D#1',54,29,NULL,73.75,1607.08,0.00,'2024-03-01','2024-08-31','explicit','2024年03月01日至2024年08月31日','active','易釆宿舍:四栋225',59.00,19.0000,2.0000,'{"area": "manual", "rent": "manual", "infra": "manual"}','new','normal');
-- 协作链 S10-0149 三段(HJYLS2307001,2023-08-01~2032-07-31,基础1.96每三年+10%;变压器159/电梯636)
UPDATE contract SET contract_no='S10-0149#1', tenant_id=15, rent_area=7202.00, building_area=5761.60, monthly_rent=14910.92,
  start_date='2023-08-01', end_date='2026-07-31', term_type='explicit', term_text='2023年08月01日至2026年07月31日',
  remark='补充租户核对:二期9号楼(2车间)103、201单元;合同号HJYLS2307001;仅基础设施维护费(免租金模式);原月租15826.80与纸约14910.92差915.88待财务核',
  infra_fee_price=1.9600, transformer_fee=159.00, elevator_fee=636.00, kva=60.00,
  fee_src='{"area": "manual", "infra": "manual", "elevator": "manual", "transformer": "manual"}' WHERE id=149;
DELETE FROM contract_billing_term WHERE contract_id=149;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (149,'二期9号楼（2车间）103、201单元','factory','infra','厂房基础设施维护费','per_sqm_month',1.9600,7202.00,1.0000,'manual',NULL,0),
  (149,'二期9号楼（2车间）103、201单元','factory','transformer','变压器维护费','per_month',0.0000,NULL,1.0000,'manual',159.00,1),
  (149,'二期9号楼（2车间）103、201单元','factory','elevator','电梯维护费','per_month',0.0000,NULL,1.0000,'manual',636.00,2);
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,infra_fee_price,transformer_fee,elevator_fee,kva,fee_src,parent_contract_id,link_type,kind)
SELECT 'S10-0149#2',15,building_id,unit_id,rent_area,16322.51,0.00,'2026-08-01','2029-07-31','explicit','2026年08月01日至2029年07月31日','active','协作链段2(基础15527.51)',building_area,2.1560,159.00,636.00,60.00,fee_src,149,'escalation','normal' FROM contract WHERE id=149;
SET @xzl2=LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq)
SELECT @xzl2, location, property_type, fee_key, fee_name, bill_mode, CASE fee_key WHEN 'infra' THEN 2.1560 ELSE unit_price END, area, coeff, 'manual', amount_override, seq FROM contract_billing_term WHERE contract_id=149;
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,infra_fee_price,transformer_fee,elevator_fee,kva,fee_src,parent_contract_id,link_type,kind)
SELECT 'S10-0149#3',15,building_id,unit_id,rent_area,17875.26,0.00,'2029-08-01','2032-07-31','explicit','2029年08月01日至2032年07月31日','active','协作链段3(基础17080.26)',building_area,2.3716,159.00,636.00,60.00,fee_src,@xzl2,'escalation','normal' FROM contract WHERE id=149;
SET @xzl3=LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq)
SELECT @xzl3, location, property_type, fee_key, fee_name, bill_mode, CASE fee_key WHEN 'infra' THEN 2.3716 ELSE unit_price END, area, coeff, 'manual', amount_override, seq FROM contract_billing_term WHERE contract_id=149;
-- 保奔路 S10-0145 段1補日期(锚3772=现值)+esc段2;中科华贸/火炬园/吴耀兰/管中旺
UPDATE contract SET contract_no='S10-0145#1', start_date='2023-08-25', end_date='2026-08-24', term_type='explicit',
  term_text='2023年08月25日至2026年08月24日',
  remark='补充租户核对:一车间602;补充协议面积1473→1600(基础3136);30KVA', kva=30.00,
  fee_src='{"area": "manual", "infra": "manual", "elevator": "manual", "transformer": "manual"}' WHERE id=145;
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,infra_fee_price,transformer_fee,elevator_fee,kva,fee_src,parent_contract_id,link_type,kind)
SELECT 'S10-0145#2',11,building_id,unit_id,rent_area,4085.60,0.00,'2026-08-25','2029-08-24','explicit','2026年08月25日至2029年08月24日','active','保奔路段2(基础3449.6)',building_area,2.1560,159.00,477.00,30.00,fee_src,145,'escalation','normal' FROM contract WHERE id=145;
UPDATE contract SET remark=CONCAT(COALESCE(remark,''),' | 补充租户核对:一车间702 320㎡;纸质合同期限截图缺,日期待财务补') WHERE id=219;
UPDATE contract SET start_date='2023-05-01', term_type='relative',
  term_text='2023年05月01日起,19元/㎡季付;首次递增2025-11-01,每三年+10%;租期年限待核',
  remark=CONCAT(COALESCE(remark,''),' | 补充租户核对:车间一~四整租95203.77㎡') WHERE id=135;
UPDATE contract SET monthly_rent=5064.40, mgmt_fee_price=5.0000, infra_fee_price=1.0000, elevator_fee=100.00, transformer_fee=50.00,
  remark=CONCAT(COALESCE(remark,''),' | 补充租户核对:补物业费四行(管5/基础1/电梯100/变压器50);8千瓦10KVA'),
  fee_src='{"area": "manual", "rent": "manual", "mgmt": "manual", "infra": "manual", "elevator": "manual", "transformer": "manual"}' WHERE id=22;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (22,'一期C座二楼201、221室','factory','mgmt','厂房企业管理服务费','per_sqm_month',5.0000,245.72,1.0000,'manual',NULL,1),
  (22,'一期C座二楼201、221室','factory','infra','厂房基础设施维护费','per_sqm_month',1.0000,245.72,1.0000,'manual',NULL,2),
  (22,'一期C座二楼201、221室','factory','elevator','电梯维护费','per_month',0.0000,NULL,1.0000,'manual',100.00,3),
  (22,'一期C座二楼201、221室','factory','transformer','变压器维护费','per_month',0.0000,NULL,1.0000,'manual',50.00,4);
UPDATE contract SET contract_no='S10-0159#1', start_date='2023-12-16', end_date='2026-12-15', term_type='explicit',
  term_text='2023年12月16日至2026年12月15日', remark='补充租户核对:10栋(三车间)403、404单元;12.5KVA', kva=12.50,
  fee_src='{"area": "manual", "infra": "manual", "elevator": "manual", "transformer": "manual"}' WHERE id=159;
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,infra_fee_price,transformer_fee,elevator_fee,kva,fee_src,parent_contract_id,link_type,kind)
SELECT 'S10-0159#2',25,building_id,unit_id,rent_area,4516.26,0.00,'2026-12-16','2029-12-15','explicit','2026年12月16日至2029年12月15日','active','管中旺段2(基础3721.26)',building_area,2.1560,159.00,636.00,12.50,fee_src,159,'escalation','normal' FROM contract WHERE id=159;
-- 嘉荣宿舍链(四栋230;unit 补建)
INSERT INTO unit (building_id, floor, unit_no, area)
SELECT 29,2,'230',0.00 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM unit WHERE building_id=29 AND unit_no='230');
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,term_type,term_text,status,remark,building_area,unit_price,infra_fee_price,fee_src,link_type,kind) VALUES
  ('C2024M-038A#1',375,29,(SELECT id FROM unit WHERE building_id=29 AND unit_no='230'),74.52,1614.92,0.00,'2024-02-01','2025-01-31','explicit','2024年02月01日至2025年01月31日','active','嘉荣宿舍:四栋230',59.62,19.0000,2.0000,'{"area": "manual", "rent": "manual", "infra": "manual"}','new','normal');
SET @jr_dorm=LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@jr_dorm,'宿舍四栋230室','dorm','rent_dorm','宿舍租金','per_sqm_month',19.0000,74.52,1.0000,'manual',NULL,0),
  (@jr_dorm,'宿舍四栋230室','dorm','infra','宿舍基础设施维护费','per_sqm_month',2.0000,74.52,1.0000,'manual',NULL,1),
  (@jr_dorm,'宿舍四栋230室','dorm','network','网络通讯费','per_month',0.0000,NULL,1.0000,'manual',50.00,2);

-- ══ 3. 新档14个 ══
INSERT INTO tenant (company_name, business_type, status, phase, remark) VALUES
  ('温小蓉','配套服务',1,4,'宿舍散户(补充租户批,源:宿舍水电册)'),
  ('文广','配套服务',1,4,'宿舍散户(补充租户批)'),
  ('朱海勇','配套服务',1,4,'宿舍散户(补充租户批)'),
  ('王伍平','配套服务',1,4,'宿舍散户(补充租户批;2024-02册有专属sheet)'),
  ('张永根','配套服务',1,4,'宿舍散户(补充租户批)'),
  ('陈玉林','配套服务',1,4,'宿舍散户(补充租户批)'),
  ('曾回文（工程队）','配套服务',1,4,'工程队宿舍(补充租户批)'),
  ('SEAN','配套服务',1,4,'宿舍二栋商铺4104(补充租户批,正名待核)'),
  ('园区保安宿舍','配套服务',1,4,'物业自用:1-202/1-302/1-402,居民价开「保安宿舍」缴费单'),
  ('工程队宿舍（朱锐）','配套服务',1,4,'4-235,原文「消防」为房间用途备注,费用开给工程队(朱锐)'),
  ('道磁','配套服务',1,1,'C座401(补充租户批;2024-02公摊实缴,档案待完善)'),
  ('张执盛','配套服务',1,1,'F座401(补充租户批;2024-02公摊实缴)'),
  ('詹凯乔','配套服务',1,1,'F401借电户(2024-02册有专属sheet)'),
  ('黄路生','配套服务',2,1,'2023-01~2024-02 A座420历史租户(租金册专属sheet实证);2024-02后退场,物理表转暨南医美(420→421);财务待人工审核');
-- 黄路生空合同(用户指令:建空合同绑上,财务人工审核)
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,status,remark,link_type,kind)
SELECT 'HIST-HLS-01', id, 13, NULL, 0.00, 0.00, 0.00, 'draft', '黄路生历史租约占位(2023-01~2024-02 A座420);财务待审核补要素', 'new', 'normal'
FROM tenant WHERE company_name='黄路生';

-- ══ 4. 挂表 ══
-- 精确同名通挂(唯一命中才挂,含新档;两轮:正名+别名)
UPDATE meter m JOIN tenant t ON m.tenant_name=t.company_name
SET m.tenant_id=t.id
WHERE m.tenant_id IS NULL AND m.ownership='tenant'
  AND (SELECT COUNT(*) FROM tenant t2 WHERE t2.company_name=m.tenant_name)=1;
UPDATE meter m JOIN tenant t ON CONCAT(',',REPLACE(COALESCE(t.aliases,''),'，',','),',') LIKE CONCAT('%,',m.tenant_name,',%')
SET m.tenant_id=t.id
WHERE m.tenant_id IS NULL AND m.ownership='tenant' AND COALESCE(t.aliases,'')<>''
  AND (SELECT COUNT(*) FROM tenant t2 WHERE CONCAT(',',REPLACE(COALESCE(t2.aliases,''),'，',','),',') LIKE CONCAT('%,',m.tenant_name,',%'))=1;
-- 点名单(非同名):旭化成厕所水/光伏侯炳成/李李分挂/保安宿舍/工程队/借电
UPDATE meter SET tenant_id=361 WHERE id IN (409,410) AND tenant_id IS NULL;
UPDATE meter SET tenant_id=81 WHERE id IN (1018,1022,1023) AND tenant_id IS NULL;
UPDATE meter SET tenant_id=15 WHERE id IN (25,116,117) AND tenant_id IS NULL;
UPDATE meter SET tenant_id=145 WHERE id IN (531,854) AND tenant_id IS NULL;
UPDATE meter SET tenant_id=(SELECT id FROM tenant WHERE company_name='园区保安宿舍') WHERE id IN (560,868,587,894);
UPDATE meter SET tenant_id=(SELECT id FROM tenant WHERE company_name='工程队宿舍（朱锐）') WHERE id IN (708,1010);
UPDATE meter SET tenant_id=(SELECT id FROM tenant WHERE company_name='詹凯乔') WHERE id=344 AND tenant_id IS NULL;
UPDATE meter SET tenant_id=(SELECT id FROM tenant WHERE company_name='张执盛') WHERE id IN (498,499) AND tenant_id IS NULL;   -- 原文带方位后缀,点名挂
UPDATE meter SET tenant_id=1 WHERE id=29 AND tenant_id IS NULL;   -- 火炬园办公室电挂园区主体
-- 恋玺污染清除+1-402 归保安宿舍
UPDATE meter SET tenant_id=NULL WHERE id IN (562,870) AND tenant_id=178;   -- 大为1-204(随后停用)
UPDATE meter SET tenant_id=(SELECT id FROM tenant WHERE company_name='园区保安宿舍') WHERE id IN (614,920);

-- ══ 5. 设施转park/ops+清理 ══
UPDATE meter SET ownership='park', tenant_id=NULL WHERE id IN (507,506,1457,839,840,845,846,455,458);
DELETE FROM tenant WHERE id=188 AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=188)
  AND NOT EXISTS(SELECT 1 FROM meter WHERE tenant_id=188 AND id NOT IN (506,1457))
  AND NOT EXISTS(SELECT 1 FROM monthly_ledger WHERE tenant_id=188);
UPDATE meter SET ownership='ops' WHERE id=61;                        -- p2园区充电桩=经营口径
UPDATE meter SET ownership='share' WHERE id IN (459,460);            -- C座二楼东西侧水=公共侧

-- ══ 6. 退租类电表停用(retired_ym=2024-03:2月数据保留,3月起退出待核/分母) ══
UPDATE meter SET retired_ym='2024-03' WHERE id IN
  (230,424,          -- 帷幄 A座436
   1424,             -- 周应佳 A座427/428
   286,287,292,559,561,562,867,869,870,   -- 大为(C座2块+东侧公共+宿舍1-201/203/204电水)
   425,              -- 孙洋洋 A座437、438水
   303);             -- 陈世邦 C座214-216电

COMMIT;

-- ══ 验收 ══
SELECT '待核余量' k, COUNT(*) v FROM meter WHERE ownership='tenant' AND tenant_id IS NULL AND retired_ym IS NULL
  AND tenant_name IS NOT NULL AND tenant_name NOT IN ('-','（空）','已停用') AND TRIM(tenant_name)<>''
UNION ALL SELECT '力美两链Σ', SUM(monthly_rent) FROM contract WHERE contract_no LIKE 'S10-0055%'
UNION ALL SELECT '龙为两链Σ', SUM(monthly_rent) FROM contract WHERE contract_no LIKE 'S10-0253%'
UNION ALL SELECT '停用表数', COUNT(*) FROM meter WHERE retired_ym IS NOT NULL;
SELECT tenant_name, GROUP_CONCAT(id) ids FROM meter WHERE ownership='tenant' AND tenant_id IS NULL AND retired_ym IS NULL
  AND tenant_name IS NOT NULL AND tenant_name NOT IN ('-','（空）','已停用') AND TRIM(tenant_name)<>'' GROUP BY tenant_name;
