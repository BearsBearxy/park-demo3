-- =====================================================================
-- S5 刀3 Task4：A座电梯池成员 + 一期绿化水建池 + 绿化基数修正（起草，未执行）2026-08-05
-- 目的（S5-PREMISE-BILL-SPEC §3.1 / §5③④）：
--   ① rule40「一期 A座·天面·电梯」补受益人 —— 名单=分摊表电梯列非空的A座户
--   ② 新建一期绿化水池（园区级 area 池，绑表 390/391/392，单价 4.45=水3.95+管0.50）
--   ③ tenant_price_cfg p1.green_area_base 15510→80000（15510 系宿舍 lamp_area_base 误拷）
-- 依据：
--   ① 一期2024年2月水电费.xlsx『一期租户分摊公共用电金额』sheet，区域=A座 且
--     电梯用电列(H)非空的 38 行 → 去重 34 户名 → 31 户已建档（名→id 见下，
--     经 company_name 精确/别名解析，2026-08-05 dev 库核对），3 户查无档案（见 MANUAL 段）
--   ② 同册绿化水：std=ROUND(Σ390/391/392用量×4.45/80000,3)=0.009，
--     可莱恩锚点 A602 1986×0.009=17.87 / B201 4050×0.009=36.45（S5 §3.1）
--     单价走 alloc_cfg rule:{id}.price_override（rule91 宿舍绿化水同款机制，非电价轨道）
--   ③ p1.green_area_base 现值 15510.00 = dorm.lamp_area_base 同值误拷；
--     0.009 反推分母=80000（与 p1.lamp_area_base 一致，POOL-FORMULA-AUDIT 佐证）
-- 前置：⚠ meter 390/391/392 目前全库零读数 —— 锚点验证需先导入一期园区水
--   2024-02 绿化水表读数（Σ用量应落 [152.8, 170.8) 区间才能出 std=0.009）
-- 应用步骤：先 mysqldump park_demo3 > backup-before-s5-刀3-20260805.sql，
--   再 docker exec -i demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 < 本文件
--   （本文件 UTF-8 无 BOM；勿经 PowerShell 管道转码，中文会 GBK 损坏）
-- =====================================================================

-- ① rule40 A座电梯受益人（weight=NULL 走 area 法按户面积，acct_month='' 默认长期行）
-- 前置断言：rule40 现无成员（SELECT COUNT(*) FROM alloc_rule_member WHERE rule_id=40 应=0）
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month) VALUES
  (40, 361, NULL, ''),  -- 旭化成(二楼201、202室)
  (40, 101, NULL, ''),  -- 成吉(二楼203室;id263成吉（艾克特瑞、艾莱达）为别档,取精确名)
  (40, 104, NULL, ''),  -- 合源创盈(册面「合源」二楼206室)
  (40, 335, NULL, ''),  -- 吴跃平(册面「吴跃平/宏玥」二楼203、216室;=吴耀兰)
  (40, 365, NULL, ''),  -- 暨南中院(二楼219室)
  (40, 371, NULL, ''),  -- 羊城科技(二楼220室)
  (40, 119, NULL, ''),  -- 仁恒(册面「仁恒智研」三楼306室)
  (40, 120, NULL, ''),  -- 采妍(册面「陈君/采妍」三楼310室)
  (40, 130, NULL, ''),  -- 林春艳(三楼321室)
  (40, 280, NULL, ''),  -- 建奕(三楼306室)
  (40, 142, NULL, ''),  -- 炳记(四楼432-434室;id270炳记运输为别档)
  (40, 367, NULL, ''),  -- 幸悦(四楼437室)
  (40, 359, NULL, ''),  -- 重瞳(册面「重瞳科技」四楼439室)
  (40, 134, NULL, ''),  -- 林观平(四楼445室+六楼620室)
  (40, 116, NULL, ''),  -- 粤海华创(四楼411室;id267南海卓格（粤海华创）为别档)
  (40, 122, NULL, ''),  -- 优唯特(四楼418室)
  (40, 392, NULL, ''),  -- 黄路生(四楼420室)
  (40, 366, NULL, ''),  -- 沈振(四楼422室)
  (40, 368, NULL, ''),  -- MWILLAMA(四楼425室)
  (40, 193, NULL, ''),  -- 金准智能(四楼426室)
  (40, 148, NULL, ''),  -- 布司曼(四楼427室)
  (40, 262, NULL, ''),  -- 戎合(五楼501室)
  (40, 113, NULL, ''),  -- 鑫皇(册面「李富全/鑫皇」五楼502、503室)
  (40, 166, NULL, ''),  -- 尧萍(册面「尧萍贸易」五楼514室)
  (40, 372, NULL, ''),  -- 屋达玛(五楼506室)
  (40, 109, NULL, ''),  -- 新材料协会(六楼612室)
  (40, 110, NULL, ''),  -- 次生代(六楼616室)
  (40, 117, NULL, ''),  -- 宏玥(六楼619室;id314宏玥（中科美业）为别档)
  (40, 149, NULL, ''),  -- 高建军(六楼621室;id282高建军（安加拉）为别档,请人工复核哪档是A座)
  (40, 127, NULL, ''),  -- 碳紫(六楼623室)
  (40, 107, NULL, '');  -- 可莱恩(六楼602室 1986㎡;id315可莱恩食品为别档)

-- MANUAL：册面有电梯分摊但查无租户档案（company_name/aliases 双径均未命中），
-- 建档或补别名后追加成员行，勿盲插：
--   周应佳(四楼428、435室 158.66㎡ 电梯12.69)
--   帷幄(四楼436室 101.84㎡ 电梯8.15)
--   精锐佳(四楼429室 212.68㎡ 电梯17.01)

-- ② 一期绿化水池：园区级 area 池（无显式成员=自动全园在租名册），round_scale=3 复刻册面 0.009
INSERT INTO alloc_rule (zone, name, building_id, method, coefficient, extra_qty, fee_key,
                        note, sort_no, round_scale, std_kind, base_key, fee_name)
VALUES ('p1', '一期园区·绿化水', NULL, 'area', NULL, 0, 'share_green_water',
        '一期绿化水(S5 §3.1):std=ROUND(Σ三表用量×4.45/green_area_base,3),2024-02=0.009 与册全等',
        99, 3, NULL, 'green_area_base', '绿化水');
SET @gid = LAST_INSERT_ID();
INSERT INTO alloc_rule_meter (rule_id, meter_id, sign) VALUES
  (@gid, 390, 1),   -- 园区东侧绿化水1
  (@gid, 391, 1),   -- 园区东侧绿化水2
  (@gid, 392, 1);   -- 园区西侧绿化水
-- 单价 4.45（水3.95+管0.50）：p1 池默认价=elec_commercial，水池必须 price_override（rule91 同款）
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note) VALUES
  (CONCAT('rule:', @gid), 'price_override', 4.45, '', '一期绿化水单价=水3.95+管0.50(S5 §3.1,与户级 tenant:*.water=4.45 例外同值)');

-- ③ 绿化面积基数修正：15510（宿舍 lamp_area_base 误拷）→ 80000（与 p1.lamp_area_base 同分母）
UPDATE tenant_price_cfg
SET cfg_value = 80000,
    note = '一期绿化 0.009 月推分母(S5 §3.1:原15510系宿舍lamp_area_base误拷,0.009反推=80000)'
WHERE scope = 'p1' AND cfg_key = 'green_area_base' AND acct_month = '';

-- =====================================================================
-- 验证段（应用后逐条跑）：
-- 1) SELECT COUNT(*) FROM alloc_rule_member WHERE rule_id=40;                  -- =31(补档3户后=34)
-- 2) SELECT COUNT(*) FROM alloc_rule_meter m JOIN alloc_rule r ON r.id=m.rule_id
--      WHERE r.name='一期园区·绿化水';                                          -- =3
-- 3) SELECT cfg_value FROM tenant_price_cfg
--      WHERE scope='p1' AND cfg_key='green_area_base' AND acct_month='';       -- =80000
-- 4) （需先导 390/391/392 的 2024-02 读数）重启后端→重生成 2024-02 核算：
--    SELECT std_value FROM alloc_pool_result p JOIN alloc_rule r ON r.id=p.rule_id
--      WHERE p.ym='2024-02' AND r.name='一期园区·绿化水';                       -- =0.009
--    SELECT std_value FROM alloc_pool_result WHERE ym='2024-02' AND rule_id=40; -- =0.08
--    可莱恩锚点（S5 §3.1，需 S5 全链 splitShare 场地拆行后看催缴单行）：
--      电梯 A602=158.88(1986×0.08)、绿化水 17.87/36.45(1986/4050×0.009)
-- 回滚：
--   DELETE FROM alloc_rule_member WHERE rule_id=40 AND acct_month='';
--   DELETE FROM alloc_cfg WHERE scope=CONCAT('rule:', <新池id>) AND cfg_key='price_override';
--   DELETE FROM alloc_rule WHERE name='一期园区·绿化水';   -- 绑定表 FK 级联删
--   UPDATE tenant_price_cfg SET cfg_value=15510 WHERE scope='p1' AND cfg_key='green_area_base' AND acct_month='';
-- =====================================================================

-- ── 补:绿化水三表 2024-02 读数(源=一期园区水!R6-R8,逐格 I/J 列;表2 倒走-69 源册原样) ──
-- 净量 195-69+27=153 吨 ×4.45/80000=0.00851→ROUND3=0.009 与册面 L6 公式全等
INSERT INTO meter_reading (meter_id, ym, prev_total, curr_total, factor_snap, source, note)
SELECT m.id, '2024-02', v.p, v.c, 1.00, 'import', '一期园区水R6-R8逐格(s5刀1)'
FROM (SELECT 390 AS id, 23402 AS p, 23597 AS c
      UNION ALL SELECT 391, 72622, 72553
      UNION ALL SELECT 392, 4087, 4114) v
JOIN meter m ON m.id = v.id AND m.kind = 'water'
WHERE NOT EXISTS (SELECT 1 FROM meter_reading r WHERE r.meter_id = v.id AND r.ym = '2024-02');
-- 验证:预期 3 行,净量 153
SELECT COUNT(*) AS n_expect_3, SUM(curr_total - prev_total) AS net_expect_153
FROM meter_reading WHERE meter_id IN (390,391,392) AND ym = '2024-02';

-- ── 补2:绿化水三表启用月 2024-05→2024-02(建档取首见月,V87 未启用态把 2024-02 读数过滤成全停挂零) ──
UPDATE meter SET active_from_ym='2024-02' WHERE id IN (390,391,392) AND active_from_ym='2024-05';
