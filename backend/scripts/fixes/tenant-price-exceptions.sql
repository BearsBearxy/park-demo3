-- tenant-price-exceptions.sql — 24 户例外价录入(BILL-DERIVE-SPEC §2.5 不命中清单 → tenant:{id} scope)
-- 依据: BILL-DERIVE-SPEC §2.5(67 行/24 户全部可归因) + PRICE-CFG-SPEC §5(9 项待录扩为 24 项)
-- 手法: INSERT...SELECT 按 tenant.company_name 精确匹配(=,不用 LIKE;已核 26 名在库内精确唯一),
--       并带唯一性护栏(同名多档该行自动落空);acct_month='' 常数版(版本链前滚);
--       note 统一带 "§2.5" 标记,验证与回滚都按此标记圈定本批。
-- 重跑: uk_price(scope,cfg_key,acct_month) 冲突直接报错 —— 刻意不 INSERT IGNORE,防静默覆盖人工改动;
--       重跑先执行文末注释掉的回滚语句。
-- 执行: docker exec -i demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 < 本文件
--       (⚠勿在 PowerShell 管道里回显中文;结果落文件再看)
--
-- elec_package = PRICE-CFG-SPEC §5 预留的「包干电价」键(CFG_KEYS 白名单与前端 PRICE_KEYS 均已收录,
--   本批是首批数据)。语义=户级包干单一价,S4-2 引擎见此键即压过分时判定并归零两 mgmt 键取值。
-- ⚠ tenant scope 压过 zone(解析链 tenant:{id} → zone → ''):
--   朱漫钳(61)名下有宿舍房 304 水表,户级 water=4.45 会连宿舍水一起压过 —— §2.5 原册即按 4.45 归因,照录;
--   若其宿舍间实应 3.85,需改分表处理,S4-3 锚点月验收把关。
--   幸悦(367) status=0 已退租历史户(2024-03 补档),仍录 —— 历史月重算取价需要。
--   禹晨(118) 同时在 A(水 4.45)与 C(包干 1.0)两类,两类都录(§2.5 原表即如此,键不冲突)。
--   欧伟杰临电 = tenant 18 欧伟杰: 其名下唯一电表 meter#28"欧伟杰电"(p2),即 §2.4⑥"二期·欧伟杰(临电)",按 18 录。
--
-- 【不录三项】(§2.5 在册但刻意不入普通派生):
--   1) 火炬园尖段名义价 1.50076875 —— 全册唯一补差公式特例,不做户级 ratio 覆盖(§6.3 建议方向);
--   2) 工程队宿舍 0.79586875 —— 2 月册误套 2023-08 旧模板旧价,历史残留非现行价(P1 §2.8 已定性);
--   3) 翔海 0.99516875 —— E 座楼层公共专用实测表,独立结算轨道(P1 §2.7),不走户级取价。
--
-- 【待核清单】(匹配不确定,不猜,人工核实后补录):
--   1) 火炬园 water 4.45 —— 档案难辨: tenant 24 火炬园邓宇峰名下零表;水表(邓宇峰低/高区)挂家族头
--      60 邓宇峰(其名下另有 12 间宿舍房表,户级 4.45 会误伤 3.85 宿舍水);另存补档重复档
--      309 火炬园火炬园邓宇峰;且 meter#121"欧伟杰水2"tenant_name='火炬园办公室'绑在 18 欧伟杰名下。
--      → 对 2024-02 册核实 4.45 行对应哪块表/哪个档案再补录。
--   2) 火炬园广告字 elec_package 1.5 —— 无租户档案(meter#58"火炬园广告字电"tenant_id=NULL,
--      tenant_name='广告字灯(火炬园广告字)')。→ 先建档并绑表再录。
--   3) 广联临电 elec_package 1.0 —— 无"广联临电"档案或表;p2 meter#49"广联电"tenant_name='广联、氙明'
--      未绑租户(共用表);若录 tenant:28(广联)会波及其名下 60+ 宿舍房间表(居民价)。→ 确认临电挂谁再录。
--   4) 可盈 water_pipe —— 待查 2024-02 册可盈行是否收管网费;dorm 分区默认 water_pipe=0 已兜底,
--      若实收 0.5 需补 tenant:106 water_pipe=0.5(本批仅录 water=3.85)。

-- ── A. 户级水价 4.45(水+管网合并): water=4.45 + water_pipe=0 (6 户×2=12 行;火炬园进待核) ──
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT CONCAT('tenant:', t.id), k.cfg_key, '', k.v, CONCAT(n.name, ' ', k.note)
FROM (SELECT '幸悦' AS name UNION ALL SELECT '詹凯乔' UNION ALL SELECT '禹晨'
      UNION ALL SELECT '公交车站' UNION ALL SELECT '朱漫钳' UNION ALL SELECT '南一') n
CROSS JOIN (SELECT 'water' AS cfg_key, 4.45 AS v, '户级水价4.45,水+管网合并价(BILL-DERIVE-SPEC §2.5)' AS note
            UNION ALL SELECT 'water_pipe', 0, '管网并入4.45不另计(BILL-DERIVE-SPEC §2.5)') k
JOIN tenant t ON t.company_name = n.name
JOIN (SELECT company_name FROM tenant GROUP BY company_name HAVING COUNT(*) = 1) uq
  ON uq.company_name = n.name;

-- ── B. 商铺包干 1.5 元/度(含管理费): elec_package=1.5 + mgmt 两键=0 (10 户×3=30 行;火炬园广告字进待核) ──
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT CONCAT('tenant:', t.id), k.cfg_key, '', k.v, CONCAT(n.name, ' ', k.note)
FROM (SELECT 'SENAN' AS name UNION ALL SELECT '周兴' UNION ALL SELECT '威奈斯'
      UNION ALL SELECT '张丽莉' UNION ALL SELECT '张勤军' UNION ALL SELECT '沙力海'
      UNION ALL SELECT '芷泉' UNION ALL SELECT '袁华圣' UNION ALL SELECT '章肖艳'
      UNION ALL SELECT '李李商铺') n
CROSS JOIN (SELECT 'elec_package' AS cfg_key, 1.5 AS v, '商铺包干1.5元/度,含管理费,压过分时判定(§2.5)' AS note
            UNION ALL SELECT 'mgmt_fee', 0, '包干价已含管理费(§2.5)'
            UNION ALL SELECT 'mgmt_fee_commercial', 0, '包干价已含管理费(§2.5)') k
JOIN tenant t ON t.company_name = n.name
JOIN (SELECT company_name FROM tenant GROUP BY company_name HAVING COUNT(*) = 1) uq
  ON uq.company_name = n.name;

-- ── C. 包干 1.0 元/度(含维护): elec_package=1.0 + mgmt 两键=0 (4 户×3=12 行;广联临电进待核) ──
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT CONCAT('tenant:', t.id), k.cfg_key, '', k.v, CONCAT(n.name, ' ', k.note)
FROM (SELECT '禹晨' AS name UNION ALL SELECT '粤海华创'
      UNION ALL SELECT '联塑精铟' UNION ALL SELECT '欧伟杰') n
CROSS JOIN (SELECT 'elec_package' AS cfg_key, 1.0 AS v, '包干1.0元/度,含维护,压过分时判定(§2.5)' AS note
            UNION ALL SELECT 'mgmt_fee', 0, '包干价已含维护/管理费(§2.5)'
            UNION ALL SELECT 'mgmt_fee_commercial', 0, '包干价已含维护/管理费(§2.5)') k
JOIN tenant t ON t.company_name = n.name
JOIN (SELECT company_name FROM tenant GROUP BY company_name HAVING COUNT(*) = 1) uq
  ON uq.company_name = n.name;

-- ── D. 管理费例外: mgmt_fee 与 mgmt_fee_commercial 双键同值(引擎走哪支都被压过) (4 户×2=8 行) ──
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT CONCAT('tenant:', t.id), k.cfg_key, '', n.v, CONCAT(n.name, ' 户级管理费', n.v, '(§2.5)')
FROM (SELECT '林锐辉' AS name, 0.10 AS v UNION ALL SELECT '朱漫钳', 0.10
      UNION ALL SELECT '星州', 0.15 UNION ALL SELECT '永龙', 0.15) n
CROSS JOIN (SELECT 'mgmt_fee' AS cfg_key UNION ALL SELECT 'mgmt_fee_commercial') k
JOIN tenant t ON t.company_name = n.name
JOIN (SELECT company_name FROM tenant GROUP BY company_name HAVING COUNT(*) = 1) uq
  ON uq.company_name = n.name;

-- ── E. 单户特价: 张誉腾 1.2 / 陈书谨 1.3(钢构户);管理费照常另收,不加 mgmt 行 (2 行) ──
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT CONCAT('tenant:', t.id), 'elec_package', '', n.v, CONCAT(n.name, ' ', n.note)
FROM (SELECT '张誉腾' AS name, 1.2 AS v, '特价1.2元/度,压过分时判定(§2.5)' AS note
      UNION ALL SELECT '陈书谨', 1.3, '钢构户特价1.3元/度,压过分时判定(§2.5)') n
JOIN tenant t ON t.company_name = n.name
JOIN (SELECT company_name FROM tenant GROUP BY company_name HAVING COUNT(*) = 1) uq
  ON uq.company_name = n.name;

-- ── F. 宿舍册水价特例: 可盈 water=3.85(管网待核不录) / 开利暖通 water=3.85+water_pipe=0 (3 行) ──
--     (电按商业价是默认分支,可盈不录电;开利暖通=二栋/三栋宿舍)
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT CONCAT('tenant:', t.id), n.cfg_key, '', n.v, CONCAT(n.name, ' ', n.note)
FROM (SELECT '可盈' AS name, 'water' AS cfg_key, 3.85 AS v,
             '宿舍区一楼商铺,水按宿舍价3.85;管网费待核未录(§2.5)' AS note
      UNION ALL SELECT '开利暖通', 'water', 3.85, '二栋/三栋宿舍,水3.85(§2.5)'
      UNION ALL SELECT '开利暖通', 'water_pipe', 0, '宿舍无管网费(§2.5)') n
JOIN tenant t ON t.company_name = n.name
JOIN (SELECT company_name FROM tenant GROUP BY company_name HAVING COUNT(*) = 1) uq
  ON uq.company_name = n.name;

-- ── G. 可莱恩 capacity_fee=23(PRICE-CFG-SPEC §76 九项待录之一;BILL-DERIVE-SPEC §3① B201=23,
--       其余场地若不该 23 由 S4-3 锚点月把关) (1 行) ──
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT CONCAT('tenant:', t.id), 'capacity_fee', '', 23, '可莱恩 B201 装机容量费23元/kVA(§2.5/PRICE-CFG-SPEC §76)'
FROM tenant t
JOIN (SELECT company_name FROM tenant GROUP BY company_name HAVING COUNT(*) = 1) uq
  ON uq.company_name = t.company_name
WHERE t.company_name = '可莱恩';

-- ═══ 验证 ═══
-- ① 总行数: 预期 68 (A12 + B30 + C12 + D8 + E2 + F3 + G1)
SELECT COUNT(*) AS total_expect_68
FROM tenant_price_cfg WHERE scope LIKE 'tenant:%' AND note LIKE '%§2.5%';

-- ② 分键行数: water=8, water_pipe=7, elec_package=16, mgmt_fee=18, mgmt_fee_commercial=18, capacity_fee=1
SELECT cfg_key, COUNT(*) AS n, GROUP_CONCAT(DISTINCT cfg_value ORDER BY cfg_value) AS vals
FROM tenant_price_cfg WHERE scope LIKE 'tenant:%' AND note LIKE '%§2.5%'
GROUP BY cfg_key ORDER BY cfg_key;

-- ③ 26 户落空检查: 预期 0 行(列出=该户没插进来,回头查名字/同名档)
SELECT n.name AS missing FROM
 (SELECT '幸悦' AS name UNION ALL SELECT '詹凯乔' UNION ALL SELECT '禹晨'
  UNION ALL SELECT '公交车站' UNION ALL SELECT '朱漫钳' UNION ALL SELECT '南一'
  UNION ALL SELECT 'SENAN' UNION ALL SELECT '周兴' UNION ALL SELECT '威奈斯'
  UNION ALL SELECT '张丽莉' UNION ALL SELECT '张勤军' UNION ALL SELECT '沙力海'
  UNION ALL SELECT '芷泉' UNION ALL SELECT '袁华圣' UNION ALL SELECT '章肖艳'
  UNION ALL SELECT '李李商铺' UNION ALL SELECT '粤海华创' UNION ALL SELECT '联塑精铟'
  UNION ALL SELECT '欧伟杰' UNION ALL SELECT '林锐辉' UNION ALL SELECT '星州'
  UNION ALL SELECT '永龙' UNION ALL SELECT '张誉腾' UNION ALL SELECT '陈书谨'
  UNION ALL SELECT '可盈' UNION ALL SELECT '开利暖通' UNION ALL SELECT '可莱恩') n
LEFT JOIN tenant t ON t.company_name = n.name
LEFT JOIN tenant_price_cfg c ON c.scope = CONCAT('tenant:', t.id) AND c.note LIKE '%§2.5%'
WHERE c.id IS NULL;

-- ④ 锚点抽查: 禹晨(A+C 两类)=5 行(water 4.45/pipe 0/override 1.0/mgmt 0×2);
--            朱漫钳(A+D)=4 行(water 4.45/pipe 0/mgmt 0.10×2)
SELECT c.scope, t.company_name, c.cfg_key, c.cfg_value
FROM tenant_price_cfg c
JOIN tenant t ON t.id = CAST(SUBSTRING(c.scope, 8) AS UNSIGNED)
WHERE t.company_name IN ('禹晨', '朱漫钳') AND c.note LIKE '%§2.5%'
ORDER BY t.company_name, c.cfg_key;

-- 回滚(整批,重跑前先执行):
-- DELETE FROM tenant_price_cfg WHERE scope LIKE 'tenant:%' AND note LIKE '%§2.5%';
