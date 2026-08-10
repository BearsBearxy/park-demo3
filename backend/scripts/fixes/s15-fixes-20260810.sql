-- ════════════════════════════════════════════════════════════════════════════
-- S15 五问题数据刀 —— 六车间损耗率/刘彪乱码/主栋挂错/混装合同面积
--     (草稿 2026-08-10,**未执行**,待主会话审核;禁止直接写 dev 库)
--
-- 依据: scratchpad p2rules/s15_recon.md (S15复检对账,324条: ①245/②30/③21/④28)
-- 执行方式(乱码§2硬性要求,整文件同规):
--   mysql --default-character-set=utf8mb4 -uroot -p*** park_demo3 < 本文件
--   (§2 乱码成因正是 S13 主会话裸 docker exec 无 charset 写入;严禁重蹈)
-- 库况基线(2026-08-10 只读核实):
--   alloc_cfg id=76: scope='building:35' loss_adj_qty 2024-02 = 300.00000000
--   alloc_loss_result id=517 (ym=2024-02, head=35): c=18320.00, d=17756.40,
--     e=-563.60, adj_qty=300, adj_rate=0.002, tenant_rate=0.049100
--   contract_billing_term 8556 (合同199 刘彪/tid55, rent_factory, 1347.50):
--     location HEX=C3A4C2BAC592C3A6C593C5B83133C3A5C28FC2B7C3A6C2A5C2BC
--     (=「二期13号楼」UTF-8 双重编码;全表仅此 1 行乱码,已扫描核实)
--   合同 64/65/66/67/79 building_id = 29/27/29/27/28 (计费行见 §3 逐份 dump)
--   混装合同(既有 rent_dorm 又有 rent_factory/office/shop)全库共 23 份/15 户;
--     非宿舍键与宿舍键均无 (location|fee_key|area) 三元重复行(已核),
--     故 SUM(area) 即等于后端 dedupAreaSum 口径,无需逐份手写;
--     且 23 份现 rent_area 全部 = 非宿舍Σ+宿舍Σ(机制吻合:现值系含宿舍口径)。
-- ⚠依赖服务刀: ContractService.BUILDING_RENT_KEYS(:536) 现仍含 rent_dorm,
--   任一混装合同在 UI 重存将按旧口径把宿舍面积加回 rent_area——§4 数据修复
--   须与 S15 服务刀(非宿舍口径)同批落地,否则会被回写击穿。
--
-- 段落: §0 前置断言 → §1 六车间损耗率H值 → §2 刘彪8556乱码 → §3 主栋挂错
--       → §4 混装合同rent_area非宿舍口径 → §5 验证SELECT
-- 幂等: 各 UPDATE 均带现值守卫或 SET 绝对值,整文件可重跑(第二遍 0 行)。
-- ════════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════════════════════════
-- §0 前置断言(只读;与「预期」不符即停)
-- ════════════════════════════════════════════════════════════════════════════
-- 断言01 六车间H值现值(预期 1 行: id=76, cfg_value=300.00000000)
SELECT '断言01 六车间H' AS chk, id, scope, cfg_key, acct_month, cfg_value
FROM alloc_cfg WHERE scope='building:35' AND cfg_key='loss_adj_qty' AND acct_month='2024-02';

-- 断言02 8556 乱码现值(预期 HEX=C3A4C2BAC592C3A6C593C5B83133C3A5C28FC2B7C3A6C2A5C2BC)
SELECT '断言02 8556' AS chk, id, contract_id, fee_key, HEX(location) AS loc_hex, area
FROM contract_billing_term WHERE id=8556;

-- 断言03 五合同现栋(预期: 64→29, 65→27, 66→29, 67→27, 79→28)
SELECT '断言03 现栋' AS chk, id, building_id FROM contract
WHERE id IN (64,65,66,67,79) ORDER BY id;

-- 断言04 混装合同无三元重复行(预期 0 行;若出行则 §4 停手逐份手写)
SELECT '断言04 重复行' AS chk, contract_id, location, fee_key, area, COUNT(*) cnt
FROM contract_billing_term
WHERE contract_id IN (2,7,52,64,65,66,67,79,99,202,203,204,205,209,212,298,308,358,359,360,365,366,367)
  AND fee_key IN ('rent_factory','rent_office','rent_shop','rent_dorm')
GROUP BY contract_id, location, fee_key, area HAVING cnt>1;

-- ════════════════════════════════════════════════════════════════════════════
-- §1 六车间损耗率: H(loss_adj_qty) 300 → 98.30
--
-- 出处链(s15_recon.md ④#3~#17 + 「与问题1的印证」节):
--   · 源册 sheets/二期园区损耗.txt r9: C9=18320, 分表Σ E9=17958.1, H9=300,
--     J9=0.0381 (J9=-ROUND((F9-H9)/C9,4)+I9)。H9=300 是按 表77'六车间电梯2'
--     旧倍率50 的分表Σ口径定的手工调整量。
--   · S13-b 已把表77倍率 50→40(10户电梯差全消,锚点19/19 PASS),分表Σ因此
--     少 201.7 度(=1008.5×(50-40)/50): dev d_qty=17756.40=源E9 17958.1-201.7,
--     E 从 -361.90 恶化到 -563.60,派生率 -ROUND((-563.60-300)/18320,4)+0.002
--     = 0.0491 (AllocService.java:250-258 tenantLossRate),即④中12条率漂移根因。
--   · H 同减 201.7 保 E-H 不变: 300-201.70=98.30
--     → -ROUND((-563.60-98.30)/18320,4)+0.002 = 0.0361+0.002 = 0.0381 = 源册J9。
--   · 源册自身矛盾一并记录: 源册损耗表分表Σ按倍率50计(E9含六车间电梯2共
--     1008.5度),而计费表电梯费按倍率40计(V119=132.77/层)——两处口径不一致;
--     dev 修表77后全站统一用40,内部自洽,H 值随之换算才能回到源册 J9。
-- 影响: 六车间链 2024-02 损耗率 0.0491→0.0381,12条率漂移差(约+189元/月多收)
--   在【重生成后】回落;庞俊妨损耗差 +9.12→约+3.78(仅剩源册漏加K7尖峰行部分)。
-- ════════════════════════════════════════════════════════════════════════════
UPDATE alloc_cfg SET cfg_value=98.30
WHERE scope='building:35' AND cfg_key='loss_adj_qty' AND acct_month='2024-02'
  AND cfg_value=300;   -- 现值守卫,幂等;预期 1 行

-- ════════════════════════════════════════════════════════════════════════════
-- §2 刘彪计费行乱码: contract_billing_term id=8556 location 回正「二期13号楼」
--
-- 成因: S13 主会话裸 docker exec 无 charset 写入(客户端 latin1 通道把 UTF-8
--   字节流二次编码),存库成 'äºŒæœŸ13å·æ¥¼' = UTF-8 双重编码。
--   现值 HEX=C3A4C2BAC592C3A6C593C5B83133C3A5C28FC2B7C3A6C2A5C2BC
--   目标 HEX=E4BA8CE69C9F3133E58FB7E6A5BC (=「二期13号楼」)
-- 执行硬性要求: 客户端必须带 --default-character-set=utf8mb4。此处 SET 值用
--   UNHEX 写死目标字节,对客户端 charset 免疫(双保险);WHERE 用现值 HEX 守卫幂等。
-- 影响: 仅该行文本;金额不动。bill_notice_line 13 行同源 mojibake premise
--   (id 79525 等)由计费行派生,本行回正后【重生成】自然修复,不单独 UPDATE。
-- ════════════════════════════════════════════════════════════════════════════
UPDATE contract_billing_term
SET location=CONVERT(UNHEX('E4BA8CE69C9F3133E58FB7E6A5BC') USING utf8mb4)  -- =「二期13号楼」
WHERE id=8556
  AND HEX(location)='C3A4C2BAC592C3A6C593C5B83133C3A5C28FC2B7C3A6C2A5C2BC';  -- 现值守卫,幂等;预期 1 行

-- ════════════════════════════════════════════════════════════════════════════
-- §3 五份主楼栋挂错合同(主栋=宿舍楼但厂房/商铺行为主)
--
-- 只读 dump 结论(计费行 location vs 现 building_id, 按厂房/商铺行文本匹配 building 表):
-- ┌─────┬────────┬───────────────────┬──────────────────────────────────────┬─────────────────┬──────────────┐
-- │合同 │ 租户   │ 现栋              │ 厂房/商铺行 location(面积)           │ 目标栋          │ 判定         │
-- ├─────┼────────┼───────────────────┼──────────────────────────────────────┼─────────────────┼──────────────┤
-- │ 64  │ 汤周杰 │ 29 一期宿舍四栋   │ rent_factory 一期D座二楼(3108)       │ 22 一期 D座     │ UPDATE 29→22 │
-- │ 65  │ 陈昌辉 │ 27 一期宿舍二栋   │ rent_shop 宿舍区二号楼首层2101、2102 │ 27 一期宿舍二栋 │ 现值已对,不改│
-- │     │        │                   │ 室(107.50)                           │                 │              │
-- │ 66  │ 张勤军 │ 29 一期宿舍四栋   │ rent_shop 宿舍区3号楼首层3101室(133) │ 28 一期宿舍三栋 │ UPDATE 29→28 │
-- │     │        │                   │ + 宿舍区3号楼首层4101室(1000)        │                 │ ⚠见下注      │
-- │ 67  │ 雷少康 │ 27 一期宿舍二栋   │ rent_shop 宿舍区二号楼首层2108、2109 │ 27 一期宿舍二栋 │ 现值已对,不改│
-- │     │        │                   │ 室(102.00)                           │                 │              │
-- │ 79  │ 沙力海 │ 28 一期宿舍三栋   │ rent_shop 宿舍3号楼3102室(100.56)    │ 28 一期宿舍三栋 │ 现值已对,不改│
-- └─────┴────────┴───────────────────┴──────────────────────────────────────┴─────────────────┴──────────────┘
-- · 65/67/79 三份系「主栋=宿舍楼」启发式误报: 其商铺行本就位于宿舍楼首层,
--   现 building_id 与商铺行文本一致,目标=现值,无需改(不出 UPDATE)。
-- · 影响(=修复目的): building_id 决定 期归属/公摊 zone。64 由一期宿舍区
--   改挂一期 D座、66 改挂宿舍三栋后,zone 归属与厂房/商铺主行一致。
-- ⚠66 注: 两商铺行文本均写「宿舍区3号楼」→按任务规则文本匹配取 28;但
--   4101室 房号编码疑指宿舍四栋首层01(参照 2101/2108/3102=栋+层+室 编码,
--   且该行 1000㎡ 为主行)。若人工核实 4101室 实在宿舍四栋,则主行栋=29=现值,
--   应【跳过】下方 66 的 UPDATE——TODO 待人工核对纸约。
-- ════════════════════════════════════════════════════════════════════════════
-- 前置断言(预期: 64 现栋=29)
SELECT '§3断言 64' AS chk, id, building_id AS cur FROM contract WHERE id=64;   -- 预期 29
UPDATE contract SET building_id=22 WHERE id=64 AND building_id=29;  -- 汤周杰→一期 D座;预期 1 行

-- 66 张勤军: 主会话审定【跳过】(2026-08-10)——源册文本「3号楼」与房号编码 4101(=四栋首层01)
--   自相矛盾,且 28/29 同为宿舍楼(zone 同为 dorm,期归属同一期宿舍),改挂引擎影响近零、
--   证据不足不猜。TODO 待用户核纸约后再定;届时执行:
--   UPDATE contract SET building_id=28 WHERE id=66 AND building_id=29;

-- 65/67/79: 目标=现值(27/27/28),不出 UPDATE。

-- ════════════════════════════════════════════════════════════════════════════
-- §4 混装合同 rent_area 重算为非宿舍口径
--
-- 核出清单: 全库混装合同 23 份/15 户(任务口径「15份」即 15 户;同户续签链
--   计费行相同,23 份全部同刀,否则家族内新旧合同面积不一致):
--   银纳(2,52) 一元兰欣(7) 汤周杰(64) 陈昌辉(65) 张勤军(66) 雷少康(67)
--   沙力海(79) 双成(99) 应塘(202) 欧培敬(203,358) 邓宇峰(204,359,360)
--   朱漫钳(205,308) 张文峰(209) 曹小芳(212,365,366,367) 联塑精铟(298)
-- 去重口径与后端一致性: 后端 dedupAreaSum(ContractService.java:694)按
--   (location|fee_key|area) 三元去重后求和(area stripTrailingZeros 归一)。
--   §0 断言04 已核 23 份在 rent 四键上零重复行 → 纯 SUM(area) 与
--   dedupAreaSum 数值全等,无需逐份手写。(若断言04 出行,本段停手改逐份。)
-- 预期新值(现值→新值,building_area=新值×0.8):
--   2/52 银纳       744.85→ 256.52 | 7   一元兰欣 1481.53→1445.00
--   64   汤周杰    3182.52→3108.00 | 65  陈昌辉    143.03→ 107.50
--   66   张勤军    1261.57→1133.00 | 67  雷少康    138.53→ 102.00
--   79   沙力海     174.31→ 100.56 | 99  双成      448.01→ 416.00
--   202  应塘      1989.08→1944.00 | 203/358 欧培敬 1430.54→1310.00
--   204/359/360 邓宇峰 4892.89→4644.10 | 205/308 朱漫钳 1989.08→1944.00
--   209  张文峰    1738.75→1665.00 | 212/365/366/367 曹小芳 3206.88→3170.35
--   298  联塑精铟  1584.53→1548.00
-- 与源册印证(s15_recon.md ③面积基数随差): 应塘1944/欧培敬1310/朱漫钳1944/
--   张文峰1665/曹小芳3170.35 与源册面积全等,该 5 户面积随差在重生成后归零。
--   邓宇峰新值 4644.10 仍≠源 6651(源两块 4551+2100,第二场地系 OVERRIDE 补,
--   不在合同行)——属已知双链问题,不在本刀范围。
-- ════════════════════════════════════════════════════════════════════════════
UPDATE contract c
JOIN (SELECT contract_id, SUM(area) s
      FROM contract_billing_term
      WHERE fee_key IN ('rent_factory','rent_office','rent_shop')
      GROUP BY contract_id) t ON t.contract_id=c.id
SET c.rent_area=t.s, c.building_area=ROUND(t.s*0.8,2)
WHERE c.id IN (2,7,52,64,65,66,67,79,99,202,203,204,205,209,212,298,308,358,359,360,365,366,367);
-- SET 绝对值,幂等;预期 23 行(第二遍 0 行)

-- ════════════════════════════════════════════════════════════════════════════
-- §5 验证 SELECT(全部只读,可反复跑)
-- ════════════════════════════════════════════════════════════════════════════
-- 验证01 六车间H值(预期 cfg_value=98.30000000)
SELECT '验证01 H值' AS chk, id, cfg_value FROM alloc_cfg
WHERE scope='building:35' AND cfg_key='loss_adj_qty' AND acct_month='2024-02';

-- 验证01b 六车间率(⚠须【重生成 2024-02】后才变;预期 adj_qty=98.30,
--   tenant_rate=0.038100 = -ROUND((-563.60-98.30)/18320,4)+0.002)
SELECT '验证01b 率' AS chk, ym, head_building_id, e_qty, adj_qty, adj_rate, tenant_rate
FROM alloc_loss_result WHERE ym='2024-02' AND head_building_id=35;

-- 验证02 8556 回正(预期 loc_hex=E4BA8CE69C9F3133E58FB7E6A5BC, loc=二期13号楼)
SELECT '验证02 8556' AS chk, id, HEX(location) AS loc_hex, location AS loc
FROM contract_billing_term WHERE id=8556;

-- 验证03 五合同新栋(预期: 64→22 一期 D座, 65→27, 66→28 一期 宿舍三栋, 67→27, 79→28)
SELECT '验证03 新栋' AS chk, c.id, c.building_id, b.name
FROM contract c LEFT JOIN building b ON b.id=c.building_id
WHERE c.id IN (64,65,66,67,79) ORDER BY c.id;

-- 验证04 混装合同新 rent_area(预期 0 行 = 全部与非宿舍Σ一致)
SELECT '验证04 面积差' AS chk, c.id, c.rent_area, t.s AS nondorm_sum
FROM contract c
JOIN (SELECT contract_id, SUM(area) s
      FROM contract_billing_term
      WHERE fee_key IN ('rent_factory','rent_office','rent_shop')
      GROUP BY contract_id) t ON t.contract_id=c.id
WHERE c.id IN (2,7,52,64,65,66,67,79,99,202,203,204,205,209,212,298,308,358,359,360,365,366,367)
  AND (c.rent_area <> t.s OR c.building_area <> ROUND(t.s*0.8,2));
